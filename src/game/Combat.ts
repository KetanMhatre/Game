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
import type { FireMsg } from '../../shared/protocol';

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
  /** Boat by network id (homing targets in shots replayed from the network). */
  boatById(id: string): Boat | undefined;
  /** Online: ask the server for crate `index` (it answers with the weapon). Solo hosts leave this out. */
  requestPickup?(b: Boat, index: number): void;
  /** Online: a trap went off on a boat this machine owns, so everyone else removes it too. */
  onTrap?(id: string): void;
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
  /** Traps any player can set off (mines, fake crates) have an id shared by every client. */
  netId?: string;
  /** Another player's boat set this trap off. */
  trigger?(): void;
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
  /** Online: waiting for the server's answer to a pickup request. */
  pending: number;
}

/** Seconds between uses for weapons with several shots. */
const COOLDOWN: Partial<Record<WeaponId, number>> = {
  torpedoes: T.torpedoes.cooldown,
  broadside: T.broadside.cooldown,
  mines: 0.5,
  fakeCrate: 0.5,
  mortar: 0.8,
  deckGun: T.deckGun.interval,
  harpoon: 0.9,
};

/** Rounds shot parameters so network messages stay small (1 mm / 0.001 rad is plenty). */
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Combat {
  readonly group = new THREE.Group();
  readonly pickups: Pickup[] = [];
  readonly bullets: BulletLayer;
  private fx: WeaponFx[] = [];
  private pool: WeaponDef[] = WEAPON_ORDER.map((id) => WEAPONS[id]);
  /** Online play: crates are handed out by the server. */
  online = false;
  /** Online: how far behind real time other players' boats are drawn (seconds); aiming leads them by this. */
  lag = 0;
  private trapSeq = 0;

  constructor(readonly host: CombatHost) {
    for (const s of host.arena.pickupSpots) {
      const m = crateModel(false);
      m.obj.position.set(s.x, 0, s.z);
      m.ring.position.set(s.x, 0.05, s.z);
      this.group.add(m.obj, m.ring);
      this.pickups.push({ x: s.x, z: s.z, active: true, timer: 0, ...m, appear: 1, pending: 0 });
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
      p.pending = 0;
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
      const dx = this.nowX(o) - b.x, dz = this.nowZ(o) - b.z;
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
    const tx = this.nowX(target), tz = this.nowZ(target);
    const t = Math.hypot(tx - b.x, tz - b.z) / speed;
    return { heading: Math.atan2(tx + target.vx * t - b.x, tz + target.vz * t - b.z), target };
  }

  /** Where a boat really is now. Other players' boats are drawn `lag` seconds in the past. */
  nowX(o: Boat): number {
    return o.owned ? o.x : o.x + o.vx * this.lag;
  }

  nowZ(o: Boat): number {
    return o.owned ? o.z : o.z + o.vz * this.lag;
  }

  /** Damage + knockback, unless the target is shielded. Returns true if it landed. */
  hit(target: Boat, dmg: number, owner: Boat | null, icon: string, kx = 0, kz = 0): boolean {
    if (!target.alive) return false;
    // Online, each machine only damages the boats it simulates. The target's own machine runs this
    // same shot and applies the hit there (so what you see hitting you is what hurts you).
    if (!target.owned) return !target.invulnerable;
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

  /**
   * Fires/uses the boat's current weapon. Returns the shot (for other players), or null if it couldn't fire.
   * The shot is planned once (aim, targets, spread) and then replayed identically by everyone.
   */
  useWeapon(b: Boat): FireMsg | null {
    if (!b.alive || !b.weapon || b.cooldown > 0) return null;
    const ev = this.plan(b, b.weapon);
    this.applyFire(ev, b);
    b.cooldown = COOLDOWN[b.weapon] ?? 0;
    if (b.weapon === 'barrier') b.shieldT = T.barrier.seconds;
    b.useAmmo();
    return ev;
  }

  private plan(b: Boat, w: WeaponId): FireMsg {
    const fx = b.forwardX, fz = b.forwardZ;
    const rx = -fz, rz = fx; // starboard (right) vector
    const ev: FireMsg = { by: b.netId, w, p: [] };
    const p = ev.p;
    switch (w) {
      case 'torpedoes': {
        const target = this.findTarget(b, b.heading, 0.5, 60);
        if (target) ev.t = target.netId;
        for (const s of [-1, 1]) p.push(b.x + fx * 1.2 + rx * s * 0.55, b.z + fz * 1.2 + rz * s * 0.55, b.heading + s * 0.035);
        break;
      }
      case 'broadside':
        for (const side of [-1, 1]) {
          const base = b.heading - side * (Math.PI / 2); // side +1 = starboard, -1 = port
          const { heading, target } = this.aim(b, base, T.broadside.cone, T.broadside.range, T.broadside.speed);
          const x = b.x + Math.sin(base) * 1.05, z = b.z + Math.cos(base) * 1.05;
          const range = target ? Math.hypot(this.nowX(target) - x, this.nowZ(target) - z) : 22;
          p.push(x, b.y + 0.3, z, heading, range);
        }
        break;
      case 'mines':
      case 'fakeCrate': {
        const back = w === 'mines' ? 2.4 : 2.8;
        p.push(b.x - fx * back, b.z - fz * back);
        ev.id = `${b.netId}.${++this.trapSeq}`;
        break;
      }
      case 'mortar': {
        const M = T.mortar;
        const target = this.findTarget(b, b.heading, 0.75, M.maxRange);
        let tx: number, tz: number;
        if (target) {
          tx = this.nowX(target) + target.vx * M.flight * 0.8;
          tz = this.nowZ(target) + target.vz * M.flight * 0.8;
        } else {
          tx = b.x + fx * 22;
          tz = b.z + fz * 22;
        }
        // Keep the landing point within the mortar's range band.
        const dx = tx - b.x, dz = tz - b.z;
        const d = Math.hypot(dx, dz) || 1;
        const clamped = Math.min(M.maxRange, Math.max(M.minRange, d));
        p.push(b.x + fx * 1.0, b.y + 0.6, b.z + fz * 1.0, b.x + (dx / d) * clamped, b.z + (dz / d) * clamped);
        break;
      }
      case 'deckGun': {
        const G = T.deckGun;
        const { heading } = this.aim(b, b.heading, 0.25, 36, G.speed);
        p.push(b.x + fx * 1.5, b.y + 0.22, b.z + fz * 1.5, heading + (Math.random() - 0.5) * 2 * G.spread);
        break;
      }
      case 'maelstrom': {
        const M = T.maelstrom;
        const target = this.findTarget(b, b.heading, 0.5, 28);
        let cx = target ? this.nowX(target) + target.vx * 0.6 : b.x + fx * M.distance;
        let cz = target ? this.nowZ(target) + target.vz * 0.6 : b.z + fz * M.distance;
        // Pull the centre back toward the boat until it sits on open water.
        for (let i = 0; i < 10 && !this.host.arena.isFree(cx, cz, 2); i++) {
          cx += (b.x - cx) * 0.2;
          cz += (b.z - cz) * 0.2;
        }
        p.push(cx, cz);
        break;
      }
      case 'depthCharges': {
        const D = T.depthCharges;
        const offsets = [[0, -2.6], [-1.7, -4.2], [1.7, -4.2]];
        offsets.forEach(([side, back], i) => p.push(b.x + fx * back + rx * side, b.z + fz * back + rz * side, D.fuse + i * D.stagger));
        break;
      }
      case 'harpoon': {
        const { heading } = this.aim(b, b.heading, 0.25, 38, T.harpoon.speed);
        p.push(b.x + Math.sin(heading) * 1.5, b.z + Math.cos(heading) * 1.5, heading);
        break;
      }
      // barrier, flail, drone: nothing to aim.
    }
    for (let i = 0; i < p.length; i++) p[i] = r3(p[i]);
    return ev;
  }

  /**
   * Spawns a shot's effects. Shots from other players arrive over the network `lead` seconds late:
   * they're fast-forwarded so they're where they really are.
   */
  applyFire(ev: FireMsg, b: Boat, lead = 0): void {
    const h = this.host;
    const P = h.particles;
    const p = ev.p;
    const dist = h.listenerDist(b.x, b.z);
    const first = this.fx.length;
    switch (ev.w as WeaponId) {
      case 'torpedoes': {
        const target = (ev.t && h.boatById(ev.t)) || null;
        for (let i = 0; i + 2 < p.length; i += 3) {
          this.add(new Torpedo(this, b, p[i], p[i + 1], p[i + 2], target));
          P.splash(p[i], this.waveY(p[i], p[i + 1]) - 0.1, p[i + 1], 0.4);
        }
        Sfx.launch(dist);
        break;
      }
      case 'broadside':
        for (let i = 0; i + 4 < p.length; i += 5) {
          this.add(new Cannonball(this, b, p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4]));
          P.muzzle(p[i], p[i + 1], p[i + 2]);
        }
        Sfx.fire(dist);
        Sfx.fire(dist + 8);
        if (dist < 1) h.shake(0.2);
        break;
      case 'mines':
        this.add(Object.assign(new NavalMine(this, b, p[0], p[1]), { netId: ev.id }));
        Sfx.splash(dist);
        break;
      case 'barrier':
        P.sparkle(b.x, b.y + 1, b.z, 0xbff4ff);
        if (dist < 30) Sfx.shield();
        break;
      case 'fakeCrate':
        this.add(Object.assign(new FakeCrate(this, b, p[0], p[1]), { netId: ev.id }));
        Sfx.splash(dist);
        break;
      case 'mortar':
        this.add(new MortarShell(this, b, p[0], p[1], p[2], p[3], p[4]));
        P.muzzle(p[0], p[1] + 0.2, p[2]);
        Sfx.thump(dist);
        break;
      case 'deckGun': {
        const G = T.deckGun;
        const [mx, my, mz, hd] = p;
        // Bullets are too quick to step one by one: start them further along instead.
        const ax = mx + Math.sin(hd) * G.speed * lead, az = mz + Math.cos(hd) * G.speed * lead;
        this.bullets.fire(b, ax, my, az, hd, G.speed, G.life - lead, G.damage, 'deckGun');
        P.emit(mx, my, mz, 1, 0xffd27a, { glow: true, speed: 0.5, up: 0.3, life: 0.08, size: 0.7, gravity: 0 });
        b.model.spinGun();
        Sfx.gun(dist);
        break;
      }
      case 'maelstrom':
        this.add(new Maelstrom(this, b, p[0], p[1]));
        Sfx.swirl(h.listenerDist(p[0], p[1]));
        break;
      case 'depthCharges':
        for (let i = 0; i + 2 < p.length; i += 3) this.add(new DepthCharge(this, b, p[i], p[i + 1], p[i + 2]));
        Sfx.splash(dist);
        break;
      case 'harpoon':
        this.add(new Harpoon(this, b, p[0], p[1], p[2]));
        Sfx.twang(dist);
        break;
      case 'flail':
        this.add(new Flail(this, b));
        Sfx.whoosh(dist);
        break;
      case 'drone':
        this.add(new Drone(this, b));
        P.splash(b.x - b.forwardZ * 2.5, b.y - 0.3, b.z + b.forwardX * 2.5, 0.6);
        if (dist < 30) Sfx.beep();
        break;
    }
    if (lead > 0) this.fastForward(first, lead);
  }

  private fastForward(first: number, lead: number): void {
    for (let i = this.fx.length - 1; i >= first; i--) {
      const f = this.fx[i];
      for (let t = lead; t > 1e-4; t -= 1 / 60) {
        if (!f.update(Math.min(1 / 60, t))) {
          f.dispose();
          this.fx.splice(i, 1);
          break;
        }
      }
    }
  }

  /** Another player's boat set off a mine / fake crate. */
  triggerTrap(id: string): void {
    this.fx.find((f) => f.netId === id)?.trigger?.();
  }

  /** A crate was collected: hide it, and arm the boat if this machine simulates it. */
  grant(index: number, b: Boat | null, weapon: WeaponId): void {
    const p = this.pickups[index];
    if (!p) return;
    if (p.active) this.hideCrate(p);
    if (b?.owned && b.alive && !b.weapon && WEAPONS[weapon]) {
      b.giveWeapon(weapon);
      this.host.onPickup(b, weapon);
    }
  }

  /** Online: show/hide crates to match the server (`taken` = picked up and not respawned yet). */
  syncCrates(taken: (index: number) => boolean): void {
    this.pickups.forEach((p, i) => {
      const t = taken(i);
      if (t && p.active) this.hideCrate(p);
      // The server's "taken" flag can lag the grant message slightly: don't flash the crate back.
      else if (!t && !p.active && p.timer < PICKUP_RESPAWN_SECONDS - 1) this.showCrate(p);
    });
  }

  private hideCrate(p: Pickup): void {
    const h = this.host;
    p.active = false;
    p.timer = PICKUP_RESPAWN_SECONDS;
    p.obj.visible = p.ring.visible = false;
    h.particles.sparkle(p.x, 1, p.z);
    h.particles.splash(p.x, this.waveY(p.x, p.z), p.z, 0.6);
  }

  private showCrate(p: Pickup): void {
    p.active = true;
    p.appear = 0;
    p.pending = 0;
    p.obj.visible = p.ring.visible = true;
    this.host.particles.sparkle(p.x, 1, p.z);
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

    this.pickups.forEach((p, index) => {
      if (!p.active) {
        p.timer -= dt;
        // Online the server says when crates come back (syncCrates).
        if (p.timer <= 0 && !this.online) this.showCrate(p);
        return;
      }
      animateCrate(p, this.waveY(p.x, p.z), time, dt);
      p.pending = Math.max(0, p.pending - dt);
      for (const b of h.boats) {
        if (!b.alive || b.weapon || !b.owned) continue;
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < (b.radius + 1.3) ** 2) {
          if (this.online && h.requestPickup) {
            // First come, first served: the server picks the weapon and tells everyone.
            if (p.pending <= 0) {
              p.pending = 0.5;
              h.requestPickup(b, index);
            }
          } else {
            this.grant(index, b, pickWeighted(this.pool).id);
          }
          break;
        }
      }
    });
  }
}

