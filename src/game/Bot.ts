import type { Boat } from './Boat';
import type { Arena } from './Arena';
import type { Combat } from './Combat';
import { MAX_HP } from './config';
import { angleDiff, clamp } from './util';

const PROBE_OFFSETS = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2];

/** Simple but lively AI: grab a barrel, hunt the nearest enemy, avoid rocks, unstick itself. */
export class BotBrain {
  private goalX = 0;
  private goalZ = 0;
  private target: Boat | null = null;
  private thinkT = 0;
  private stuckT = 0;
  private reverseT = 0;
  private reverseSteer = 1;
  private wobble = Math.random() * 10;

  constructor(
    readonly boat: Boat,
    /** 0..1, higher = sharper aim and quicker decisions. */
    readonly skill: number,
  ) {}

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
    if (t && t.alive && b.weapon && (b.weapon === 'cannon' || b.weapon === 'torpedo')) {
      // Lead the target a little.
      const lead = Math.hypot(t.x - b.x, t.z - b.z) / 45;
      gx = t.x + t.vx * lead;
      gz = t.z + t.vz * lead;
    }

    this.wobble += dt;
    const noise = Math.sin(this.wobble * 1.7) * (1 - this.skill) * 0.25;
    const desired = Math.atan2(gx - b.x, gz - b.z) + noise;
    const steerAngle = this.avoid(desired, arena, combat);
    const d = angleDiff(b.heading, steerAngle);
    inp.steer = clamp(-d * 2.2, -1, 1);
    const distGoal = Math.hypot(gx - b.x, gz - b.z);
    inp.throttle = Math.abs(d) > 1.8 ? 0.35 : distGoal < 4 && !t ? 0.4 : 1;

    this.decideFire(boats, combat, d);
  }

  private chooseGoal(boats: Boat[], arena: Arena, combat: Combat): void {
    const b = this.boat;
    this.target = null;
    if (!b.weapon) {
      let best = Infinity;
      for (const p of combat.pickups) {
        if (!p.active) continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < best) {
          best = d;
          this.goalX = p.x;
          this.goalZ = p.z;
        }
      }
      if (best === Infinity) {
        const s = arena.randomFreeSpot(3);
        this.goalX = s.x;
        this.goalZ = s.z;
      }
      return;
    }
    // Hunt: nearest enemy, preferring whoever is leading the scoreboard slightly.
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

  /** Picks the heading closest to `desired` whose path ahead is clear. */
  private avoid(desired: number, arena: Arena, combat: Combat): number {
    const b = this.boat;
    const look = 4 + b.speed * 0.45;
    for (const off of PROBE_OFFSETS) {
      const a = desired + off;
      const sx = Math.sin(a), sz = Math.cos(a);
      let ok = true;
      for (const f of [0.5, 1]) {
        const px = b.x + sx * look * f, pz = b.z + sz * look * f;
        if (!arena.isFree(px, pz, b.radius * 0.9)) {
          ok = false;
          break;
        }
        for (const m of combat.mines) {
          if (m.owner !== b && (m.x - px) ** 2 + (m.z - pz) ** 2 < 9) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
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
    const nearest = this.nearestEnemyDist(boats);
    switch (b.weapon) {
      case 'cannon':
        if (t && dist < 38 && Math.abs(aimErr) < 0.12 + (1 - this.skill) * 0.1) inp.fire = true;
        break;
      case 'torpedo':
        if (t && dist < 55 && Math.abs(aimErr) < 0.6) inp.fire = true;
        break;
      case 'mine': {
        // Drop when someone is chasing us, or eventually anyway.
        for (const o of boats) {
          if (o === b || !o.alive) continue;
          const dx = o.x - b.x, dz = o.z - b.z;
          const behind = Math.abs(angleDiff(b.heading, Math.atan2(dx, dz))) > 2.2;
          if (behind && dx * dx + dz * dz < 200) inp.fire = true;
        }
        if (b.weaponHeldT > 7) inp.fire = true;
        break;
      }
      case 'tidal':
        if (nearest < 10) inp.fire = true;
        else if (b.weaponHeldT > 12) inp.fire = true;
        break;
      case 'shield':
        if ((b.hp < MAX_HP && nearest < 25) || b.weaponHeldT > 6) inp.fire = true;
        for (const p of combat.projectiles) {
          if (p.owner !== b && (p.x - b.x) ** 2 + (p.z - b.z) ** 2 < 64) inp.fire = true;
        }
        break;
      case 'turbo':
        if ((t && dist > 20 && Math.abs(aimErr) < 0.3) || (t && dist < 8 && Math.abs(aimErr) < 0.25) || b.weaponHeldT > 6) inp.fire = true;
        break;
    }
  }

  private nearestEnemyDist(boats: Boat[]): number {
    const b = this.boat;
    let best = Infinity;
    for (const o of boats) {
      if (o === b || !o.alive) continue;
      best = Math.min(best, Math.hypot(o.x - b.x, o.z - b.z));
    }
    return best;
  }
}
