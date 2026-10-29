import * as THREE from 'three';
import { WEAPON_TUNING as T } from '../config';
import type { Boat } from '../Boat';
import type { Combat, Hazard, WeaponFx } from '../Combat';
import { animateCrate, crateModel, depthChargeModel, navalMineModel } from '../Models';
import { Sfx } from '../Audio';

const beaconIdle = new THREE.Color(0x7a1a1a);
const beaconLit = new THREE.Color(0xff2d2d);

/** Horned contact mine with a blinking beacon. The layer is safe from it for the first 1.5 s. */
export class NavalMine implements WeaponFx {
  private m = navalMineModel();
  private t = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private z: number,
  ) {
    this.m.obj.position.set(x, 0, z);
    this.m.ring.position.set(x, 0.05, z);
    c.group.add(this.m.obj, this.m.ring);
    c.host.particles.splash(x, 0, z, 0.6);
  }

  hazard(): Hazard {
    return { x: this.x, z: this.z, r: 3, owner: this.owner };
  }

  update(dt: number): boolean {
    const c = this.c, M = T.mines;
    this.t += dt;
    const wy = c.waveY(this.x, this.z);
    this.m.obj.position.y = wy + 0.05 + Math.sin(this.t * 3) * 0.08;
    this.m.obj.rotation.set(Math.sin(this.t * 1.4) * 0.12, this.t * 0.6, Math.cos(this.t * 1.2) * 0.1);
    this.m.ring.position.y = wy + 0.06;
    const armed = this.t > M.arm;
    const blink = armed ? Math.sin(this.t * 10) > 0 : Math.sin(this.t * 3) > 0.6;
    this.m.beaconMat.color.copy(blink ? beaconLit : beaconIdle);
    (this.m.ring.material as THREE.MeshBasicMaterial).opacity = armed ? 0.3 + 0.35 * (0.5 + 0.5 * Math.sin(this.t * 9)) : 0;
    if (this.t > M.life) {
      c.host.particles.splash(this.x, wy, this.z, 0.5);
      return false;
    }
    if (!armed) return true;
    for (const b of c.host.boats) {
      if (!b.alive || (b === this.owner && this.t < 1.5)) continue;
      if ((b.x - this.x) ** 2 + (b.z - this.z) ** 2 < (M.trigger + b.radius) ** 2) {
        c.explode(this.x, wy + 0.4, this.z, true);
        c.damageArea(this.x, this.z, M.blast, M.damage, this.owner, 'mines', M.knock, this.t < 1.5);
        return false;
      }
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.m.obj, this.m.ring);
    this.m.ring.geometry.dispose();
    (this.m.ring.material as THREE.Material).dispose();
    this.m.beaconMat.dispose();
  }
}

/** Looks exactly like a pickup crate (bar the red "?"). Blows up on whoever touches it, except its owner. */
export class FakeCrate implements WeaponFx {
  private m = crateModel(true);
  private t = 0;
  private p: Parameters<typeof animateCrate>[0];

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private z: number,
  ) {
    this.m.obj.position.set(x, 0, z);
    this.m.ring.position.set(x, 0.05, z);
    c.group.add(this.m.obj, this.m.ring);
    this.p = { x, z, obj: this.m.obj, crate: this.m.crate, badge: this.m.badge, ring: this.m.ring, appear: 0 };
  }

  hazard(): Hazard {
    return { x: this.x, z: this.z, r: 2.2, owner: this.owner, fake: true };
  }

  update(dt: number): boolean {
    const c = this.c, F = T.fakeCrate;
    this.t += dt;
    const wy = c.waveY(this.x, this.z);
    animateCrate(this.p, wy, c.time, dt);
    if (this.t > F.life) {
      c.host.particles.sparkle(this.x, wy + 1, this.z, 0xff8fa3);
      return false;
    }
    for (const b of c.host.boats) {
      if (!b.alive || b === this.owner) continue;
      if ((b.x - this.x) ** 2 + (b.z - this.z) ** 2 < (b.radius + 1.3) ** 2) {
        c.explode(this.x, wy + 0.6, this.z, true);
        c.damageArea(this.x, this.z, F.blast, F.damage, this.owner, 'fakeCrate', F.knock, true);
        Sfx.trap(c.host.listenerDist(this.x, this.z));
        return false;
      }
    }
    return true;
  }

  dispose(): void {
    this.c.group.remove(this.m.obj, this.m.ring);
  }
}

/** Sinks with a trail of bubbles, then erupts in a geyser that damages everything above it. */
export class DepthCharge implements WeaponFx {
  private mesh = depthChargeModel();
  private t = 0;
  private bubbleT = 0;

  constructor(
    private c: Combat,
    private owner: Boat,
    private x: number,
    private z: number,
    private fuse: number,
  ) {
    this.mesh.position.set(x, c.waveY(x, z), z);
    this.mesh.rotation.set(Math.random() * 0.6, Math.random() * 6, 0.4);
    c.group.add(this.mesh);
    c.host.particles.splash(x, c.waveY(x, z), z, 0.5);
  }

  hazard(): Hazard {
    return { x: this.x, z: this.z, r: T.depthCharges.blast, owner: this.owner };
  }

  update(dt: number): boolean {
    const c = this.c, D = T.depthCharges;
    this.t += dt;
    const wy = c.waveY(this.x, this.z);
    this.mesh.position.y = wy - Math.min(1.7, this.t * 1.6);
    this.mesh.rotation.x += dt * 1.5;
    this.mesh.rotation.z += dt * 0.8;
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 0.06;
      c.host.particles.emit(this.x, wy, this.z, 1, 0xeaf9ff, { speed: 0.8, up: 1.5, life: 0.4, size: 0.25, gravity: 2, alpha: 0.8 });
    }
    if (this.t < this.fuse) return true;
    // Geyser: a tall water column + foam, little fire (it's underwater).
    const P = c.host.particles;
    P.emit(this.x, wy, this.z, 26, 0xf2fbff, { speed: 2.5, up: 15, life: 1.1, size: 0.5, gravity: 18, spread: 1.2 });
    P.emit(this.x, wy, this.z, 10, 0xc9efff, { speed: 4, up: 1, life: 1.2, size: 1.4, gravity: 0, grow: 2.2, drag: 2.5, alpha: 0.7, spread: 1 });
    P.splash(this.x, wy, this.z, 1.6);
    const d = c.host.listenerDist(this.x, this.z);
    Sfx.depth(d);
    c.host.shake(0.45 * Math.max(0, 1 - d / 30));
    c.damageArea(this.x, this.z, D.blast, D.damage, this.owner, 'depthCharges', D.knock, true);
    return false;
  }

  dispose(): void {
    this.c.group.remove(this.mesh);
  }
}
