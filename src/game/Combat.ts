import * as THREE from 'three';
import { PICKUP_RESPAWN_SECONDS, WEAPONS, WEAPON_ORDER, WEAPON_TUNING as T, type WeaponDef, type WeaponId } from './config';
import type { Boat } from './Boat';
import type { Arena } from './Arena';
import type { Particles } from './Particles';
import { animateCrate, crateModel } from './Models';
import { angleDiff, pickWeighted } from './util';
import { waveHeight } from './waves';
import { Sfx } from './Audio';
import { BulletLayer } from './weapons/bullets';
import { Cannonball, Harpoon, MortarShell, Torpedo } from './weapons/projectiles';
import { DepthCharge, FakeCrate, NavalMine } from './weapons/traps';
import { Drone, Flail, Maelstrom } from './weapons/specials';

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

/** Something bots should steer around (mines, whirlpools, spinning flails, fake crates...). */
export interface Hazard {
  x: number;
  z: number;
  r: number;
  owner: Boat | null;
  /** Fake crates look like pickups: gullible bots drive straight at them. */
  fake?: boolean;
}

/** A live weapon object in the world. Return false from update() when finished. */
export interface WeaponFx {
  update(dt: number): boolean;
  dispose(): void;
  hazard?(): Hazard | null;
  /** True if this is an incoming attack near `b` (bots raise their Hydro-Barrier). */
  threatens?(b: Boat): boolean;
}

interface Pickup {
  x: number;
  z: number;
  active: boolean;
  timer: number;
  obj: THREE.Group;
  crate: THREE.Mesh;
  badge: THREE.Sprite;
  ring: THREE.Mesh;
  /** 0..1 pop-in animation after respawning. */
  appear: number;
}

export class Combat {
  readonly group = new THREE.Group();
  readonly pickups: Pickup[] = [];
  readonly bullets: BulletLayer;
  private fx: WeaponFx[] = [];
  private pool: WeaponDef[] = WEAPON_ORDER.map((id) => WEAPONS[id]);

  constructor(readonly host: CombatHost) {
    for (const s of host.arena.pickupSpots) {
      const m = crateModel(false);
      m.obj.position.set(s.x, 0, s.z);
      m.ring.position.set(s.x, 0.05, s.z);
      this.group.add(m.obj, m.ring);
      this.pickups.push({ x: s.x, z: s.z, active: true, timer: 0, ...m, appear: 1 });
    }
    this.bullets = new BulletLayer(this);
    this.group.add(this.bullets.mesh);
  }

  get time(): number {
    return this.host.time;
  }

  /** Which weapons crates can roll (the Arsenal screen). Empty means everything. */
  setArsenal(ids: WeaponId[]): void {
    const list = ids.filter((id) => WEAPONS[id]).map((id) => WEAPONS[id]);
    this.pool = list.length ? list : WEAPON_ORDER.map((id) => WEAPONS[id]);
  }

  reset(): void {
    for (const f of this.fx) f.dispose();
    this.fx.length = 0;
    this.bullets.clear();
    for (const p of this.pickups) {
      p.active = true;
      p.appear = 1;
      p.obj.visible = p.ring.visible = true;
    }
  }

  add(f: WeaponFx): void {
    this.fx.push(f);
  }

  // ---------------------------------------------------------------- queries used by weapons & bots

  waveY(x: number, z: number): number {
    return waveHeight(x, z, this.host.time, this.host.arena.map.waveAmp);
  }

  blocked(x: number, z: number): boolean {
    return !this.host.arena.isFree(x, z, 0);
  }

  /** First living boat (other than `exclude`) whose hull overlaps a circle of radius `pad` at (x,z). */
  hitTest(x: number, z: number, pad: number, exclude: Boat | null): Boat | null {
    for (const b of this.host.boats) {
      if (b === exclude || !b.alive) continue;
      const r = b.radius + pad;
      if ((b.x - x) ** 2 + (b.z - z) ** 2 < r * r) return b;
    }
    return null;
  }

  hazards(): Hazard[] {
    const out: Hazard[] = [];
    for (const f of this.fx) {
      const h = f.hazard?.();
      if (h) out.push(h);
    }
    return out;
  }

  threatNear(b: Boat): boolean {
    return this.bullets.threatens(b) || this.fx.some((f) => f.threatens?.(b));
  }

  /** Nearest living enemy within `cone` radians of `heading` and `range` units. */
  findTarget(b: Boat, heading: number, cone: number, range: number, minRange = 0): Boat | null {
    let best: Boat | null = null;
    let bestScore = Infinity;
    for (const o of this.host.boats) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < minRange) continue;
      const ang = Math.abs(angleDiff(heading, Math.atan2(dx, dz)));
      if (ang > cone) continue;
      const score = d * (1 + ang * 2);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /** Aim assist: heading toward the best target in the cone (with lead), else `heading` unchanged. */
  aim(b: Boat, heading: number, cone: number, range: number, speed: number): { heading: number; target: Boat | null } {
    const target = this.findTarget(b, heading, cone, range);
    if (!target) return { heading, target: null };
    const t = Math.hypot(target.x - b.x, target.z - b.z) / speed;
    return { heading: Math.atan2(target.x + target.vx * t - b.x, target.z + target.vz * t - b.z), target };
  }

  /** Damage + knockback, unless the target is shielded. Returns true if it landed. */
  hit(target: Boat, dmg: number, owner: Boat | null, icon: string, kx = 0, kz = 0): boolean {
    if (!target.alive) return false;
    if (!target.invulnerable) {
      target.vx += kx;
      target.vz += kz;
    }
    const landed = !target.invulnerable;
    this.host.damage(target, dmg, owner, icon);
    return landed;
  }

  /** Blast damage to every boat within `r`, pushed outward. Returns how many were hit. */
  damageArea(x: number, z: number, r: number, dmg: number, owner: Boat | null, icon: string, knock: number, spareOwner: boolean): number {
    let n = 0;
    for (const b of this.host.boats) {
      if (!b.alive || (spareOwner && b === owner)) continue;
      const d = Math.hypot(b.x - x, b.z - z);
      if (d > r + b.radius * 0.5) continue;
      const k = knock * (1 - Math.min(1, d / (r + 1)) * 0.5);
      if (this.hit(b, dmg, owner, icon, ((b.x - x) / (d || 1)) * k, ((b.z - z) / (d || 1)) * k)) n++;
    }
    return n;
  }

  explode(x: number, y: number, z: number, big: boolean): void {
    const h = this.host;
    h.particles.explosion(x, y, z, big);
    const d = h.listenerDist(x, z);
    Sfx.boom(d);
    h.shake((big ? 0.6 : 0.25) * Math.max(0, 1 - d / 35));
  }

  // ---------------------------------------------------------------- firing

  /** Fires/uses the boat's current weapon. Returns true if something happened. */
  useWeapon(b: Boat): boolean {
    if (!b.alive || !b.weapon || b.cooldown > 0) return false;
    const h = this.host;
    const P = h.particles;
    const dist = h.listenerDist(b.x, b.z);
    const fx = b.forwardX, fz = b.forwardZ;
    const rx = -fz, rz = fx; // starboard (right) vector
    switch (b.weapon) {
      case 'torpedoes': {
        const target = this.findTarget(b, b.heading, 0.5, 60);
        for (const s of [-1, 1]) {
          const x = b.x + fx * 1.2 + rx * s * 0.55, z = b.z + fz * 1.2 + rz * s * 0.55;
          this.add(new Torpedo(this, b, x, z, b.heading + s * 0.035, target));
          P.splash(x, b.y - 0.35, z, 0.4);
        }
        b.cooldown = T.torpedoes.cooldown;
        Sfx.launch(dist);
        break;
      }
      case 'broadside': {
        for (const side of [-1, 1]) {
          const base = b.heading - side * (Math.PI / 2); // side +1 = starboard, -1 = port
          const { heading, target } = this.aim(b, base, T.broadside.cone, T.broadside.range, T.broadside.speed);
          const x = b.x + Math.sin(base) * 1.05, z = b.z + Math.cos(base) * 1.05;
          const range = target ? Math.hypot(target.x - x, target.z - z) : 22;
          this.add(new Cannonball(this, b, x, b.y + 0.3, z, heading, range));
          P.muzzle(x, b.y + 0.3, z);
        }
        b.cooldown = T.broadside.cooldown;
        Sfx.fire(dist);
        Sfx.fire(dist + 8);
        if (dist < 1) h.shake(0.2);
        break;
      }
      case 'mines': {
        this.add(new NavalMine(this, b, b.x - fx * 2.4, b.z - fz * 2.4));
        b.cooldown = 0.5;
        Sfx.splash(dist);
        break;
      }
      case 'barrier':
        b.shieldT = T.barrier.seconds;
        P.sparkle(b.x, b.y + 1, b.z, 0xbff4ff);
        Sfx.shield();
        break;
      case 'fakeCrate': {
        this.add(new FakeCrate(this, b, b.x - fx * 2.8, b.z - fz * 2.8));
        b.cooldown = 0.5;
        Sfx.splash(dist);
        break;
      }
      case 'mortar': {
        const M = T.mortar;
        const target = this.findTarget(b, b.heading, 0.75, M.maxRange);
        let tx: number, tz: number;
        if (target) {
          tx = target.x + target.vx * M.flight * 0.8;
          tz = target.z + target.vz * M.flight * 0.8;
        } else {
          tx = b.x + fx * 22;
          tz = b.z + fz * 22;
        }
        // Keep the landing point within the mortar's range band.
        const dx = tx - b.x, dz = tz - b.z;
        const d = Math.hypot(dx, dz) || 1;
        const clamped = Math.min(M.maxRange, Math.max(M.minRange, d));
        tx = b.x + (dx / d) * clamped;
        tz = b.z + (dz / d) * clamped;
        this.add(new MortarShell(this, b, b.x + fx * 1.0, b.y + 0.6, b.z + fz * 1.0, tx, tz));
        P.muzzle(b.x + fx * 1.0, b.y + 0.8, b.z + fz * 1.0);
        b.cooldown = 0.8;
        Sfx.thump(dist);
        break;
      }
      case 'deckGun': {
        const G = T.deckGun;
        const { heading } = this.aim(b, b.heading, 0.25, 36, G.speed);
        const hd = heading + (Math.random() - 0.5) * 2 * G.spread;
        const mx = b.x + fx * 1.5, mz = b.z + fz * 1.5;
        this.bullets.fire(b, mx, b.y + 0.22, mz, hd, G.speed, G.life, G.damage, 'deckGun');
        P.emit(mx, b.y + 0.22, mz, 1, 0xffd27a, { glow: true, speed: 0.5, up: 0.3, life: 0.08, size: 0.7, gravity: 0 });
        b.model.spinGun();
        b.cooldown = G.interval;
        Sfx.gun(dist);
        break;
      }
      case 'maelstrom': {
        const M = T.maelstrom;
        const target = this.findTarget(b, b.heading, 0.5, 28);
        let cx = target ? target.x + target.vx * 0.6 : b.x + fx * M.distance;
        let cz = target ? target.z + target.vz * 0.6 : b.z + fz * M.distance;
        // Pull the centre back toward the boat until it sits on open water.
        for (let i = 0; i < 10 && !this.host.arena.isFree(cx, cz, 2); i++) {
          cx += (b.x - cx) * 0.2;
          cz += (b.z - cz) * 0.2;
        }
        this.add(new Maelstrom(this, b, cx, cz));
        Sfx.swirl(h.listenerDist(cx, cz));
        break;
      }
      case 'depthCharges': {
        const D = T.depthCharges;
        const offsets = [[0, -2.6], [-1.7, -4.2], [1.7, -4.2]];
        offsets.forEach(([side, back], i) => {
          this.add(new DepthCharge(this, b, b.x + fx * back + rx * side, b.z + fz * back + rz * side, D.fuse + i * D.stagger));
        });
        Sfx.splash(dist);
        break;
      }
      case 'harpoon': {
        const { heading } = this.aim(b, b.heading, 0.25, 38, T.harpoon.speed);
        this.add(new Harpoon(this, b, heading));
        b.cooldown = 0.9;
        Sfx.twang(dist);
        break;
      }
      case 'flail':
        this.add(new Flail(this, b));
        Sfx.whoosh(dist);
        break;
      case 'drone':
        this.add(new Drone(this, b));
        P.splash(b.x + rx * 2.5, b.y - 0.3, b.z + rz * 2.5, 0.6);
        Sfx.beep();
        break;
    }
    b.useAmmo();
    return true;
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    const h = this.host;
    const time = h.time;
    this.bullets.update(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      if (!this.fx[i].update(dt)) {
        this.fx[i].dispose();
        this.fx.splice(i, 1);
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
      animateCrate(p, this.waveY(p.x, p.z), time, dt);
      for (const b of h.boats) {
        if (!b.alive || b.weapon) continue;
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < (b.radius + 1.3) ** 2) {
          const w = pickWeighted(this.pool).id;
          b.giveWeapon(w);
          p.active = false;
          p.timer = PICKUP_RESPAWN_SECONDS;
          p.obj.visible = p.ring.visible = false;
          h.particles.sparkle(p.x, 1, p.z);
          h.particles.splash(p.x, this.waveY(p.x, p.z), p.z, 0.6);
          h.onPickup(b, w);
          break;
        }
      }
    }
  }
}

