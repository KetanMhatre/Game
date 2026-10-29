import type { Boat } from './Boat';
import type { Arena } from './Arena';
import type { Combat, Hazard } from './Combat';
import { MAX_HP } from './config';
import { angleDiff, clamp } from './util';

const PROBE_OFFSETS = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2];

/** Simple but lively AI: grab a crate, hunt the nearest enemy, avoid hazards, unstick itself. */
export class BotBrain {
  private goalX = 0;
  private goalZ = 0;
  private target: Boat | null = null;
  private thinkT = 0;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 1;
  private wobble = Math.random() * 10;
  private hazards: Hazard[] = [];
  /** Gullible bots take fake crates for real ones. */
  private readonly gullible: boolean;

  constructor(
    readonly boat: Boat,
    /** 0..1, higher = sharper aim and quicker decisions. */
    readonly skill: number,
  ) {
    this.gullible = Math.random() < 0.15 + (1 - skill) * 0.35;
  }

  update(dt: number, boats: Boat[], arena: Arena, combat: Combat): void {
    const b = this.boat;
    const inp = b.input;
    inp.fire = false;
    if (!b.alive) {
      inp.throttle = inp.steer = 0;
      return;
    }

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.35 + (1 - this.skill) * 0.4;
      this.hazards = combat.hazards().filter((h) => h.owner !== b && !(h.fake && this.gullible));
      this.chooseGoal(boats, arena, combat);
    }

    // Unstick: if we're pushing but not moving, reverse while turning.
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = -1;
      inp.steer = this.reverseSteer;
      return;
    }
    if (inp.throttle > 0.5 && b.speed < 1.5) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > 1) {
      this.stuckT = 0;
      this.reverseT = 0.9;
      this.reverseSteer = Math.random() < 0.5 ? -1 : 1;
    }

    let gx = this.goalX, gz = this.goalZ;
    const t = this.target;
    if (t && t.alive && b.weapon) {
      const lead = Math.hypot(t.x - b.x, t.z - b.z) / 45;
      gx = t.x + t.vx * lead;
      gz = t.z + t.vz * lead;
      if (b.weapon === 'broadside') {
        // Broadsides fire sideways: aim to pass alongside the target, not at it.
        const dx = t.x - b.x, dz = t.z - b.z;
        const d = Math.hypot(dx, dz) || 1;
        gx += (-dz / d) * 8;
        gz += (dx / d) * 8;
      }
    }

    this.wobble += dt;
    const noise = Math.sin(this.wobble * 1.7) * (1 - this.skill) * 0.25;
    const desired = Math.atan2(gx - b.x, gz - b.z) + noise;
    const steerAngle = this.avoid(desired, arena);
    const d = angleDiff(b.heading, steerAngle);
    inp.steer = clamp(-d * 2.2, -1, 1);
    const distGoal = Math.hypot(gx - b.x, gz - b.z);
    inp.throttle = Math.abs(d) > 1.8 ? 0.35 : distGoal < 4 && !t ? 0.4 : 1;

    this.decideFire(boats, combat, t ? angleDiff(b.heading, Math.atan2(t.x - b.x, t.z - b.z)) : Math.PI);
  }

  private chooseGoal(boats: Boat[], arena: Arena, combat: Combat): void {
    const b = this.boat;
    this.target = null;
    if (!b.weapon) {
      let best = Infinity;
      const consider = (x: number, z: number) => {
        const d = Math.hypot(x - b.x, z - b.z);
        if (d < best) {
          best = d;
          this.goalX = x;
          this.goalZ = z;
        }
      };
      for (const p of combat.pickups) if (p.active) consider(p.x, p.z);
      if (this.gullible) for (const h of combat.hazards()) if (h.fake && h.owner !== b) consider(h.x, h.z);
      if (best === Infinity) {
        const s = arena.randomFreeSpot(3);
        this.goalX = s.x;
        this.goalZ = s.z;
      }
      return;
    }
    // Hunt: nearest enemy, preferring leaders and wounded boats.
    let best = Infinity;
    for (const o of boats) {
      if (o === b || !o.alive) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z) - o.kills * 2 - (o.hp < MAX_HP ? 4 : 0);
      if (d < best) {
        best = d;
        this.target = o;
      }
    }
    if (this.target) {
      this.goalX = this.target.x;
      this.goalZ = this.target.z;
    }
  }

  /** Picks the heading closest to `desired` whose path ahead is clear of land and hazards. */
  private avoid(desired: number, arena: Arena): number {
    const b = this.boat;
    const look = 4 + b.speed * 0.45;
    for (const off of PROBE_OFFSETS) {
      const a = desired + off;
      const sx = Math.sin(a), sz = Math.cos(a);
      let ok = true;
      for (const f of [0.5, 1]) {
        const px = b.x + sx * look * f, pz = b.z + sz * look * f;
        if (!arena.isFree(px, pz, b.radius * 0.9) || this.hazards.some((h) => (h.x - px) ** 2 + (h.z - pz) ** 2 < h.r * h.r)) {
          ok = false;
          break;
        }
      }
      if (ok) return a;
    }
    // Everything blocked: steer toward the arena centre.
    return Math.atan2(-b.x, -b.z);
  }

  private decideFire(boats: Boat[], combat: Combat, aimErr: number): void {
    const b = this.boat;
    const inp = b.input;
    if (!b.weapon) return;
    const t = this.target;
    const dist = t ? Math.hypot(t.x - b.x, t.z - b.z) : Infinity;
    const absErr = Math.abs(aimErr);
    const held = b.weaponHeldT;
    const sloppy = (1 - this.skill) * 0.1;
    let fire = false;
    switch (b.weapon) {
      case 'torpedoes':
        fire = !!t && dist < 45 && absErr < 0.25 + sloppy;
        break;
      case 'broadside':
        // Fire when any rival is roughly abeam (side-on) and in range.
        fire = this.enemyWithin(boats, 30, (ang) => Math.abs(ang) > 0.85 && Math.abs(ang) < 2.3) || held > 9;
        break;
      case 'mines':
      case 'depthCharges':
        fire = this.enemyWithin(boats, 16, (ang) => Math.abs(ang) > 2.2) || held > 7;
        break;
      case 'fakeCrate':
        fire = this.enemyWithin(boats, 22, (ang) => Math.abs(ang) > 2) || held > 3;
        break;
      case 'barrier':
        fire = combat.threatNear(b) || (b.hp < MAX_HP && this.enemyWithin(boats, 20)) || held > 8;
        break;
      case 'mortar':
        fire = !!t && dist > 10 && dist < 40 && absErr < 0.7;
        break;
      case 'deckGun':
        fire = !!t && dist < 30 && absErr < 0.16 + sloppy;
        break;
      case 'maelstrom':
        fire = (!!t && dist > 6 && dist < 26 && absErr < 0.4) || held > 10;
        break;
      case 'harpoon':
        fire = !!t && dist < 34 && absErr < 0.14 + sloppy;
        break;
      case 'flail':
        fire = this.enemyWithin(boats, 8) || held > 10;
        break;
      case 'drone':
        fire = this.enemyWithin(boats, 28) || held > 3;
        break;
    }
    inp.fire = fire;
  }

  /** Is any living enemy within `range` whose bearing (relative to our heading) passes `test`? */
  private enemyWithin(boats: Boat[], range: number, test: (ang: number) => boolean = () => true): boolean {
    const b = this.boat;
    for (const o of boats) {
      if (o === b || !o.alive) continue;
      const dx = o.x - b.x, dz = o.z - b.z;
      if (dx * dx + dz * dz > range * range) continue;
      if (test(angleDiff(b.heading, Math.atan2(dx, dz)))) return true;
    }
    return false;
  }
}
