import * as THREE from 'three';
import { lambert } from './Arena';

// Procedural low-poly "nutshell" boat matching assets/boat-reference.png:
// an ellipsoidal half-shell hull, a thick rim, and curved ribs inside.
// Local space: +Z is the bow (forward), +Y up. Overall ~1.9 wide x 2.6 long.
// To swap in an artist-made GLB later, replace `hull` contents and keep the same orientation.

const HULL_OUT = 0xb5763c;
const HULL_IN = 0x9c6232;
const RIM = 0xdca561;

const HX = 0.95, HY = 0.62, HZ = 1.3;

let shared: { hullOut: THREE.BufferGeometry; hullIn: THREE.BufferGeometry; rim: THREE.BufferGeometry; ribs: THREE.BufferGeometry[] } | null = null;

function sharedGeometry() {
  if (shared) return shared;
  const hullOut = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  // Slight organic irregularity, applied identically to the inner surface.
  const pos = hullOut.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > -0.01) continue; // keep rim edge clean
    const k = 1 + Math.sin(i * 12.9898) * 0.035;
    pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
  }
  hullOut.scale(HX, HY, HZ);
  hullOut.computeVertexNormals();
  const hullIn = hullOut.clone();
  hullIn.scale(0.92, 0.9, 0.94);

  const rim = new THREE.TorusGeometry(1, 0.1, 4, 22);
  rim.rotateX(Math.PI / 2);
  rim.scale(HX * 0.97, 1.3, HZ * 0.97);

  const ribs: THREE.BufferGeometry[] = [];
  for (const zn of [-0.42, 0.05, 0.5]) {
    const s = Math.sqrt(1 - zn * zn);
    const rib = new THREE.TorusGeometry(1, 0.05, 3, 9, Math.PI);
    rib.rotateZ(Math.PI);
    rib.scale(HX * s * 0.86, HY * s * 0.86, 1);
    rib.translate(0, 0, zn * HZ * 0.9);
    ribs.push(rib);
  }
  shared = { hullOut, hullIn, rim, ribs };
  return shared;
}

export class BoatModel {
  /** Positioned/rotated by the Boat entity. */
  readonly root = new THREE.Group();
  /** Pitch/roll applied here so heading stays clean on root. */
  readonly tilt = new THREE.Group();
  readonly shield: THREE.Mesh;
  private paddles: THREE.Group[] = [];
  private flag: THREE.Mesh;
  private paddlePhase = Math.random() * 6;

  constructor(color: number) {
    const g = sharedGeometry();
    const outer = new THREE.Mesh(g.hullOut, lambert(HULL_OUT));
    const inner = new THREE.Mesh(g.hullIn, new THREE.MeshLambertMaterial({ color: HULL_IN, flatShading: true, side: THREE.BackSide }));
    const rim = new THREE.Mesh(g.rim, lambert(RIM));
    this.tilt.add(outer, inner, rim);
    for (const r of g.ribs) this.tilt.add(new THREE.Mesh(r, lambert(RIM)));

    // Sailor: a round little critter in the player's colour.
    const sailor = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), lambert(color));
    body.scale.set(1, 1.05, 0.95);
    body.position.y = 0.2;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), lambert(color));
    head.position.set(0, 0.78, 0.05);
    const eyeW = lambert(0xffffff), eyeB = lambert(0x222222);
    for (const sx of [-0.13, 0.13]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), eyeW);
      e.position.set(sx, 0.85, 0.33);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 3), eyeB);
      p.position.set(sx, 0.85, 0.41);
      sailor.add(e, p);
    }
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.16, 8), lambert(0xffffff));
    hat.position.set(0, 1.1, 0.02);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.05, 8), lambert(0x1e3a8a));
    band.position.set(0, 1.04, 0.02);
    sailor.add(body, head, hat, band);
    sailor.position.set(0, -0.15, -0.15);
    this.tilt.add(sailor);

    // Paddles on both sides.
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 4), lambert(0x8d6e63));
      shaft.position.y = -0.55;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.25), lambert(RIM));
      blade.position.y = -1.2;
      pivot.add(shaft, blade);
      pivot.position.set(side * 0.55, 0.55, -0.05);
      pivot.rotation.z = side * 0.9;
      pivot.userData.side = side;
      this.paddles.push(pivot);
      this.tilt.add(pivot);
    }

    // Stern mast + pennant to identify players at a glance.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.7, 4), lambert(0x6d4c41));
    mast.position.set(0.5, 0.75, -0.85);
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, -0.45, 0, 0, -0.22, -0.75], 3));
    flagGeo.computeVertexNormals();
    this.flag = new THREE.Mesh(flagGeo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, flatShading: true }));
    this.flag.position.set(0.5, 1.58, -0.85);
    this.tilt.add(mast, this.flag);

    // Bow cannon.
    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 6), lambert(0x37474f));
    cannon.rotation.x = Math.PI / 2;
    cannon.position.set(0, 0.25, 1.05);
    this.tilt.add(cannon);

    this.shield = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2, 1),
      new THREE.MeshPhongMaterial({ color: 0x9be7ff, transparent: true, opacity: 0.3, flatShading: true, shininess: 100, depthWrite: false }),
    );
    this.shield.position.y = 0.4;
    this.shield.visible = false;
    this.tilt.add(this.shield);

    this.root.add(this.tilt);
  }

  /** `effort` is 0..1 paddling input: strokes follow effort, not just speed, so coasting looks idle. */
  animate(dt: number, speed: number, effort: number, time: number): void {
    const s = Math.min(1, Math.abs(speed) / 11);
    const e = Math.max(effort, s * 0.25);
    this.paddlePhase += dt * (1.5 + e * 7.5) * (speed < -0.5 ? -1 : 1);
    for (const p of this.paddles) {
      const side = p.userData.side as number;
      p.rotation.x = Math.sin(this.paddlePhase) * 0.75 * (0.15 + e);
      p.rotation.z = side * (0.9 + Math.cos(this.paddlePhase) * 0.18 * e);
    }
    this.flag.rotation.y = Math.sin(time * 6 + this.paddlePhase) * 0.25;
  }
}
