import * as THREE from 'three';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { lambert, vertexColored } from './render/materials';
import { stripesTexture } from './render/textures';

export type SpeciesId = 'frog' | 'cat' | 'bear' | 'duck' | 'fox' | 'bunny' | 'panda' | 'penguin';

type Ears = 'none' | 'round' | 'cat' | 'fox' | 'bunny' | 'panda';
type Face = 'muzzle' | 'snout' | 'bill' | 'beak' | 'frog' | 'panda';

interface SpeciesDef {
  id: SpeciesId;
  name: string;
  fur: number;
  light: number;
  dark: number;
  ears: Ears;
  face: Face;
}

export const SPECIES: SpeciesDef[] = [
  { id: 'frog', name: 'Frog', fur: 0x6cc24a, light: 0xc8ef9a, dark: 0x2f5d1f, ears: 'none', face: 'frog' },
  { id: 'cat', name: 'Cat', fur: 0xf59e42, light: 0xffe6c7, dark: 0x5b3415, ears: 'cat', face: 'muzzle' },
  { id: 'bear', name: 'Bear', fur: 0xa06d45, light: 0xe8c9a0, dark: 0x3b2414, ears: 'round', face: 'muzzle' },
  { id: 'duck', name: 'Duck', fur: 0xffd23f, light: 0xfff1a8, dark: 0xff8c1a, ears: 'none', face: 'bill' },
  { id: 'fox', name: 'Fox', fur: 0xf06a2a, light: 0xfff4ea, dark: 0x3a1f10, ears: 'fox', face: 'snout' },
  { id: 'bunny', name: 'Bunny', fur: 0xf4f0ec, light: 0xffd0dc, dark: 0x6b5a55, ears: 'bunny', face: 'muzzle' },
  { id: 'panda', name: 'Panda', fur: 0xf7f7f4, light: 0xffffff, dark: 0x26262b, ears: 'panda', face: 'panda' },
  { id: 'penguin', name: 'Penguin', fur: 0x2d3446, light: 0xf8f8f4, dark: 0xff9f1c, ears: 'none', face: 'beak' },
];

export const speciesById = (id: string): SpeciesDef => SPECIES.find((s) => s.id === id) ?? SPECIES[0];

const BLUSH = 0xff8fa3;
const INK = 0x1d1d26;
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CAP = new THREE.CylinderGeometry(0.17, 0.2, 0.13, 18);
const CAP_BAND = new THREE.CylinderGeometry(0.205, 0.205, 0.045, 18);
const ARM = new THREE.CylinderGeometry(0.055, 0.065, 1, 8);
const SHAFT = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8);

// Head layout (head-local, +Z faces forward).
const HEAD_R = 0.34;
const SHOULDER_Y = 0.36;
const PADDLE_Y = 0.42;
const PADDLE_Z = 0.36;

const geoCache = new Map<string, { head: THREE.BufferGeometry; lids: THREE.BufferGeometry; paddle: THREE.BufferGeometry }>();

function eyeLayout(sp: SpeciesDef) {
  return sp.face === 'frog' ? { x: 0.14, y: 0.21, z: 0.17 } : { x: 0.125, y: 0.05, z: 0.265 };
}

function buildHead(sp: SpeciesDef, outfit: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const S = UNIT.sphere;
  b.add(S, sp.fur, mat(0, 0, 0, 0, 0, 0, HEAD_R, HEAD_R * 0.95, HEAD_R * 0.92));
  const e = eyeLayout(sp);

  if (sp.face === 'frog') {
    for (const sx of [-1, 1]) b.add(S, sp.fur, mat(sx * e.x, e.y - 0.02, e.z - 0.05, 0, 0, 0, 0.12));
    b.add(S, sp.light, mat(0, -0.12, 0.18, 0, 0, 0, 0.22, 0.12, 0.14));
    // Mouths are dark ovals sunk into the face: only a thin line pokes out, so they always hug the surface.
    b.add(S, INK, mat(0, -0.075, 0.255, 0.25, 0, 0, 0.15, 0.022, 0.06));
  }
  if (sp.face === 'panda') {
    for (const sx of [-1, 1]) b.add(S, sp.dark, mat(sx * 0.13, 0.035, 0.235, 0, 0, sx * 0.55, 0.1, 0.125, 0.07));
  }
  if (sp.face === 'beak') {
    b.add(S, sp.light, mat(0, -0.03, 0.12, 0, 0, 0, 0.27, 0.25, 0.24));
  }

  // Eyes: white, pupil, glint.
  for (const sx of [-1, 1]) {
    b.add(S, 0xffffff, mat(sx * e.x, e.y, e.z, 0, 0, 0, 0.085, 0.097, 0.062));
    b.add(S, INK, mat(sx * e.x * 1.03, e.y - 0.006, e.z + 0.045, 0, 0, 0, 0.05, 0.06, 0.03));
    b.add(S, 0xffffff, mat(sx * e.x + 0.02, e.y + 0.026, e.z + 0.072, 0, 0, 0, 0.018));
  }

  switch (sp.face) {
    case 'muzzle':
    case 'panda':
      b.add(S, sp.face === 'panda' ? 0xffffff : sp.light, mat(0, -0.095, 0.24, 0, 0, 0, 0.15, 0.1, 0.12));
      b.add(S, sp.id === 'cat' || sp.id === 'bunny' ? 0xff7a93 : INK, mat(0, -0.055, 0.355, 0, 0, 0, 0.045, 0.032, 0.03));
      b.add(S, INK, mat(0, -0.125, 0.33, 0.3, 0, 0, 0.045, 0.016, 0.03));
      break;
    case 'snout':
      b.add(S, sp.light, mat(0, -0.085, 0.27, 0, 0, 0, 0.12, 0.09, 0.17));
      b.add(S, INK, mat(0, -0.06, 0.43, 0, 0, 0, 0.042, 0.034, 0.03));
      break;
    case 'bill':
      b.add(S, sp.dark, mat(0, -0.075, 0.3, 0, 0, 0, 0.16, 0.05, 0.15));
      b.add(CONE, sp.fur, mat(0, 0.34, -0.02, -0.3, 0, 0, 0.06, 0.14, 0.06));
      break;
    case 'beak':
      b.add(CONE, sp.dark, mat(0, -0.06, 0.37, Math.PI / 2, 0, 0, 0.065, 0.17, 0.05));
      break;
  }

  if (sp.face !== 'beak' && sp.face !== 'bill') {
    for (const sx of [-1, 1]) b.add(S, BLUSH, mat(sx * 0.2, -0.07, 0.215, 0, sx * 0.5, 0, 0.055, 0.034, 0.025));
  }

  for (const sx of [-1, 1]) {
    switch (sp.ears) {
      case 'round':
      case 'panda':
        b.add(S, sp.ears === 'panda' ? sp.dark : sp.fur, mat(sx * 0.23, 0.24, -0.03, 0, 0, 0, 0.105, 0.105, 0.065));
        if (sp.ears === 'round') b.add(S, sp.light, mat(sx * 0.23, 0.24, 0.01, 0, 0, 0, 0.06, 0.06, 0.03));
        break;
      case 'cat':
        b.add(CONE, sp.fur, mat(sx * 0.17, 0.31, -0.02, 0, 0, -sx * 0.35, 0.105, 0.22, 0.07));
        b.add(CONE, 0xff9fb2, mat(sx * 0.165, 0.3, 0.02, 0, 0, -sx * 0.35, 0.06, 0.15, 0.03));
        break;
      case 'fox':
        b.add(CONE, sp.fur, mat(sx * 0.17, 0.34, -0.02, 0, 0, -sx * 0.3, 0.115, 0.29, 0.07));
        b.add(CONE, sp.dark, mat(sx * 0.2, 0.46, -0.02, 0, 0, -sx * 0.3, 0.045, 0.08, 0.04));
        b.add(CONE, sp.light, mat(sx * 0.165, 0.32, 0.02, 0, 0, -sx * 0.3, 0.06, 0.18, 0.03));
        break;
      case 'bunny':
        b.add(S, sp.fur, mat(sx * 0.1, 0.48, -0.04, 0, 0, -sx * 0.12, 0.065, 0.24, 0.045));
        b.add(S, sp.light, mat(sx * 0.1, 0.48, -0.005, 0, 0, -sx * 0.12, 0.035, 0.18, 0.02));
        break;
    }
  }

  // Sailor cap with a band in the player's colour.
  b.add(CAP, 0xffffff, mat(0, 0.31, -0.03, -0.18, 0, 0, 1));
  b.add(CAP_BAND, outfit, mat(0, 0.27, -0.02, -0.18, 0, 0, 1));
  return b.build();
}

/** Eyelids: fur-coloured shells over the eyes, shown only while blinking. */
function buildLids(sp: SpeciesDef): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const e = eyeLayout(sp);
  for (const sx of [-1, 1]) b.add(UNIT.sphere, sp.face === 'panda' ? sp.dark : sp.fur, mat(sx * e.x, e.y, e.z + 0.004, 0, 0, 0, 0.092, 0.104, 0.07));
  return b.build();
}

function buildPaddle(sp: SpeciesDef, outfit: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(SHAFT, 0xc8925a, mat(0, 0, 0, 0, 0, Math.PI / 2));
  for (const sx of [-1, 1]) {
    b.add(UNIT.sphere, outfit, mat(sx * 1.17, 0, 0, 0, 0, 0, 0.25, 0.135, 0.032));
    b.add(UNIT.sphere, 0xffffff, mat(sx * 1.0, 0, 0, 0, 0, 0, 0.06, 0.07, 0.036));
    b.add(UNIT.sphere, sp.face === 'beak' ? sp.dark : sp.fur, mat(sx * 0.3, 0, 0, 0, 0, 0, 0.078));
  }
  return b.build();
}

function geometries(sp: SpeciesDef, outfit: number) {
  const key = `${sp.id}-${outfit}`;
  let g = geoCache.get(key);
  if (!g) {
    g = { head: buildHead(sp, outfit), lids: buildLids(sp), paddle: buildPaddle(sp, outfit) };
    geoCache.set(key, g);
  }
  return g;
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** A cartoon animal sailor sitting in the boat, paddling with a kayak paddle. Local +Z = forward. */
export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private lids: THREE.Mesh;
  private paddle: THREE.Mesh;
  private arms: THREE.Mesh[] = [];
  private phase = Math.random() * 6;
  private blinkT = 1 + Math.random() * 3;
  private hitT = 0;
  private cheerT = 0;
  private time = 0;

  constructor(species: SpeciesId, outfit: number) {
    const sp = speciesById(species);
    const g = geometries(sp, outfit);

    const torso = new THREE.Mesh(UNIT.sphereHi, lambert(0xffffff, { map: stripesTexture(outfit) }));
    torso.scale.set(0.3, 0.33, 0.27);
    torso.position.y = 0.2;
    const belly =
      sp.face === 'beak' ? new THREE.Mesh(UNIT.sphere, lambert(sp.light)) : null;
    if (belly) {
      belly.scale.set(0.2, 0.22, 0.12);
      belly.position.set(0, 0.17, 0.17);
    }
    const headMesh = new THREE.Mesh(g.head, vertexColored);
    this.lids = new THREE.Mesh(g.lids, vertexColored);
    this.lids.visible = false;
    this.head.add(headMesh, this.lids);
    this.head.position.y = 0.72;
    this.body.add(torso, this.head);
    if (belly) this.body.add(belly);

    this.paddle = new THREE.Mesh(g.paddle, vertexColored);
    this.paddle.position.set(0, PADDLE_Y, PADDLE_Z);
    this.body.add(this.paddle);

    const sleeve = lambert(outfit);
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(ARM, sleeve);
      this.arms.push(arm);
      this.body.add(arm);
    }
    this.root.add(this.body);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    this.lids.castShadow = false;
  }

  hit(): void {
    this.hitT = 0.7;
  }

  cheer(): void {
    this.cheerT = 1.1;
  }

  /** effort: paddling input 0..1, steer: -1..1 (+ = right), speed in u/s. */
  update(dt: number, effort: number, steer: number, speed: number): void {
    this.time += dt;
    const t = this.time;
    this.phase += dt * (1.6 + effort * 6.8) * (speed < -0.5 ? -1 : 1);

    // Paddle: one blade dips while the other lifts, with a sweeping stroke.
    const dip = Math.sin(this.phase);
    const amt = 0.22 + effort * 0.55;
    let py = PADDLE_Y + Math.abs(dip) * 0.03, pz = PADDLE_Z;
    let rz = dip * amt;
    let ry = Math.cos(this.phase) * 0.35 * (0.3 + effort);
    this.body.position.y = Math.sin(t * 2.2) * 0.012;
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);

    if (this.cheerT > 0) {
      // Hop and raise the paddle overhead.
      this.cheerT = Math.max(0, this.cheerT - dt);
      const k = Math.sin((1 - this.cheerT / 1.1) * Math.PI);
      this.body.position.y += Math.abs(Math.sin(this.cheerT * 9)) * 0.18 * k;
      py += 0.55 * k;
      pz -= 0.15 * k;
      rz = Math.sin(t * 14) * 0.15 * k + rz * (1 - k);
      ry *= 1 - k;
    }
    if (this.hitT > 0) {
      // Squash and wobble.
      this.hitT = Math.max(0, this.hitT - dt);
      const k = this.hitT / 0.7;
      this.body.rotation.z = Math.sin(this.hitT * 30) * 0.25 * k;
      this.body.scale.set(1 + 0.18 * k, 1 - 0.2 * k, 1 + 0.18 * k);
    }

    this.paddle.position.set(0, py, pz);
    this.paddle.rotation.set(0, ry, rz);
    this.head.rotation.set(Math.sin(t * 1.7) * 0.04, -steer * 0.35, -steer * 0.08 + (this.hitT > 0 ? Math.sin(this.hitT * 40) * 0.3 : 0));
    this.body.rotation.z += -steer * 0.06;

    // Arms reach from the shoulders to the hands on the paddle shaft.
    this.paddle.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const hand = _v.set(sx * 0.3, 0, 0).applyMatrix4(this.paddle.matrix);
      const shoulder = new THREE.Vector3(sx * 0.25, SHOULDER_Y, 0.05);
      const dir = hand.clone().sub(shoulder);
      const len = dir.length();
      const arm = this.arms[i];
      arm.position.copy(shoulder).add(hand).multiplyScalar(0.5);
      arm.quaternion.setFromUnitVectors(_up, dir.divideScalar(len || 1));
      arm.scale.set(1, len, 1);
    }

    // Blink every few seconds.
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.lids.visible = this.blinkT > -0.12;
      if (this.blinkT < -0.12) this.blinkT = 1.5 + Math.random() * 3.5;
    }
    if (this.hitT > 0) this.lids.visible = true;
  }
}
