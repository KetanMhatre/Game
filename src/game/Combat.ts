import * as THREE from 'three';
import { PICKUP_RESPAWN_SECONDS, WEAPONS, WEAPON_TUNING as T, type WeaponId } from './config';
import type { Boat } from './Boat';
import type { Arena } from './Arena';
import type { Particles } from './Particles';
import { lambert } from './Arena';
import { angleDiff, pickWeighted } from './util';
import { waveHeight } from './waves';
import { Sfx } from './Audio';

export interface CombatHost {
  readonly boats: Boat[];
  readonly arena: Arena;
  readonly particles: Particles;
  readonly time: number;
  damage(target: Boat, amount: number, from: Boat | null, icon: string): void;
  /** Distance from the camera's focus, for SFX falloff and screen shake. */
  listenerDist(x: number, z: number): number;
  shake(amount: number): void;
  onPickup(boat: Boat, weapon: WeaponId): void;
}

interface Projectile {
  kind: 'cannon' | 'torpedo';
  owner: Boat;
  x: number;
  z: number;
  heading: number;
  speed: number;
  life: number;
  target: Boat | null;
  mesh: THREE.Object3D;
}

interface Mine {
  owner: Boat;
  x: number;
  z: number;
  t: number;
  mesh: THREE.Object3D;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  max: number;
  radius: number;
}

interface Pickup {
  x: number;
  z: number;
  active: boolean;
  timer: number;
  mesh: THREE.Object3D;
}

function spiky(color: number, radius: number, spikes: number, spikeColor: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), lambert(color)));
  const spikeGeo = new THREE.ConeGeometry(radius * 0.22, radius * 0.7, 4);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spikes; i++) {
    // Fibonacci sphere distribution for even spikes.
    const y = 1 - (i / (spikes - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const s = new THREE.Mesh(spikeGeo, lambert(spikeColor));
    s.position.copy(dir).multiplyScalar(radius * 1.05);
    s.quaternion.setFromUnitVectors(up, dir);
    g.add(s);
  }
  return g;
}

export class Combat {
  readonly group = new THREE.Group();
  readonly projectiles: Projectile[] = [];
  readonly mines: Mine[] = [];
  readonly pickups: Pickup[] = [];
  private rings: Ring[] = [];
  private protoCannon: THREE.Object3D;
  private protoTorpedo: THREE.Object3D;
  private protoMine: THREE.Object3D;
  private protoBarrel: THREE.Object3D;
  private weaponList = Object.values(WEAPONS);

  constructor(private host: CombatHost) {
    this.protoCannon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), lambert(0x6d4c41));

    const puffer = spiky(0xffcc33, 0.5, 14, 0xfff3c4);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), lambert(0x222222));
    eye.position.set(0.25, 0.15, 0.4);
    const eye2 = eye.clone();
    eye2.position.x = -0.25;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 4), lambert(0xffa000));
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = -0.7;
    puffer.add(eye, eye2, tail);
    this.protoTorpedo = puffer;

    this.protoMine = spiky(0x6a3d9a, 0.6, 18, 0x4a148c);

    const barrel = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 8), lambert(0xa1683a));
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xffd54f, emissive: 0x7a5a00, flatShading: true });
    for (const y of [-0.45, 0.45]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.79, 0.79, 0.14, 8), bandMat);
      band.position.y = y;
      barrel.add(band);
    }
    const q = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial({ color: 0xfff59d }));
    q.position.y = 1.35;
    q.name = 'gem';
    barrel.add(body, q);
    this.protoBarrel = barrel;

    for (const s of host.arena.pickupSpots) {
      const mesh = this.protoBarrel.clone();
      mesh.position.set(s.x, 0, s.z);
      this.group.add(mesh);
      this.pickups.push({ x: s.x, z: s.z, active: true, timer: 0, mesh });
    }
  }

  reset(): void {
    for (const p of this.projectiles) this.group.remove(p.mesh);
    for (const m of this.mines) this.group.remove(m.mesh);
    for (const r of this.rings) this.group.remove(r.mesh);
    this.projectiles.length = 0;
    this.mines.length = 0;
    this.rings.length = 0;
    for (const p of this.pickups) {
      p.active = true;
      p.mesh.visible = true;
    }
  }

  /** Fires/uses the boat's current weapon. Returns true if something happened. */
  useWeapon(b: Boat): boolean {
    if (!b.alive || !b.weapon || b.cooldown > 0) return false;
    const w = b.weapon;
    const dist = this.host.listenerDist(b.x, b.z);
    switch (w) {
      case 'cannon': {
        const target = this.findTarget(b, 0.22, 48);
        let heading = b.heading;
        if (target) {
          // Aim assist with simple lead.
          const t = Math.hypot(target.x - b.x, target.z - b.z) / T.cannonSpeed;
          heading = Math.atan2(target.x + target.vx * t - b.x, target.z + target.vz * t - b.z);
        }
        this.spawnProjectile('cannon', b, heading, T.cannonSpeed + b.speed * 0.5, T.cannonLife, null);
        b.cooldown = T.cannonCooldown;
        this.host.particles.emit(b.x + b.forwardX * 1.6, b.y + 0.4, b.z + b.forwardZ * 1.6, 6, 0xdddddd, { speed: 3, up: 2, life: 0.4, gravity: 0 });
        Sfx.fire(dist);
        break;
      }
      case 'torpedo': {
        const target = this.findTarget(b, 0.9, 70);
        this.spawnProjectile('torpedo', b, b.heading, T.torpedoSpeed, T.torpedoLife, target);
        b.cooldown = 0.5;
        Sfx.fire(dist);
        break;
      }
      case 'mine': {
        const mesh = this.protoMine.clone();
        const x = b.x - b.forwardX * 2.4, z = b.z - b.forwardZ * 2.4;
        mesh.position.set(x, 0, z);
        this.group.add(mesh);
        this.mines.push({ owner: b, x, z, t: 0, mesh });
        b.cooldown = 0.5;
        Sfx.splash(dist);
        break;
      }
      case 'tidal': {
        this.tidal(b);
        break;
      }
      case 'shield': {
        b.shieldT = T.shieldSeconds;
        Sfx.shield();
        break;
      }
      case 'turbo': {
        b.turboT = T.turboSeconds;
        Sfx.turbo();
        break;
      }
    }
    b.useAmmo();
    return true;
  }

  /** Nearest living enemy within `cone` radians of the boat's heading and `range` units. */
  findTarget(b: Boat, cone: number, range: number): Boat | null {
    let best: Boat | null = null;
    let bestScore = Infinity;
    for (const o of this.host.boats) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const ang = Math.abs(angleDiff(b.heading, Math.atan2(dx, dz)));
      if (ang > cone) continue;
      const score = d * (1 + ang * 2);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  private spawnProjectile(kind: Projectile['kind'], owner: Boat, heading: number, speed: number, life: number, target: Boat | null) {
    const mesh = (kind === 'cannon' ? this.protoCannon : this.protoTorpedo).clone();
    const x = owner.x + Math.sin(heading) * 1.8, z = owner.z + Math.cos(heading) * 1.8;
    mesh.position.set(x, owner.y + 0.6, z);
    this.group.add(mesh);
    this.projectiles.push({ kind, owner, x, z, heading, speed, life, target, mesh });
  }

  private tidal(b: Boat): void {
    const h = this.host;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 32),
      new THREE.MeshBasicMaterial({ color: 0xe1f5fe, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, b.y + 0.3, b.z);
    this.group.add(ring);
    this.rings.push({ mesh: ring, t: 0, max: 0.6, radius: T.tidalRadius });
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      h.particles.emit(b.x + Math.cos(a) * 2, b.y, b.z + Math.sin(a) * 2, 1, 0xb3e5fc, { speed: 18, up: 7, life: 0.7, size: 0.4 });
    }
    for (const o of h.boats) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > T.tidalRadius) continue;
      const push = T.tidalPush * (1 - d / T.tidalRadius * 0.5);
      o.vx += (dx / (d || 1)) * push;
      o.vz += (dz / (d || 1)) * push;
      h.damage(o, T.tidalDamage, b, WEAPONS.tidal.icon);
    }
    Sfx.splash(0);
    Sfx.boom(h.listenerDist(b.x, b.z));
    h.shake(0.4 * Math.max(0, 1 - h.listenerDist(b.x, b.z) / 30));
  }

  private explode(x: number, z: number, y: number, big: boolean): void {
    const h = this.host;
    const n = big ? 26 : 12;
    h.particles.emit(x, y, z, n, 0xff9800, { speed: big ? 9 : 5, up: big ? 9 : 5, life: 0.6, size: big ? 0.55 : 0.35 });
    h.particles.emit(x, y, z, n, 0xffeb3b, { speed: big ? 7 : 4, up: big ? 8 : 4, life: 0.5, size: 0.4 });
    h.particles.emit(x, y, z, n, 0xe1f5fe, { speed: big ? 6 : 3, up: big ? 13 : 8, life: 0.9, size: 0.45 });
    const d = h.listenerDist(x, z);
    Sfx.boom(d);
    h.shake((big ? 0.6 : 0.25) * Math.max(0, 1 - d / 35));
  }

  update(dt: number): void {
    const h = this.host;
    const time = h.time;
    const amp = h.arena.map.waveAmp;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.kind === 'torpedo') {
        if (p.target && p.target.alive) {
          const want = Math.atan2(p.target.x - p.x, p.target.z - p.z);
          const d = angleDiff(p.heading, want);
          p.heading += Math.max(-T.torpedoTurn * dt, Math.min(T.torpedoTurn * dt, d));
        }
        if (Math.random() < 0.5) h.particles.emit(p.x, p.mesh.position.y - 0.2, p.z, 1, 0xffffff, { speed: 0.5, up: 1, life: 0.5, gravity: 0, size: 0.2 });
      }
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      const wy = waveHeight(p.x, p.z, time, amp);
      p.mesh.position.set(p.x, wy + (p.kind === 'cannon' ? 0.9 : 0.35), p.z);
      p.mesh.rotation.y = p.heading;
      if (p.kind === 'cannon') p.mesh.rotation.x += dt * 12;

      let hit: Boat | null = null;
      for (const b of h.boats) {
        if (b === p.owner || !b.alive) continue;
        const r = b.radius + (p.kind === 'cannon' ? 0.4 : 0.6);
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < r * r) {
          hit = b;
          break;
        }
      }
      const blocked = !h.arena.isFree(p.x, p.z, 0);
      if (hit || blocked || p.life <= 0) {
        if (hit) {
          h.damage(hit, p.kind === 'cannon' ? T.cannonDamage : T.torpedoDamage, p.owner, WEAPONS[p.kind].icon);
          hit.vx += Math.sin(p.heading) * T.hitKnockback;
          hit.vz += Math.cos(p.heading) * T.hitKnockback;
          this.explode(p.x, p.z, wy + 0.5, p.kind === 'torpedo');
        } else if (blocked) {
          this.explode(p.x, p.z, wy + 0.5, false);
        } else {
          h.particles.emit(p.x, wy, p.z, 8, 0xe1f5fe, { speed: 2, up: 6, life: 0.6 });
          Sfx.splash(h.listenerDist(p.x, p.z));
        }
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i];
      m.t += dt;
      const wy = waveHeight(m.x, m.z, time, amp);
      m.mesh.position.y = wy + 0.1 + Math.sin(m.t * 3) * 0.08;
      m.mesh.rotation.y += dt * 0.8;
      let trigger = m.t > T.mineLife;
      if (!trigger && m.t > T.mineArm) {
        for (const b of h.boats) {
          if (!b.alive || (b === m.owner && m.t < 1.5)) continue;
          if ((b.x - m.x) ** 2 + (b.z - m.z) ** 2 < (T.mineRadius + b.radius) ** 2) {
            trigger = true;
            break;
          }
        }
      }
      if (trigger) {
        if (m.t <= T.mineLife) {
          for (const b of h.boats) {
            if (!b.alive) continue;
            const d = Math.hypot(b.x - m.x, b.z - m.z);
            if (d < 4.5) {
              h.damage(b, T.mineDamage, m.owner, WEAPONS.mine.icon);
              b.vx += ((b.x - m.x) / (d || 1)) * T.mineKnockback;
              b.vz += ((b.z - m.z) / (d || 1)) * T.mineKnockback;
            }
          }
          this.explode(m.x, m.z, wy + 0.4, true);
        }
        this.group.remove(m.mesh);
        this.mines.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.max;
      r.mesh.scale.setScalar(1 + k * r.radius);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (k >= 1) {
        this.group.remove(r.mesh);
        this.rings.splice(i, 1);
      }
    }

    for (const p of this.pickups) {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.active = true;
          p.mesh.visible = true;
          h.particles.emit(p.x, 0.5, p.z, 10, 0xfff59d, { speed: 3, up: 4, life: 0.6, gravity: 4 });
        }
        continue;
      }
      p.mesh.position.y = waveHeight(p.x, p.z, time, amp) + 0.3 + Math.sin(time * 2 + p.x) * 0.15;
      p.mesh.rotation.y += dt * 1.2;
      p.mesh.rotation.z = Math.sin(time * 1.7 + p.z) * 0.12;
      for (const b of h.boats) {
        if (!b.alive || b.weapon) continue;
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < (b.radius + 1.3) ** 2) {
          const w = pickWeighted(this.weaponList).id;
          b.giveWeapon(w);
          p.active = false;
          p.timer = PICKUP_RESPAWN_SECONDS;
          p.mesh.visible = false;
          h.particles.emit(p.x, 0.8, p.z, 14, 0xffd54f, { speed: 5, up: 6, life: 0.6 });
          h.onPickup(b, w);
          break;
        }
      }
    }
  }
}
