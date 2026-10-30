import * as THREE from 'three';
import { WEAPON_TUNING as T } from '../config';
import type { Boat } from '../Boat';
import type { Combat, WeaponFx } from '../Combat';
import { cannonballModel, harpoonModel, mortarShellModel, ropeMesh, targetMarker, torpedoModel } from '../Models';
import { angleDiff, clamp } from '../util';
import { Sfx } from '../Audio';

const _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Fast torpedo running along the surface, gently homing on a target that's still ahead of it. */
export class Torpedo implements WeaponFx {
  private mesh = torpedoModel();
  private life = T.torpedoes.life;
  private trail = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private z: number,
    private heading: number,
    private target: Boat | null,
  ) {
    c.group.add(this.mesh);
  }

  threatens(b: Boat): boolean {
    return b !== this.owner && (this.x - b.x) ** 2 + (this.z - b.z) ** 2 < 100;
  }

  update(dt: number): boolean {
    const c = this.c, P = T.torpedoes;
    this.life -= dt;
    if (this.target?.alive) {
      const d = angleDiff(this.heading, Math.atan2(this.target.x - this.x, this.target.z - this.z));
      if (Math.abs(d) < 1.3) this.heading += clamp(d, -P.turn * dt, P.turn * dt);
    }
    const sx = Math.sin(this.heading), sz = Math.cos(this.heading);
    this.x += sx * P.speed * dt;
    this.z += sz * P.speed * dt;
    const wy = c.waveY(this.x, this.z);
    this.mesh.position.set(this.x, wy + 0.1, this.z);
    this.mesh.rotation.set(0, this.heading, Math.sin(c.time * 22) * 0.12);
    this.trail -= dt;
    if (this.trail <= 0) {
      this.trail = 0.025;
      c.host.particles.emit(this.x - sx * 0.8, wy + 0.05, this.z - sz * 0.8, 1, 0xffffff, { speed: 0.4, up: 0.8, life: 0.7, size: 0.32, gravity: -0.4, alpha: 0.75 });
    }
    const hit = c.hitTest(this.x, this.z, 0.45, this.owner);
    if (hit) {
      c.hit(hit, P.damage, this.owner, 'torpedoes', sx * P.knock, sz * P.knock);
      c.explode(this.x, wy + 0.4, this.z, false);
      return false;
    }
    if (c.blocked(this.x, this.z)) {
      c.explode(this.x, wy + 0.4, this.z, false);
      return false;
    }
    if (this.life <= 0) {
      c.host.particles.splash(this.x, wy, this.z, 0.6);
      return false;
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.mesh);
  }
}

/** Iron cannonball on a ballistic arc, tuned to come down at `range`. */
export class Cannonball implements WeaponFx {
  private mesh = cannonballModel();
  private vx: number;
  private vz: number;
  private vy: number;
  private life = 2.5;
  private trail = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private y: number,
    private z: number,
    heading: number,
    range: number,
  ) {
    const B = T.broadside;
    this.vx = Math.sin(heading) * B.speed + owner.vx * 0.4;
    this.vz = Math.cos(heading) * B.speed + owner.vz * 0.4;
    // Solve the launch angle so the ball drops to deck height right at the target's distance.
    const t = clamp(range, 8, B.range) / B.speed;
    const targetY = c.waveY(x, z) + 0.5;
    this.vy = (targetY - y + 0.5 * B.gravity * t * t) / t;
    this.mesh.position.set(x, y, z);
    c.group.add(this.mesh);
  }

  threatens(b: Boat): boolean {
    return b !== this.owner && (this.x - b.x) ** 2 + (this.z - b.z) ** 2 < 64;
  }

  update(dt: number): boolean {
    const c = this.c, B = T.broadside;
    this.life -= dt;
    this.vy -= B.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.mesh.position.set(this.x, this.y, this.z);
    this.trail -= dt;
    if (this.trail <= 0) {
      this.trail = 0.03;
      c.host.particles.emit(this.x, this.y, this.z, 1, 0xe9edf2, { speed: 0.3, up: 0.4, life: 0.5, size: 0.5, gravity: -0.5, grow: 1.8, alpha: 0.5 });
    }
    const wy = c.waveY(this.x, this.z);
    if (this.y < wy + 2.3) {
      const hit = c.hitTest(this.x, this.z, 0.3, this.owner);
      if (hit) {
        const sp = Math.hypot(this.vx, this.vz) || 1;
        c.hit(hit, B.damage, this.owner, 'broadside', (this.vx / sp) * B.knock, (this.vz / sp) * B.knock);
        c.explode(this.x, this.y, this.z, false);
        return false;
      }
      if (c.blocked(this.x, this.z) && this.y < wy + 1.5) {
        c.explode(this.x, this.y, this.z, false);
        return false;
      }
    }
    if (this.y <= wy || this.life <= 0) {
      c.host.particles.splash(this.x, wy, this.z, 0.8);
      Sfx.splash(c.host.listenerDist(this.x, this.z));
      return false;
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.mesh);
  }
}

/** High-arcing mortar shell with a red landing marker that tightens as it falls. */
export class MortarShell implements WeaponFx {
  private mesh = mortarShellModel();
  private marker = targetMarker();
  private t = 0;
  private vx: number;
  private vz: number;
  private vy: number;
  private whistled = false;
  private trail = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private y: number,
    private z: number,
    private tx: number,
    private tz: number,
  ) {
    const M = T.mortar;
    this.vx = (tx - x) / M.flight;
    this.vz = (tz - z) / M.flight;
    this.vy = (c.waveY(tx, tz) + 0.3 - y + 0.5 * M.gravity * M.flight * M.flight) / M.flight;
    this.mesh.position.set(x, y, z);
    c.group.add(this.mesh, this.marker);
  }

  threatens(b: Boat): boolean {
    return b !== this.owner && (this.tx - b.x) ** 2 + (this.tz - b.z) ** 2 < 30;
  }

  update(dt: number): boolean {
    const c = this.c, M = T.mortar;
    this.t += dt;
    this.vy -= M.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.lookAt(this.x + this.vx, this.y + this.vy, this.z + this.vz);
    this.trail -= dt;
    if (this.trail <= 0) {
      this.trail = 0.035;
      c.host.particles.emit(this.x, this.y, this.z, 1, 0xdfe3e8, { speed: 0.3, up: 0.3, life: 0.6, size: 0.55, gravity: -0.4, grow: 2, alpha: 0.55 });
    }
    const k = Math.min(1, this.t / M.flight);
    const s = M.blast * 2 * (1.35 - 0.35 * k);
    this.marker.position.set(this.tx, c.waveY(this.tx, this.tz) + 0.08, this.tz);
    this.marker.scale.set(s, s, 1);
    this.marker.rotation.z += dt * 1.5;
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * Math.abs(Math.sin(this.t * (6 + k * 14)));
    if (!this.whistled && this.t > M.flight * 0.4) {
      this.whistled = true;
      Sfx.whistle(c.host.listenerDist(this.tx, this.tz));
    }
    if (this.t >= M.flight) {
      const wy = c.waveY(this.tx, this.tz);
      c.explode(this.tx, wy + 0.3, this.tz, true);
      c.host.particles.splash(this.tx, wy, this.tz, 2);
      c.damageArea(this.tx, this.tz, M.blast, M.damage, this.owner, 'mortar', M.knock, true);
      return false;
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.mesh, this.marker);
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
  }
}

/** Harpoon on a rope: flies out, and on a hit yanks the victim toward the shooter and stuns them. */
export class Harpoon implements WeaponFx {
  private mesh = harpoonModel();
  private rope = ropeMesh();
  private state: 'fly' | 'pull' | 'retract' = 'fly';
  private t = 0;
  private x: number;
  private y: number;
  private z: number;
  private victim: Boat | null = null;

  constructor(
    private c: Combat,
    private owner: Boat,
    x: number,
    z: number,
    private heading: number,
  ) {
    this.x = x;
    this.z = z;
    this.y = owner.y + 0.3;
    c.group.add(this.mesh, this.rope);
  }

  threatens(b: Boat): boolean {
    return this.state === 'fly' && b !== this.owner && (this.x - b.x) ** 2 + (this.z - b.z) ** 2 < 64;
  }

  update(dt: number): boolean {
    const c = this.c, H = T.harpoon, o = this.owner;
    if (!o.alive) return false;
    this.t += dt;
    if (this.state === 'fly') {
      this.x += Math.sin(this.heading) * H.speed * dt;
      this.z += Math.cos(this.heading) * H.speed * dt;
      this.y = o.y + 0.3;
      const hit = c.hitTest(this.x, this.z, 0.3, o);
      if (hit) {
        if (c.hit(hit, H.damage, o, 'harpoon')) {
          this.victim = hit;
          if (hit.owned) hit.stunT = H.stun;
          this.state = 'pull';
          this.t = 0;
          c.host.particles.emit(this.x, this.y, this.z, 6, 0xffd27a, { glow: true, speed: 4, up: 3, life: 0.25, size: 0.4 });
          Sfx.clank(c.host.listenerDist(this.x, this.z));
        } else {
          this.state = 'retract';
        }
      } else if (c.blocked(this.x, this.z)) {
        c.host.particles.emit(this.x, this.y, this.z, 5, 0xd8dde3, { speed: 3, up: 3, life: 0.3, size: 0.25 });
        this.state = 'retract';
      } else if (this.t > H.life) {
        this.state = 'retract';
      }
    } else if (this.state === 'pull') {
      const v = this.victim!;
      this.x = v.x;
      this.y = v.y + 0.3;
      this.z = v.z;
      const dx = o.x - v.x, dz = o.z - v.z;
      const d = Math.hypot(dx, dz) || 1;
      // Only boats simulated on this machine are moved (online, each player pulls their own boat).
      if (v.alive && !v.invulnerable && v.owned) {
        v.vx += (dx / d) * H.pull * dt;
        v.vz += (dz / d) * H.pull * dt;
      }
      if (v.alive && !v.invulnerable && o.owned) {
        o.vx -= (dx / d) * H.pull * 0.15 * dt;
        o.vz -= (dz / d) * H.pull * 0.15 * dt;
      }
      if (this.t > H.pullTime || !v.alive || v.invulnerable || d < 3.2) this.state = 'retract';
    } else {
      // Reel back to the bow.
      const bx = o.x + o.forwardX * 1.3, bz = o.z + o.forwardZ * 1.3;
      const dx = bx - this.x, dz = bz - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) return false;
      const step = Math.min(d, 70 * dt);
      this.x += (dx / d) * step;
      this.z += (dz / d) * step;
      this.y += (o.y + 0.3 - this.y) * 0.3;
    }

    // Visuals: harpoon points away from the boat; the rope runs bow → harpoon.
    const ax = o.x + o.forwardX * 1.3, ay = o.y + 0.25, az = o.z + o.forwardZ * 1.3;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, this.state === 'fly' ? this.heading : Math.atan2(this.x - ax, this.z - az), 0);
    _a.set(ax, ay, az);
    _b.set(this.x, this.y, this.z).sub(_a);
    const len = _b.length();
    this.rope.position.copy(_a);
    this.rope.quaternion.setFromUnitVectors(_up, _b.divideScalar(len || 1));
    this.rope.scale.set(1, Math.max(0.01, len), 1);
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.mesh, this.rope);
    this.rope.geometry.dispose();
  }
}
