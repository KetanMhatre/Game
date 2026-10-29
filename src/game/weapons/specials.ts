import * as THREE from 'three';
import { WEAPON_TUNING as T } from '../config';
import type { Boat } from '../Boat';
import type { Combat, Hazard, WeaponFx } from '../Combat';
import { chainLinkGeo, droneModel, flailBallModel, vortexMesh } from '../Models';
import { lambert } from '../render/materials';
import { angleDiff, damp } from '../util';
import { Sfx } from '../Audio';

/** Whirlpool that pulls rivals in, swirls them around and damages anyone caught in the core. */
export class Maelstrom implements WeaponFx {
  private v = vortexMesh();
  private t = 0;
  private dmgAcc = new Map<number, number>();
  private debrisT = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private z: number,
  ) {
    this.v.mesh.position.set(x, 0, z);
    c.group.add(this.v.mesh);
    c.host.particles.splash(x, 0, z, 1.4);
  }

  hazard(): Hazard {
    return { x: this.x, z: this.z, r: T.maelstrom.radius * 0.8, owner: this.owner };
  }

  update(dt: number): boolean {
    const c = this.c, M = T.maelstrom;
    this.t += dt;
    if (this.t > M.life) return false;
    const fade = Math.min(1, this.t / 0.4) * Math.min(1, (M.life - this.t) / 0.6);
    const R = M.radius;
    this.v.material.uniforms.uTime.value = c.time;
    this.v.material.uniforms.uAlpha.value = fade;
    this.v.mesh.position.y = c.waveY(this.x, this.z) + 0.07;
    const s = R * (0.55 + 0.45 * Math.min(1, this.t / 0.4));
    this.v.mesh.scale.set(s, s, 1);

    for (const b of c.host.boats) {
      if (b === this.owner || !b.alive || b.invulnerable) continue;
      const dx = this.x - b.x, dz = this.z - b.z;
      const d = Math.hypot(dx, dz) || 0.01;
      if (d > R) continue;
      const k = (1 - d / R) * fade;
      // n points at the centre; (nz, -nx) is the tangent in the same rotation sense as the shader and foam.
      const nx = dx / d, nz = dz / d;
      b.vx += (nx * M.pull + nz * M.swirl) * k * dt;
      b.vz += (nz * M.pull - nx * M.swirl) * k * dt;
      b.vx *= Math.exp(-0.9 * k * dt);
      b.vz *= Math.exp(-0.9 * k * dt);
      if (d < M.core) {
        let acc = (this.dmgAcc.get(b.id) ?? 0) + M.dps * dt;
        if (acc >= 0.3) {
          c.hit(b, 0.3, this.owner, 'maelstrom');
          acc -= 0.3;
        }
        this.dmgAcc.set(b.id, acc);
      }
    }

    // Foam and debris circling the rim.
    this.debrisT -= dt;
    if (this.debrisT <= 0 && fade > 0.3) {
      this.debrisT = 0.04;
      const a = Math.random() * Math.PI * 2;
      const r = R * (0.35 + Math.random() * 0.55);
      const px = this.x + Math.cos(a) * r, pz = this.z + Math.sin(a) * r;
      // Tangential (counter-clockwise) plus a little inward drift.
      const tx = -Math.sin(a) * 0.9 - Math.cos(a) * 0.3, tz = Math.cos(a) * 0.9 - Math.sin(a) * 0.3;
      c.host.particles.emit(px, c.waveY(px, pz) + 0.1, pz, 1, Math.random() < 0.8 ? 0xf2fbff : 0x8a5a33, {
        dirX: tx, dirZ: tz, speed: 7, up: 0.6, life: 0.7, size: 0.35, gravity: 1, drag: 0.4,
      });
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.v.mesh);
    this.v.mesh.geometry.dispose();
    this.v.material.dispose();
  }
}

const LINKS = 6;

/** Spiked ball on a chain orbiting the owner's boat, smashing anything it touches. */
export class Flail implements WeaponFx {
  private ball = flailBallModel();
  private links: THREE.Mesh[] = [];
  private t = 0;
  private angle: number;
  private cool = new Map<number, number>();
  private lastWhoosh = 0;
  private bx = 0;
  private bz = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
  ) {
    this.angle = owner.heading + Math.PI / 2;
    const mat = lambert(0x8f9ba7);
    for (let i = 0; i < LINKS; i++) {
      const link = new THREE.Mesh(chainLinkGeo, mat);
      link.castShadow = true;
      this.links.push(link);
    }
    c.group.add(this.ball, ...this.links);
  }

  hazard(): Hazard | null {
    return this.owner.alive ? { x: this.owner.x, z: this.owner.z, r: T.flail.radius + 1.6, owner: this.owner } : null;
  }

  threatens(b: Boat): boolean {
    return b !== this.owner && (this.bx - b.x) ** 2 + (this.bz - b.z) ** 2 < 25;
  }

  update(dt: number): boolean {
    const c = this.c, F = T.flail, o = this.owner;
    if (!o.alive) return false;
    this.t += dt;
    if (this.t > F.seconds) return false;
    const ext = Math.min(1, this.t / 0.35) * Math.min(1, (F.seconds - this.t) / 0.3);
    this.angle += F.spin * dt;
    const r = 1.2 + (F.radius - 1.2) * ext;
    const by = o.y + 0.45 + Math.sin(this.angle * 2) * 0.12;
    this.bx = o.x + Math.sin(this.angle) * r;
    this.bz = o.z + Math.cos(this.angle) * r;
    this.ball.position.set(this.bx, by, this.bz);
    this.ball.rotation.set(this.t * 7, this.t * 5, 0);
    const ax = o.x, ay = o.y + 0.5, az = o.z;
    this.links.forEach((link, i) => {
      const f = (i + 1) / (LINKS + 1);
      link.position.set(ax + (this.bx - ax) * f, ay + (by - ay) * f, az + (this.bz - az) * f);
      link.lookAt(this.ball.position);
      link.rotateZ(i % 2 ? Math.PI / 2 : 0);
    });
    for (const [id, v] of this.cool) this.cool.set(id, v - dt);
    for (const b of c.host.boats) {
      if (b === o || !b.alive || (this.cool.get(b.id) ?? 0) > 0) continue;
      if ((b.x - this.bx) ** 2 + (b.z - this.bz) ** 2 >= (b.radius + 0.55) ** 2) continue;
      this.cool.set(b.id, F.hitCooldown);
      const dx = b.x - o.x, dz = b.z - o.z;
      const d = Math.hypot(dx, dz) || 1;
      c.hit(b, F.damage, o, 'flail', (dx / d) * F.knock, (dz / d) * F.knock);
      c.host.particles.emit(this.bx, by, this.bz, 10, 0xffd27a, { glow: true, speed: 6, up: 4, life: 0.3, size: 0.4 });
      c.host.particles.splash(this.bx, by - 0.4, this.bz, 0.6);
      Sfx.clank(c.host.listenerDist(this.bx, this.bz));
    }
    // Motion streak + periodic whoosh.
    c.host.particles.emit(this.bx, by, this.bz, 1, 0xffffff, { speed: 0.1, up: 0, life: 0.18, size: 0.7, gravity: 0, alpha: 0.35 });
    if (this.angle - this.lastWhoosh > Math.PI) {
      this.lastWhoosh = this.angle;
      Sfx.whoosh(c.host.listenerDist(o.x, o.z) + 6);
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.ball, ...this.links);
  }
}

/** Mini gunboat that circles its owner and peppers the nearest rival in range. */
export class Drone implements WeaponFx {
  private m = droneModel();
  private t = 0;
  private x: number;
  private z: number;
  private heading: number;
  private orbit: number;
  private fireT = 0.6;
  private wakeT = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
  ) {
    this.orbit = owner.heading - Math.PI / 2;
    this.x = owner.x - owner.forwardZ * 2.5;
    this.z = owner.z + owner.forwardX * 2.5;
    this.heading = owner.heading;
    c.group.add(this.m.obj);
  }

  update(dt: number): boolean {
    const c = this.c, D = T.drone, o = this.owner;
    this.t += dt;
    const P = c.host.particles;
    if (!o.alive || this.t > D.seconds) {
      P.splash(this.x, c.waveY(this.x, this.z), this.z, 0.8);
      P.sparkle(this.x, c.waveY(this.x, this.z) + 0.6, this.z, 0xbff4ff);
      return false;
    }
    // Circle the owner; tuck in closer if the orbit point is over land.
    this.orbit += D.orbitSpeed * dt;
    let tx = o.x + Math.sin(this.orbit) * D.orbit, tz = o.z + Math.cos(this.orbit) * D.orbit;
    if (!c.host.arena.isFree(tx, tz, 0.6)) {
      tx = o.x + (tx - o.x) * 0.45;
      tz = o.z + (tz - o.z) * 0.45;
    }
    const k = damp(3.5, dt);
    const nx = this.x + (tx - this.x) * k, nz = this.z + (tz - this.z) * k;
    if (Math.hypot(nx - this.x, nz - this.z) > 0.001) {
      const want = Math.atan2(nx - this.x, nz - this.z);
      this.heading += angleDiff(this.heading, want) * damp(8, dt);
    }
    this.x = nx;
    this.z = nz;
    const wy = c.waveY(this.x, this.z);
    const obj = this.m.obj;
    obj.position.set(this.x, wy + 0.18 + Math.sin(this.t * 4) * 0.04, this.z);
    obj.rotation.set(Math.sin(this.t * 3) * 0.05, this.heading, Math.cos(this.t * 2.6) * 0.06);
    this.m.lightMat.color.setHex(Math.sin(this.t * 9) > 0 ? 0xff3b3b : 0x5a1414);

    // Turret: track and shoot the nearest rival.
    let target: Boat | null = null;
    let best = D.range;
    for (const b of c.host.boats) {
      if (b === o || !b.alive) continue;
      const d = Math.hypot(b.x - this.x, b.z - this.z);
      if (d < best) {
        best = d;
        target = b;
      }
    }
    this.fireT -= dt;
    if (target) {
      const lead = best / 60;
      const aimH = Math.atan2(target.x + target.vx * lead - this.x, target.z + target.vz * lead - this.z);
      this.m.turret.rotation.y = angleDiff(this.heading, aimH);
      if (this.fireT <= 0) {
        this.fireT = D.interval;
        const h = aimH + (Math.random() - 0.5) * 0.12;
        const mx = this.x + Math.sin(h) * 0.7, mz = this.z + Math.cos(h) * 0.7;
        c.bullets.fire(o, mx, wy + 0.45, mz, h, 60, 0.55, D.damage, 'drone');
        P.emit(mx, wy + 0.45, mz, 1, 0xffd27a, { glow: true, speed: 0.4, up: 0.2, life: 0.08, size: 0.5, gravity: 0 });
        Sfx.gun(c.host.listenerDist(this.x, this.z) + 10);
      }
    } else {
      this.m.turret.rotation.y += dt * 1.5;
    }
    this.wakeT -= dt;
    if (this.wakeT <= 0) {
      this.wakeT = 0.06;
      P.emit(this.x - Math.sin(this.heading) * 0.8, wy + 0.02, this.z - Math.cos(this.heading) * 0.8, 1, 0xffffff, { speed: 0.6, up: 0.8, life: 0.5, size: 0.28, gravity: 2, alpha: 0.8 });
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.m.obj);
    this.m.lightMat.dispose();
  }
}
