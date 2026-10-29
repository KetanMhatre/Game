import * as THREE from 'three';
import { BOAT, MAX_HP, WEAPONS, type WeaponId } from './config';
import { BoatModel } from './BoatModel';
import type { Arena } from './Arena';
import { clamp, damp } from './util';
import { waveHeight } from './waves';

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
  turboT = 0;
  cooldown = 0;
  weapon: WeaponId | null = null;
  ammo = 0;
  weaponHeldT = 0;

  kills = 0;
  deaths = 0;
  lastHitBy: Boat | null = null;
  lastHitT = 0;
  /** Per-target cooldown for turbo ramming damage. */
  ramCooldown = new Map<number, number>();

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
  ) {
    this.model = new BoatModel(color);
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 72;
    this.labelTex = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.labelTex, depthWrite: false, transparent: true }));
    this.label.scale.set(4, 1.125, 1);
    this.label.position.y = 2.9;
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
    this.turboT = 0;
    this.sinkT = 0;
    this.weapon = null;
    this.ammo = 0;
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
  }

  useAmmo(): void {
    this.ammo--;
    if (this.ammo <= 0) this.weapon = null;
  }

  /** Returns true if this hit killed the boat. */
  takeDamage(amount: number, from: Boat | null): boolean {
    if (!this.alive || this.invulnerable) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (from && from !== this) {
      this.lastHitBy = from;
      this.lastHitT = 4;
    }
    this.drawLabel();
    if (this.hp <= 0) {
      this.alive = false;
      this.sinkT = 0;
      this.deaths++;
      this.weapon = null;
      return true;
    }
    return false;
  }

  update(dt: number, arena: Arena, time: number): number {
    const amp = arena.map.waveAmp;
    if (!this.alive) {
      // Sinking animation, then respawn is handled by Game.
      this.sinkT += dt;
      this.respawnT -= dt;
      const wy = waveHeight(this.x, this.z, time, amp);
      this.model.root.position.set(this.x, wy - this.sinkT * 1.2, this.z);
      this.model.tilt.rotation.x = Math.min(1.2, this.sinkT * 1.5);
      this.model.tilt.rotation.z = Math.min(0.6, this.sinkT * 0.8);
      if (this.sinkT > 2.2) this.model.root.visible = false;
      return 0;
    }

    this.protectT = Math.max(0, this.protectT - dt);
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.turboT = Math.max(0, this.turboT - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.lastHitT = Math.max(0, this.lastHitT - dt);
    if (this.lastHitT <= 0) this.lastHitBy = null;
    if (this.weapon) this.weaponHeldT += dt;
    for (const [k, v] of this.ramCooldown) this.ramCooldown.set(k, v - dt);

    const inp = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * rx + this.vz * rz;

    const turbo = this.turboT > 0;

    // Smooth the raw inputs: keyboard keys are on/off, this gives them analog-like ramps.
    const steerIn = clamp(inp.steer, -1, 1);
    const recentring = Math.abs(steerIn) < Math.abs(this.steer) || steerIn * this.steer < 0;
    this.steer += (steerIn - this.steer) * damp(BOAT.steerResponse * (recentring ? 1.6 : 1), dt);
    const throttleIn = turbo ? 1 : clamp(inp.throttle, -1, 1);
    this.throttle += (throttleIn - this.throttle) * damp(BOAT.throttleResponse, dt);
    const thr = this.throttle;

    // Forward thrust tapers as speed approaches the cap: punchy launch, smooth top end.
    const maxF = BOAT.maxSpeed * (turbo ? BOAT.turboMultiplier : 1);
    const prevVF = vF;
    if (thr > 0.02) {
      const t = clamp(vF / maxF, 0, 1);
      vF += thr * BOAT.accel * (turbo ? BOAT.turboAccel : 1) * (1 - t * t) * dt;
    } else if (thr < -0.02) {
      if (vF > 0.3) vF += thr * BOAT.brake * dt;
      else {
        const t = clamp(-vF / BOAT.reverseSpeed, 0, 1);
        vF += thr * BOAT.reverseAccel * (1 - t * t) * dt;
      }
    }
    vF *= Math.exp(-(Math.abs(thr) < 0.05 ? BOAT.coastDrag : BOAT.baseDrag) * dt);
    // Knockbacks and turbo can push past the cap: bleed the excess off instead of hard-clamping.
    if (vF > maxF) vF += (maxF - vF) * damp(2.5, dt);
    if (vF < -BOAT.reverseSpeed) vF += (-BOAT.reverseSpeed - vF) * damp(2.5, dt);
    // Sideways slip decays: the hull slides a little through turns, like a real boat.
    // While paddling, part of that slide is carried into forward speed so corners keep their flow.
    // Only a share of the speed actually lost is restored, so turning is never faster than straight.
    const before = Math.hypot(vF, vL);
    vL *= Math.exp(-BOAT.lateralGrip * dt);
    if (thr > 0.02 && vF > 0) vF += (before - Math.hypot(vF, vL)) * BOAT.cornerCarry * thr;

    // Yaw with inertia. Turning authority depends on speed: paddles can pivot a stopped boat
    // slowly, it's sharpest at cruising speed and widens a bit at top speed / turbo.
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
    this.y = h + 0.42;

    const root = this.model.root;
    root.position.set(this.x, this.y, this.z);
    root.rotation.y = this.heading;
    this.model.tilt.rotation.set(this.pitch, 0, this.roll);
    this.model.animate(dt, vF, Math.abs(thr), time);

    const sh = this.model.shield;
    sh.visible = this.shieldT > 0 || (this.protectT > 0 && Math.floor(time * 10) % 2 === 0);
    if (sh.visible) sh.rotation.y += dt;

    return impact;
  }

  drawLabel(): void {
    const c = this.labelCanvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, 256, 72);
    this.label.visible = !this.isPlayer;
    c.font = 'bold 26px system-ui, sans-serif';
    c.textAlign = 'center';
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.strokeText(this.name, 128, 28);
    c.fillStyle = '#' + this.color.toString(16).padStart(6, '0');
    c.fillText(this.name, 128, 28);
    const w = 30, gap = 8, total = MAX_HP * w + (MAX_HP - 1) * gap;
    for (let i = 0; i < MAX_HP; i++) {
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(128 - total / 2 + i * (w + gap) - 2, 42, w + 4, 16);
      c.fillStyle = i < this.hp ? '#ff5252' : '#555';
      c.fillRect(128 - total / 2 + i * (w + gap), 44, w, 12);
    }
    this.labelTex.needsUpdate = true;
  }
}
