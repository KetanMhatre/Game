import * as THREE from 'three';
import { BOAT, MAX_HP, WEAPONS, type WeaponId } from './config';
import { BoatModel, RIDE_HEIGHT } from './BoatModel';
import type { SpeciesId } from './Character';
import type { Arena } from './Arena';
import { angleDiff, clamp, damp } from './util';
import { waveHeight } from './waves';
import { POSE_ALIVE, POSE_PROTECT, POSE_SHIELD, POSE_STUN, type PoseMsg } from '../../shared/protocol';

/** Remote boats are drawn this far in the past so there are always two poses to blend between. */
export const INTERP_DELAY_MS = 110;

interface Snapshot extends PoseMsg {
  at: number;
}

/**
 * Everything a boat needs from its controller each tick. Player, bots and (later)
 * network clients all drive boats through this same plain object.
 */
export interface BoatInput {
  throttle: number; // -1..1
  steer: number; // -1..1, +1 = right
  fire: boolean;
}

let nextId = 1;

export class Boat {
  readonly id = nextId++;
  readonly model: BoatModel;
  readonly input: BoatInput = { throttle: 0, steer: 0, fire: false };

  x = 0;
  z = 0;
  y = 0;
  vx = 0;
  vz = 0;
  heading = 0;
  readonly radius = BOAT.radius;

  hp = MAX_HP;
  alive = true;
  respawnT = 0;
  protectT = 0;
  shieldT = 0;
  /** Harpoon stun: controls barely respond while > 0. */
  stunT = 0;
  cooldown = 0;
  weapon: WeaponId | null = null;
  ammo = 0;
  weaponHeldT = 0;

  kills = 0;
  deaths = 0;
  lastHitBy: Boat | null = null;
  lastHitT = 0;
  /** Name tags are hidden for the menu's background boats. */
  labelEnabled = true;
  /** Online id (session id, or "bot-N"). Solo boats get local ids so weapons can refer to them. */
  netId = '';
  /** Simulated on this machine (my boat, or bots when I'm the bot host). Others follow network poses. */
  owned = true;
  private snaps: Snapshot[] = [];

  private pitch = 0;
  private roll = 0;
  /** Smoothed controls and motion state (see update()). */
  private steer = 0;
  private throttle = 0;
  private yawRate = 0;
  private accelF = 0;
  private sinkT = 0;
  private label: THREE.Sprite;
  private labelCanvas: HTMLCanvasElement;
  private labelTex: THREE.CanvasTexture;

  constructor(
    readonly name: string,
    readonly color: number,
    readonly isPlayer: boolean,
    readonly species: SpeciesId,
  ) {
    this.model = new BoatModel(color, species);
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 80;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, depthWrite: false, transparent: true }));
    this.label.scale.set(3.6, 1.125, 1);
    this.label.position.y = 2.75;
    this.label.renderOrder = 10;
    this.model.root.add(this.label);
    this.drawLabel();
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardX(): number {
    return Math.sin(this.heading);
  }

  get forwardZ(): number {
    return Math.cos(this.heading);
  }

  get invulnerable(): boolean {
    return this.protectT > 0 || this.shieldT > 0;
  }

  get score(): number {
    return this.kills;
  }

  spawn(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.heading = heading;
    this.hp = MAX_HP;
    this.alive = true;
    this.protectT = 0;
    this.shieldT = 0;
    this.stunT = 0;
    this.sinkT = 0;
    this.weapon = null;
    this.ammo = 0;
    this.model.setMount(null);
    this.lastHitBy = null;
    this.steer = this.throttle = this.yawRate = this.accelF = 0;
    this.pitch = this.roll = 0;
    this.model.root.visible = true;
    this.model.tilt.rotation.set(0, 0, 0);
    this.drawLabel();
  }

  giveWeapon(id: WeaponId): void {
    this.weapon = id;
    this.ammo = WEAPONS[id].ammo;
    this.weaponHeldT = 0;
    this.model.setMount(id);
  }

  useAmmo(): void {
    this.ammo--;
    if (this.ammo <= 0) {
      this.weapon = null;
      this.model.setMount(null);
    }
  }

  /** Returns true if this hit killed the boat. Damage can be fractional (bullets). */
  takeDamage(amount: number, from: Boat | null): boolean {
    if (!this.alive || this.invulnerable) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (from && from !== this) {
      this.lastHitBy = from;
      this.lastHitT = 4;
    }
    // Small bullet hits shouldn't trigger the full dizzy wobble every time.
    if (amount >= 0.5 || Math.random() < 0.25) this.model.character.hit();
    this.drawLabel();
    if (this.hp <= 0.001) {
      this.hp = 0;
      this.alive = false;
      this.sinkT = 0;
      this.deaths++;
      this.weapon = null;
      this.model.setMount(null);
      return true;
    }
    return false;
  }

  /** Current smoothed rudder (-1..1) and throttle, sent to other players for the sailor animation. */
  get steerAmount(): number {
    return this.steer;
  }

  get throttleAmount(): number {
    return this.throttle;
  }

  private sink(dt: number, arena: Arena, time: number): void {
    this.sinkT += dt;
    const wy = waveHeight(this.x, this.z, time, arena.map.waveAmp);
    this.model.root.position.set(this.x, wy - this.sinkT * 1.2, this.z);
    this.model.tilt.rotation.x = Math.min(1.2, this.sinkT * 1.5);
    this.model.tilt.rotation.z = Math.min(0.6, this.sinkT * 0.8);
    if (this.sinkT > 2.2) this.model.root.visible = false;
  }

  update(dt: number, arena: Arena, time: number): number {
    if (!this.alive) {
      // Sinking animation, then respawn is handled by Game.
      this.respawnT -= dt;
      this.sink(dt, arena, time);
      return 0;
    }

    this.protectT = Math.max(0, this.protectT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.lastHitT = Math.max(0, this.lastHitT - dt);
    if (this.lastHitT <= 0) this.lastHitBy = null;
    if (this.weapon) this.weaponHeldT += dt;

    const inp = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;

    // Smooth the raw inputs: keyboard keys are on/off, this gives them analog-like ramps.
    // A harpooned boat is stunned: controls only partly respond.
    const stun = this.stunT > 0 ? 0.2 : 1;
    const steerIn = clamp(inp.steer, -1, 1) * stun;
    const recentring = Math.abs(steerIn) < Math.abs(this.steer) || steerIn * this.steer < 0;
    this.steer += (steerIn - this.steer) * damp(BOAT.steerResponse * (recentring ? 1.6 : 1), dt);
    const throttleIn = clamp(inp.throttle, -1, 1) * stun;
    this.throttle += (throttleIn - this.throttle) * damp(BOAT.throttleResponse, dt);
    const thr = this.throttle;

    // Forward thrust tapers as speed approaches the cap: punchy launch, smooth top end.
    const maxF = BOAT.maxSpeed;
    const prevVF = vF;
    if (thr > 0.02) {
      const t = clamp(vF / maxF, 0, 1);
      vF += thr * BOAT.accel * (1 - t * t) * dt;
    } else if (thr < -0.02) {
      if (vF > 0.3) vF += thr * BOAT.brake * dt;
      else {
        const t = clamp(-vF / BOAT.reverseSpeed, 0, 1);
        vF += thr * BOAT.reverseAccel * (1 - t * t) * dt;
      }
    }
    vF *= Math.exp(-(Math.abs(thr) < 0.05 ? BOAT.coastDrag : BOAT.baseDrag) * dt);
    // Knockbacks and pulls can push past the cap: bleed the excess off instead of hard-clamping.
    if (vF > maxF) vF += (maxF - vF) * damp(2.5, dt);
    if (vF < -BOAT.reverseSpeed) vF += (-BOAT.reverseSpeed - vF) * damp(2.5, dt);
    // Sideways slip decays: the hull slides a little through turns, like a real boat.
    // While paddling, part of that slide is carried into forward speed so corners keep their flow.
    // Only a share of the speed actually lost is restored, so turning is never faster than straight.
    const before = Math.hypot(vF, vL);
    vL *= Math.exp(-BOAT.lateralGrip * dt);
    if (thr > 0.02 && vF > 0) vF += (before - Math.hypot(vF, vL)) * BOAT.cornerCarry * thr;

    // Yaw with inertia. Turning authority depends on speed: the motor can pivot a stopped boat
    // slowly, it's sharpest at cruising speed and widens a bit above top speed.
    const s = Math.abs(vF) / BOAT.maxSpeed;
    const authority = 0.35 + 0.65 * Math.min(1, s / 0.45) - Math.max(0, s - 0.8) * 0.5;
    const dir = vF < -0.5 ? -1 : 1;
    const targetYaw = this.steer * BOAT.turnRate * authority * dir;
    this.yawRate += (targetYaw - this.yawRate) * damp(BOAT.turnResponse, dt);
    this.heading -= this.yawRate * dt;
    if (dt > 0) this.accelF += ((vF - prevVF) / dt - this.accelF) * damp(6, dt);

    this.vx = fx * vF + rx * vL;
    this.vz = fz * vF + rz * vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const v = { x: this.vx, z: this.vz };
    const p = { x: this.x, z: this.z };
    const impact = arena.resolve(p, v, this.radius, BOAT.bounce);
    this.x = p.x;
    this.z = p.z;
    this.vx = v.x;
    this.vz = v.z;

    this.present(dt, arena, time, vF, thr);
    return impact;
  }

  /** Wave riding (pitch/roll/bob), model placement, sailor animation and shield visuals. */
  private present(dt: number, arena: Arena, time: number, vF: number, thr: number): void {
    const amp = arena.map.waveAmp;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
    // Ride the waves: sample height under bow/stern/sides for pitch & roll.
    const h = waveHeight(this.x, this.z, time, amp);
    const hF = waveHeight(this.x + fx * 1.2, this.z + fz * 1.2, time, amp);
    const hB = waveHeight(this.x - fx * 1.2, this.z - fz * 1.2, time, amp);
    const hR = waveHeight(this.x + rx, this.z + rz, time, amp);
    const hL = waveHeight(this.x - rx, this.z - rz, time, amp);
    // Bow lifts when accelerating and dips when braking; hull leans into turns with centripetal force.
    const accelPitch = -clamp(this.accelF / BOAT.accel, -1, 1) * 0.07;
    const targetPitch = Math.atan2(hB - hF, 2.4) + accelPitch - clamp(vF / BOAT.maxSpeed, 0, 1.5) * 0.035;
    const lean = clamp((this.yawRate * vF) / (BOAT.turnRate * BOAT.maxSpeed), -1, 1) * 0.17;
    const targetRoll = Math.atan2(hL - hR, 2) + lean;
    const k = damp(6, dt);
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;
    this.y = h + RIDE_HEIGHT;

    const root = this.model.root;
    root.position.set(this.x, this.y, this.z);
    root.rotation.y = this.heading;
    this.model.tilt.rotation.set(this.pitch, 0, this.roll);
    this.model.animate(dt, vF, Math.abs(thr), this.steer, time);

    // Bubble shield: solid while the power-up lasts (fading out at the end), soft pulse for spawn protection.
    const sh = this.model.shield;
    sh.visible = this.shieldT > 0 || this.protectT > 0;
    if (sh.visible) {
      const o = this.shieldT > 0 ? Math.min(1, this.shieldT / 0.6) : 0.35 + 0.25 * Math.sin(time * 12);
      this.model.setShieldOpacity(o);
      sh.rotation.y += dt;
    }
  }

  // ---------------------------------------------------------------- network (remote boats)

  /** Owner's state for the network. */
  pose(): PoseMsg {
    const r = (v: number, d = 100) => Math.round(v * d) / d;
    const f = (this.alive ? POSE_ALIVE : 0) | (this.shieldT > 0 ? POSE_SHIELD : 0) | (this.protectT > 0 ? POSE_PROTECT : 0) | (this.stunT > 0 ? POSE_STUN : 0);
    return {
      id: this.netId, x: r(this.x), z: r(this.z), h: r(this.heading, 1000), vx: r(this.vx), vz: r(this.vz),
      hp: r(this.hp), f, w: this.weapon ?? '', s: r(this.steer), t: r(this.throttle),
    };
  }

  pushSnapshot(p: PoseMsg, at: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last) {
      if (at <= last.at) at = last.at + 1;
      // Respawned (or teleported): jump there instead of gliding across the map.
      const revived = !(last.f & POSE_ALIVE) && p.f & POSE_ALIVE;
      if (revived || (last.x - p.x) ** 2 + (last.z - p.z) ** 2 > 144) this.snaps.length = 0;
    }
    this.snaps.push({ ...p, at });
    if (this.snaps.length > 20) this.snaps.shift();
    if (p.hp !== this.hp) {
      this.hp = p.hp;
      this.drawLabel();
    }
  }

  /** The owner reported a hit on this (remote) boat. */
  showHit(hp: number, amount: number): void {
    if (amount >= 0.5 || Math.random() < 0.25) this.model.character.hit();
    if (hp !== this.hp) {
      this.hp = hp;
      this.drawLabel();
    }
  }

  get hasSnapshots(): boolean {
    return this.snaps.length > 0;
  }

  /**
   * Follows network poses: blends between the two around (now - delay), extrapolating briefly if late.
   * Returns true when the boat just respawned.
   */
  updateRemote(dt: number, arena: Arena, time: number, now: number): boolean {
    const snaps = this.snaps;
    if (!snaps.length) {
      this.model.root.visible = false;
      return false;
    }
    const latest = snaps[snaps.length - 1];
    const renderAt = now - INTERP_DELAY_MS;
    let a = snaps[0], b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].at <= renderAt) {
        a = snaps[i];
        b = snaps[Math.min(i + 1, snaps.length - 1)];
        break;
      }
    }
    if (renderAt >= latest.at) {
      const ahead = Math.min(0.25, (renderAt - latest.at) / 1000);
      this.x = latest.x + latest.vx * ahead;
      this.z = latest.z + latest.vz * ahead;
      this.heading = latest.h;
    } else if (a !== b) {
      const k = clamp((renderAt - a.at) / (b.at - a.at), 0, 1);
      this.x = a.x + (b.x - a.x) * k;
      this.z = a.z + (b.z - a.z) * k;
      this.heading = a.h + angleDiff(a.h, b.h) * k;
    } else {
      this.x = a.x;
      this.z = a.z;
      this.heading = a.h;
    }
    this.vx = latest.vx;
    this.vz = latest.vz;

    // Flags come from the newest pose so deaths and shields show up without delay.
    const alive = (latest.f & POSE_ALIVE) !== 0;
    const revived = alive && !this.alive;
    if (revived) {
      this.alive = true;
      this.sinkT = 0;
      this.pitch = this.roll = 0;
      this.model.tilt.rotation.set(0, 0, 0);
    } else if (!alive && this.alive) {
      this.alive = false;
      this.sinkT = 0;
      this.weapon = null;
      this.model.setMount(null);
    }
    this.shieldT = latest.f & POSE_SHIELD ? 1 : 0;
    this.protectT = latest.f & POSE_PROTECT ? 1 : 0;
    this.stunT = latest.f & POSE_STUN ? 1 : 0;
    const w = (latest.w || null) as WeaponId | null;
    if (w !== this.weapon) {
      this.weapon = w;
      this.model.setMount(w);
    }
    if (!this.alive) {
      this.sink(dt, arena, time);
      return false;
    }
    this.model.root.visible = true;
    this.steer += (latest.s - this.steer) * damp(10, dt);
    this.throttle += (latest.t - this.throttle) * damp(10, dt);
    this.yawRate = this.steer * BOAT.turnRate * 0.8;
    const vF = this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
    this.accelF *= Math.exp(-4 * dt);
    this.present(dt, arena, time, vF, this.throttle);
    return revived;
  }

  /** This machine takes over simulating a boat that was remote (e.g. became the bot host). */
  takeOver(): void {
    const latest = this.snaps[this.snaps.length - 1];
    if (latest && !(latest.f & POSE_ALIVE)) {
      this.alive = false;
      this.respawnT = 1;
    }
    // Whatever it was holding is used up after one more shot (the old owner knew the ammo count).
    this.ammo = this.weapon ? 1 : 0;
    this.shieldT = this.protectT = this.stunT = 0;
    this.snaps.length = 0;
    this.owned = true;
  }

  /** Name tag + health pips floating above rival boats (chunky outlined text, matching the HUD). */
  drawLabel(): void {
    const c = this.labelCanvas.getContext('2d');
    if (!c) return;
    const W = 256;
    c.clearRect(0, 0, W, 80);
    this.label.visible = !this.isPlayer && this.labelEnabled;
    c.font = '26px "Lilita One", "Arial Black", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = 7;
    c.strokeStyle = '#0b2a45';
    c.strokeText(this.name, W / 2, 24);
    c.fillStyle = '#ffffff';
    c.fillText(this.name, W / 2, 24);
    const w = 32, gap = 6, total = MAX_HP * w + (MAX_HP - 1) * gap;
    const x0 = W / 2 - total / 2;
    c.fillStyle = '#0b2a45';
    roundRect(c, x0 - 5, 44, total + 10, 22, 11);
    c.fill();
    for (let i = 0; i < MAX_HP; i++) {
      const sx = x0 + i * (w + gap);
      c.fillStyle = '#28415a';
      roundRect(c, sx, 48, w, 14, 7);
      c.fill();
      // Segments fill partially: bullets chip health away gradually.
      const f = Math.min(1, Math.max(0, this.hp - i));
      if (f > 0.02) {
        c.fillStyle = '#ff4d6d';
        roundRect(c, sx, 48, Math.max(8, w * f), 14, 7);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,0.45)';
        roundRect(c, sx + 4, 50, Math.max(2, w * f - 8), 4, 2);
        c.fill();
      }
    }
    // Player-colour dot so you can match tags to flags.
    c.fillStyle = '#' + this.color.toString(16).padStart(6, '0');
    c.beginPath();
    c.arc(x0 - 16, 55, 8, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#0b2a45';
    c.stroke();
    this.labelTex.needsUpdate = true;
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
