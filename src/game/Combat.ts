import * as THREE from 'three';
import { PICKUP_RESPAWN_SECONDS, WEAPONS, WEAPON_TUNING as T, type WeaponId } from './config';
import type { Boat } from './Boat';
import type { Arena } from './Arena';
import type { Particles } from './Particles';
import { coconutModel, pickupModel, pufferModel, tidalRingMaterial, urchinModel } from './Models';
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
  trailT: number;
}

interface Mine {
  owner: Boat;
  x: number;
  z: number;
  t: number;
  mesh: THREE.Object3D;
  tipMat: THREE.MeshBasicMaterial;
  ring: THREE.Mesh;
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
  obj: THREE.Group;
  barrel: THREE.Mesh;
  badge: THREE.Sprite;
  ring: THREE.Mesh;
  /** 0..1 pop-in animation after respawning. */
  appear: number;
}

const tipIdle = new THREE.Color(0xff6fb0);
const tipArmed = new THREE.Color(0xff2d55);

/** For per-instance effect meshes (own geometry + material; textures are shared and kept). */
function disposeMesh(m: THREE.Mesh): void {
  m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}

export class Combat {
  readonly group = new THREE.Group();
  readonly projectiles: Projectile[] = [];
  readonly mines: Mine[] = [];
  readonly pickups: Pickup[] = [];
  private rings: Ring[] = [];
  private weaponList = Object.values(WEAPONS);

  constructor(private host: CombatHost) {
    for (const s of host.arena.pickupSpots) {
      const m = pickupModel();
      m.obj.position.set(s.x, 0, s.z);
      m.ring.position.set(s.x, 0.05, s.z);
      this.group.add(m.obj, m.ring);
      this.pickups.push({ x: s.x, z: s.z, active: true, timer: 0, ...m, appear: 1 });
    }
  }

  reset(): void {
    for (const p of this.projectiles) this.group.remove(p.mesh);
    for (const m of this.mines) this.group.remove(m.mesh, m.ring);
    for (const r of this.rings) this.group.remove(r.mesh);
    this.projectiles.length = 0;
    this.mines.length = 0;
    this.rings.length = 0;
    for (const p of this.pickups) {
      p.active = true;
      p.appear = 1;
      p.obj.visible = p.ring.visible = true;
    }
  }

  /** Fires/uses the boat's current weapon. Returns true if something happened. */
  useWeapon(b: Boat): boolean {
    if (!b.alive || !b.weapon || b.cooldown > 0) return false;
    const h = this.host;
    const dist = h.listenerDist(b.x, b.z);
    switch (b.weapon) {
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
        h.particles.muzzle(b.x + b.forwardX * 1.55, b.y + 0.25, b.z + b.forwardZ * 1.55);
        Sfx.fire(dist);
        break;
      }
      case 'torpedo': {
        const target = this.findTarget(b, 0.9, 70);
        this.spawnProjectile('torpedo', b, b.heading, T.torpedoSpeed, T.torpedoLife, target);
        b.cooldown = 0.5;
        h.particles.splash(b.x + b.forwardX * 1.8, b.y - 0.3, b.z + b.forwardZ * 1.8, 0.5);
        Sfx.fire(dist);
        break;
      }
      case 'mine': {
        const m = urchinModel();
        const x = b.x - b.forwardX * 2.4, z = b.z - b.forwardZ * 2.4;
        m.obj.position.set(x, 0, z);
        m.ring.position.set(x, 0.05, z);
        this.group.add(m.obj, m.ring);
        this.mines.push({ owner: b, x, z, t: 0, mesh: m.obj, tipMat: m.tipMat, ring: m.ring });
        b.cooldown = 0.5;
        h.particles.splash(x, 0, z, 0.6);
        Sfx.splash(dist);
        break;
      }
      case 'tidal':
        this.tidal(b);
        break;
      case 'shield':
        b.shieldT = T.shieldSeconds;
        h.particles.sparkle(b.x, b.y + 1, b.z, 0xbff4ff);
        Sfx.shield();
        break;
      case 'turbo':
        b.turboT = T.turboSeconds;
        h.particles.splash(b.x - b.forwardX * 1.4, b.y, b.z - b.forwardZ * 1.4, 0.8);
        Sfx.turbo();
        break;
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
    const mesh = kind === 'cannon' ? coconutModel() : pufferModel();
    const x = owner.x + Math.sin(heading) * 1.8, z = owner.z + Math.cos(heading) * 1.8;
    mesh.position.set(x, owner.y + 0.6, z);
    this.group.add(mesh);
    this.projectiles.push({ kind, owner, x, z, heading, speed, life, target, mesh, trailT: 0 });
  }

  private tidal(b: Boat): void {
    const h = this.host;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), tidalRingMaterial());
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, b.y - 0.2, b.z);
    ring.renderOrder = 4;
    this.group.add(ring);
    this.rings.push({ mesh: ring, t: 0, max: 0.65, radius: T.tidalRadius });
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      h.particles.emit(b.x + Math.cos(a) * 2, b.y, b.z + Math.sin(a) * 2, 1, 0xe6f8ff, { speed: 16, up: 6, life: 0.7, size: 0.55, drag: 1.2 });
    }
    h.particles.splash(b.x, b.y, b.z, 1.8);
    for (const o of h.boats) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > T.tidalRadius) continue;
      const push = T.tidalPush * (1 - (d / T.tidalRadius) * 0.5);
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
    h.particles.explosion(x, y, z, big);
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
      p.trailT -= dt;
      if (p.kind === 'torpedo' && p.target && p.target.alive) {
        const want = Math.atan2(p.target.x - p.x, p.target.z - p.z);
        const d = angleDiff(p.heading, want);
        p.heading += Math.max(-T.torpedoTurn * dt, Math.min(T.torpedoTurn * dt, d));
      }
      p.x += Math.sin(p.heading) * p.speed * dt;
      p.z += Math.cos(p.heading) * p.speed * dt;
      const wy = waveHeight(p.x, p.z, time, amp);
      const m = p.mesh;
      if (p.kind === 'cannon') {
        m.position.set(p.x, wy + 0.9, p.z);
        m.rotation.set(m.rotation.x + dt * 14, p.heading, 0);
        if (p.trailT <= 0) {
          p.trailT = 0.03;
          h.particles.emit(p.x, wy + 0.9, p.z, 1, 0xe9edf2, { speed: 0.3, up: 0.4, life: 0.45, size: 0.45, gravity: -0.5, grow: 1.8, alpha: 0.55 });
        }
      } else {
        // Puffers swim: wiggle, bob and puff up rhythmically.
        m.position.set(p.x, wy + 0.32 + Math.abs(Math.sin(time * 9)) * 0.08, p.z);
        m.rotation.set(0, p.heading + Math.sin(time * 18) * 0.18, Math.sin(time * 9) * 0.1);
        m.scale.setScalar(1 + Math.sin(time * 6) * 0.06);
        if (p.trailT <= 0) {
          p.trailT = 0.04;
          h.particles.emit(p.x, wy + 0.1, p.z, 1, 0xffffff, { speed: 0.6, up: 1.2, life: 0.6, size: 0.25, gravity: -1, alpha: 0.8 });
        }
      }

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
          h.particles.splash(p.x, wy, p.z, 0.7);
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
      m.mesh.position.y = wy + 0.05 + Math.sin(m.t * 3) * 0.08;
      m.mesh.rotation.y += dt * 0.8;
      m.ring.position.y = wy + 0.06;
      const armed = m.t > T.mineArm;
      const pulse = 0.5 + 0.5 * Math.sin(m.t * (armed ? 9 : 3));
      m.tipMat.color.copy(armed ? tipArmed : tipIdle).multiplyScalar(0.7 + pulse * 0.6);
      (m.ring.material as THREE.MeshBasicMaterial).opacity = armed ? 0.25 + pulse * 0.45 : 0;
      let trigger = m.t > T.mineLife;
      if (!trigger && armed) {
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
        } else {
          h.particles.splash(m.x, wy, m.z, 0.5);
        }
        this.group.remove(m.mesh, m.ring);
        disposeMesh(m.ring);
        m.tipMat.dispose();
        this.mines.splice(i, 1);
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.max;
      r.mesh.scale.setScalar(1 + k * r.radius);
      r.mesh.position.y = waveHeight(r.mesh.position.x, r.mesh.position.z, time, amp) + 0.15;
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
      if (k >= 1) {
        this.group.remove(r.mesh);
        disposeMesh(r.mesh);
        this.rings.splice(i, 1);
      }
    }

    for (const p of this.pickups) {
      if (!p.active) {
        p.timer -= dt;
        if (p.timer <= 0) {
          p.active = true;
          p.appear = 0;
          p.obj.visible = p.ring.visible = true;
          h.particles.sparkle(p.x, 1, p.z);
        }
        continue;
      }
      p.appear = Math.min(1, p.appear + dt * 3);
      const pop = p.appear < 1 ? 1 + Math.sin(p.appear * Math.PI) * 0.35 : 1;
      const wy = waveHeight(p.x, p.z, time, amp);
      p.obj.position.y = wy + 0.35 + Math.sin(time * 2 + p.x) * 0.15;
      p.obj.scale.setScalar(p.appear * pop);
      p.barrel.rotation.set(Math.sin(time * 1.7 + p.z) * 0.12, p.barrel.rotation.y + dt * 1.1, Math.cos(time * 1.3 + p.x) * 0.1);
      p.badge.position.y = 1.55 + Math.sin(time * 3 + p.x) * 0.08;
      p.ring.position.y = wy + 0.06;
      const rs = 1 + 0.08 * Math.sin(time * 3 + p.z);
      p.ring.scale.set(rs, rs, 1);
      for (const b of h.boats) {
        if (!b.alive || b.weapon) continue;
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < (b.radius + 1.3) ** 2) {
          const w = pickWeighted(this.weaponList).id;
          b.giveWeapon(w);
          p.active = false;
          p.timer = PICKUP_RESPAWN_SECONDS;
          p.obj.visible = p.ring.visible = false;
          h.particles.sparkle(p.x, 1, p.z);
          h.particles.splash(p.x, wy, p.z, 0.6);
          h.onPickup(b, w);
          break;
        }
      }
    }
  }
}
