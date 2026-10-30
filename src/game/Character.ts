import * as THREE from 'three';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { lambert, vertexColored } from './render/materials';

// Big-head cartoon sailors: an oversized head sitting right on the boat, bulging googly eyes,
// wide open grins, black rubber-hose arms and white puffy gloves on the paddle.
// Local space: +Z faces forward. The head is built in head-local space (origin = head centre).

export type SpeciesId = 'otter' | 'shark' | 'crab' | 'walrus' | 'octopus' | 'seagull' | 'hippo' | 'frog';

type Vec3 = [number, number, number];

interface SpeciesDef {
  id: SpeciesId;
  name: string;
  kind: string;
  skin: number;
  /** Head ellipsoid scale relative to HEAD_R. */
  scale: Vec3;
  build: (k: HeadKit) => EyeSpec[];
}

interface EyeSpec {
  pos: THREE.Vector3;
  size: Vec3;
}

const HEAD_R = 0.5;
const INK = 0x1d1d26;
const MOUTH = 0x4a0f1e;
const TONGUE = 0xff6f91;
const TOOTH = 0xffffff;
const BLUSH = 0xff8fa3;
const SLEEVE = 0x23232b;
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const ARM = new THREE.CylinderGeometry(0.045, 0.05, 1, 8);
const SHAFT = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8);

// Body layout (character-local).
const SHOULDER_Y = 0.3;
const PADDLE_Y = 0.4;
const PADDLE_Z = 0.62;
const HAND_X = 0.34;

/** Helpers for placing features on an ellipsoidal head. */
class HeadKit {
  constructor(
    readonly b: GeoBuilder,
    readonly skin: number,
    readonly s: Vec3,
  ) {}

  /** Point on the head surface in direction (dx,dy,dz), pushed out by `out` (negative = sunk in). */
  at(dx: number, dy: number, dz: number, out = 0): THREE.Vector3 {
    const d = new THREE.Vector3(dx, dy, dz).normalize();
    const t = HEAD_R / Math.sqrt((d.x / this.s[0]) ** 2 + (d.y / this.s[1]) ** 2 + (d.z / this.s[2]) ** 2);
    return d.multiplyScalar(t + out);
  }

  blob(color: number, p: THREE.Vector3, size: Vec3, rot: Vec3 = [0, 0, 0], geo: THREE.BufferGeometry = UNIT.sphere): void {
    this.b.add(geo, color, mat(p.x, p.y, p.z, rot[0], rot[1], rot[2], size[0], size[1], size[2]));
  }

  /** Mirrored pair (x and -x). Rotation y/z flip with the side. */
  pair(color: number, p: THREE.Vector3, size: Vec3, rot: Vec3 = [0, 0, 0], geo: THREE.BufferGeometry = UNIT.sphere): void {
    for (const sx of [-1, 1]) {
      this.b.add(geo, color, mat(p.x * sx, p.y, p.z, rot[0], rot[1] * sx, rot[2] * sx, size[0], size[1], size[2]));
    }
  }

  /** Standard googly eyes: big tall ovals, nearly touching, bulging out of the face. */
  eyes(dir: Vec3, size: Vec3 = [0.15, 0.185, 0.11]): EyeSpec[] {
    const p = this.at(dir[0], dir[1], dir[2], -0.035);
    return [-1, 1].map((sx) => ({ pos: new THREE.Vector3(p.x * sx, p.y, p.z), size }));
  }

  /** Open grin: a dark cavity sunk into the face (only its rim pokes out), tongue and teeth. */
  grin(dir: Vec3, w: number, h: number, opts: { tongue?: boolean; teeth?: 'row' | 'fangs' | 'none'; tilt?: number } = {}): void {
    const p = this.at(dir[0], dir[1], dir[2], -0.07);
    const tilt = opts.tilt ?? 0.35;
    this.blob(MOUTH, p, [0.27 * w, 0.16 * h, 0.11], [tilt, 0, 0]);
    if (opts.tongue !== false) this.blob(TONGUE, p.clone().add(new THREE.Vector3(0, -0.045 * h, 0.035)), [0.17 * w, 0.08 * h, 0.08], [tilt, 0, 0]);
    const teeth = opts.teeth ?? 'row';
    if (teeth === 'row') {
      this.blob(TOOTH, p.clone().add(new THREE.Vector3(0, 0.075 * h, 0.03)), [0.21 * w, 0.036, 0.06], [tilt, 0, 0]);
    } else if (teeth === 'fangs') {
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1) - 0.5) * 0.36 * w;
        const top = p.clone().add(new THREE.Vector3(x, 0.08 * h, 0.06 - Math.abs(x) * 0.25));
        this.b.add(CONE, TOOTH, mat(top.x, top.y, top.z, Math.PI, 0, 0, 0.03, 0.07, 0.03));
        if (i > 0 && i < n - 1) {
          const bot = p.clone().add(new THREE.Vector3(x, -0.085 * h, 0.06 - Math.abs(x) * 0.25));
          this.b.add(CONE, TOOTH, mat(bot.x, bot.y, bot.z, 0, 0, 0, 0.026, 0.06, 0.026));
        }
      }
    }
  }

  cheeks(dir: Vec3 = [0.6, -0.25, 0.75]): void {
    const p = this.at(dir[0], dir[1], dir[2], -0.01);
    this.pair(BLUSH, p, [0.07, 0.045, 0.03], [0, 0.6, 0]);
  }

  sailorCap(band: number, tilt = -0.2, y = 0.98): void {
    const top = this.at(0, 1, -0.15, -0.04);
    this.b.add(new THREE.CylinderGeometry(0.2, 0.23, 0.15, 18), 0xffffff, mat(top.x, top.y + 0.04 + (y - 0.98), top.z, tilt, 0, 0.12));
    this.b.add(new THREE.CylinderGeometry(0.235, 0.235, 0.05, 18), band, mat(top.x, top.y - 0.01 + (y - 0.98), top.z, tilt, 0, 0.12));
  }
}

export const SPECIES: SpeciesDef[] = [
  {
    id: 'otter',
    name: 'Pip',
    kind: 'Otter',
    skin: 0x9b6b45,
    scale: [1, 0.95, 0.95],
    build: (k) => {
      k.pair(k.skin, k.at(0.62, 0.7, 0.05), [0.11, 0.11, 0.08]);
      k.pair(0xf3c1a8, k.at(0.62, 0.7, 0.05, 0.03), [0.06, 0.06, 0.04]);
      const muzzle = k.at(0, -0.3, 1, -0.12);
      k.blob(0xf3dcc0, muzzle, [0.25, 0.17, 0.17]);
      k.blob(0x2a1a12, muzzle.clone().add(new THREE.Vector3(0, 0.1, 0.15)), [0.08, 0.055, 0.05]);
      k.grin([0, -0.44, 0.9], 0.95, 0.95, { teeth: 'none' });
      // Buck teeth.
      const t = k.at(0, -0.36, 0.93, 0.02);
      k.pair(TOOTH, new THREE.Vector3(0.028, t.y, t.z), [0.026, 0.04, 0.018], [0, 0, 0], BOX);
      // Whiskers.
      for (const [y, a] of [[0.02, 0.12], [-0.03, -0.08]]) {
        const w = muzzle.clone().add(new THREE.Vector3(0.24, y, 0.06));
        k.pair(0x3a2a20, w, [0.006, 0.2, 0.006], [0, 0, Math.PI / 2 + a], CYL);
      }
      k.cheeks();
      return k.eyes([0.3, 0.38, 0.87]);
    },
  },
  {
    id: 'shark',
    name: 'Chomp',
    kind: 'Shark',
    skin: 0x5d8db5,
    scale: [0.95, 0.95, 1.12],
    build: (k) => {
      k.blob(0xeef3f7, new THREE.Vector3(0, -0.2, 0.12), [0.38, 0.27, 0.43]);
      k.grin([0, -0.3, 0.95], 1.3, 1.1, { teeth: 'fangs', tongue: false });
      const fin = k.at(0, 1, -0.2, -0.05);
      k.blob(k.skin, fin.clone().add(new THREE.Vector3(0, 0.17, -0.08)), [0.07, 0.46, 0.32], [-0.55, 0, 0], CONE);
      for (let i = 0; i < 3; i++) {
        const g = k.at(1, -0.05, -0.15 - i * 0.18, -0.005);
        k.pair(0x34597a, g, [0.012, 0.13, 0.03], [0, 0, 0], BOX);
      }
      // Angry brows.
      const brow = k.at(0.25, 0.62, 0.75, 0.02);
      k.pair(0x2c4a66, brow, [0.15, 0.035, 0.05], [0, 0, -0.35], BOX);
      return k.eyes([0.28, 0.33, 0.9], [0.14, 0.17, 0.11]);
    },
  },
  {
    id: 'crab',
    name: 'Snips',
    kind: 'Crab',
    skin: 0xff5a3c,
    scale: [1.25, 0.78, 0.95],
    build: (k) => {
      // Shell bumps.
      for (const [x, z] of [[0.3, -0.2], [-0.3, -0.25], [0, -0.4], [0.5, 0.05], [-0.5, 0.0]]) {
        k.blob(0xe0442a, k.at(x, 0.7, z, -0.02), [0.07, 0.04, 0.07]);
      }
      k.grin([0, -0.2, 1], 1.35, 0.9, { teeth: 'row' });
      k.cheeks([0.62, -0.1, 0.78]);
      // Eye stalks: googly eyes perched on top.
      const base = k.at(0.22, 0.85, 0.45, -0.03);
      k.pair(k.skin, base.clone().add(new THREE.Vector3(0, 0.13, 0)), [0.045, 0.26, 0.045], [0.1, 0, 0.1], CYL);
      const eye = base.clone().add(new THREE.Vector3(0.03, 0.31, 0.02));
      return [-1, 1].map((sx) => ({ pos: new THREE.Vector3(eye.x * sx, eye.y, eye.z), size: [0.13, 0.15, 0.12] as Vec3 }));
    },
  },
  {
    id: 'walrus',
    name: 'Gus',
    kind: 'Walrus',
    skin: 0xa8846a,
    scale: [1.1, 0.95, 1.0],
    build: (k) => {
      // Captain's hat.
      const top = k.at(0, 1, -0.1, -0.06);
      k.b.add(new THREE.CylinderGeometry(0.3, 0.27, 0.16, 20), 0x1f3b63, mat(top.x, top.y + 0.04, top.z, -0.12, 0, 0));
      k.b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.07, 20), 0xffffff, mat(top.x, top.y + 0.15, top.z - 0.01, -0.12, 0, 0));
      k.b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16, 1, false, -Math.PI / 2, Math.PI), 0x111418, mat(top.x, top.y - 0.03, top.z + 0.2, -0.3, 0, 0));
      k.blob(0xffc93c, new THREE.Vector3(top.x, top.y + 0.06, top.z + 0.28), [0.05, 0.05, 0.03]);
      // Mustache muzzle, pink nose, tusks.
      const m = k.at(0, -0.3, 1, -0.08);
      k.pair(0xeadcc6, new THREE.Vector3(0.11, m.y, m.z), [0.16, 0.13, 0.13]);
      k.blob(0xe58b8b, m.clone().add(new THREE.Vector3(0, 0.1, 0.1)), [0.07, 0.05, 0.05]);
      k.pair(0xfffaf0, new THREE.Vector3(0.09, m.y - 0.2, m.z + 0.04), [0.035, 0.16, 0.035], [Math.PI, 0, 0.12], CONE);
      k.grin([0, -0.55, 0.83], 0.8, 0.8, { teeth: 'row' });
      // Bushy brows.
      k.pair(0xeadcc6, k.at(0.27, 0.55, 0.8, 0.02), [0.12, 0.04, 0.05], [0, 0, 0.25]);
      return k.eyes([0.28, 0.3, 0.9], [0.13, 0.16, 0.1]);
    },
  },
  {
    id: 'octopus',
    name: 'Inka',
    kind: 'Octopus',
    skin: 0xff7f8a,
    scale: [1.0, 1.18, 0.95],
    build: (k) => {
      for (const [x, y, z, r] of [[0.4, 0.6, -0.2, 0.06], [-0.35, 0.75, -0.1, 0.05], [0.1, 0.85, -0.4, 0.07], [-0.55, 0.3, -0.3, 0.05], [0.6, 0.2, -0.35, 0.05]]) {
        k.blob(0xe0566a, k.at(x, y, z, -0.01), [r, r * 0.6, r]);
      }
      k.grin([0, -0.32, 0.95], 0.8, 1.0, { teeth: 'row' });
      k.cheeks([0.58, -0.28, 0.76]);
      // Curly tentacles peeking out under the head.
      for (const [x, z, a] of [[0.36, 0.25, 0.4], [-0.36, 0.25, -0.4], [0.18, 0.4, 0.15], [-0.18, 0.4, -0.15]]) {
        const p = k.at(x * 1.4, -0.62, z + 0.35, -0.05);
        k.blob(k.skin, p, [0.09, 0.09, 0.09], [Math.PI / 2, a, 0], new THREE.TorusGeometry(1, 0.42, 8, 12, Math.PI * 1.3));
      }
      k.sailorCap(0x3fa9ff, -0.3, 1.06);
      return k.eyes([0.29, 0.22, 0.93]);
    },
  },
  {
    id: 'seagull',
    name: 'Gale',
    kind: 'Seagull',
    skin: 0xf8f8f4,
    scale: [0.95, 1.0, 0.95],
    build: (k) => {
      // Beak, slightly open.
      const b = k.at(0, -0.12, 1, -0.06);
      k.blob(0xffb030, b.clone().add(new THREE.Vector3(0, 0.02, 0.14)), [0.11, 0.3, 0.09], [Math.PI / 2 + 0.15, 0, 0], CONE);
      k.blob(0xf08a1c, b.clone().add(new THREE.Vector3(0, -0.07, 0.1)), [0.085, 0.22, 0.06], [Math.PI / 2 - 0.2, 0, 0], CONE);
      k.blob(0xe8443a, b.clone().add(new THREE.Vector3(0, -0.1, 0.19)), [0.03, 0.03, 0.03]);
      // Feather tuft and grey nape.
      for (const [x, a] of [[0, 0], [0.08, 0.3], [-0.08, -0.3]]) {
        const p = k.at(x, 1, -0.4, -0.02);
        k.blob(0xb9c2cc, p.clone().add(new THREE.Vector3(0, 0.06, 0)), [0.045, 0.16, 0.045], [-0.6, 0, a], CONE);
      }
      k.blob(0xc9d1d9, k.at(0, 0.2, -1, -0.15), [0.38, 0.36, 0.2]);
      k.cheeks([0.55, -0.15, 0.8]);
      k.sailorCap(0x1f3b63, -0.25);
      return k.eyes([0.32, 0.3, 0.89]);
    },
  },
  {
    id: 'hippo',
    name: 'Bubba',
    kind: 'Hippo',
    skin: 0xa98bd6,
    scale: [1.12, 0.95, 1.0],
    build: (k) => {
      k.pair(k.skin, k.at(0.45, 0.85, -0.15), [0.09, 0.07, 0.06]);
      k.pair(0xf3a9c1, k.at(0.45, 0.85, -0.12, 0.025), [0.05, 0.04, 0.03]);
      const s = k.at(0, -0.32, 1, -0.13);
      k.blob(0xc8b5ec, s, [0.36, 0.22, 0.25]);
      k.pair(0x5b4580, s.clone().add(new THREE.Vector3(0.11, 0.13, 0.17)), [0.045, 0.03, 0.03], [0.5, 0, 0]);
      k.grin([0, -0.6, 0.8], 1.2, 0.9, { teeth: 'none' });
      const m = k.at(0, -0.6, 0.8, -0.04);
      k.pair(TOOTH, new THREE.Vector3(0.09, m.y - 0.03, m.z + 0.04), [0.04, 0.06, 0.03], [0, 0, 0], BOX);
      k.cheeks([0.66, -0.15, 0.72]);
      return k.eyes([0.3, 0.55, 0.78], [0.14, 0.17, 0.1]);
    },
  },
  {
    id: 'frog',
    name: 'Hopper',
    kind: 'Frog',
    skin: 0x62c24a,
    scale: [1.15, 0.85, 1.0],
    build: (k) => {
      k.blob(0xc9ef9a, new THREE.Vector3(0, -0.2, 0.1), [0.4, 0.2, 0.38]);
      const bump = k.at(0.42, 0.75, 0.4, -0.06);
      k.pair(k.skin, bump, [0.17, 0.16, 0.16]);
      k.grin([0, -0.2, 1], 1.6, 0.85, { teeth: 'none' });
      k.cheeks([0.66, -0.1, 0.74]);
      const eye = bump.clone().add(new THREE.Vector3(0.01, 0.06, 0.1));
      return [-1, 1].map((sx) => ({ pos: new THREE.Vector3(eye.x * sx, eye.y, eye.z), size: [0.14, 0.16, 0.12] as Vec3 }));
    },
  },
];

export const speciesById = (id: string): SpeciesDef => SPECIES.find((s) => s.id === id) ?? SPECIES[0];

// ---------------------------------------------------------------- geometry assembly (cached per species+colour)

interface CharGeo {
  head: THREE.BufferGeometry;
  pupils: THREE.BufferGeometry;
  lids: THREE.BufferGeometry;
  paddle: THREE.BufferGeometry;
  headY: number;
}
const geoCache = new Map<string, CharGeo>();

function geometries(sp: SpeciesDef, outfit: number): CharGeo {
  const key = `${sp.id}-${outfit}`;
  let g = geoCache.get(key);
  if (g) return g;
  const head = new GeoBuilder();
  head.add(UNIT.sphereHi, sp.skin, mat(0, 0, 0, 0, 0, 0, HEAD_R * sp.scale[0], HEAD_R * sp.scale[1], HEAD_R * sp.scale[2]));
  const kit = new HeadKit(head, sp.skin, sp.scale);
  const eyes = sp.build(kit);

  const pupils = new GeoBuilder();
  const lids = new GeoBuilder();
  for (const e of eyes) {
    const [sx, sy, sz] = e.size;
    head.add(UNIT.sphereHi, 0xffffff, mat(e.pos.x, e.pos.y, e.pos.z, 0, 0, 0, sx, sy, sz));
    // Pupils sit on the front of the eye, nudged inward for a goofy cross-eyed look.
    const p = e.pos.clone().add(new THREE.Vector3(-Math.sign(e.pos.x) * sx * 0.12, -sy * 0.05, sz * 0.82));
    pupils.add(UNIT.sphere, INK, mat(p.x, p.y, p.z, 0, 0, 0, sx * 0.5, sy * 0.5, sz * 0.4));
    pupils.add(UNIT.sphere, 0xffffff, mat(p.x + sx * 0.18, p.y + sy * 0.2, p.z + sz * 0.3, 0, 0, 0, sx * 0.16));
    lids.add(UNIT.sphere, sp.skin, mat(e.pos.x, e.pos.y, e.pos.z + 0.005, 0, 0, 0, sx * 1.08, sy * 1.08, sz * 1.12));
  }

  // Paddle with white puffy gloves on the shaft.
  const paddle = new GeoBuilder();
  paddle.add(SHAFT, 0xc8925a, mat(0, 0, 0, 0, 0, Math.PI / 2));
  for (const sx of [-1, 1]) {
    paddle.add(UNIT.sphere, outfit, mat(sx * 1.17, 0, 0, 0, 0, 0, 0.25, 0.135, 0.032));
    paddle.add(UNIT.sphere, 0xffffff, mat(sx * 1.0, 0, 0, 0, 0, 0, 0.06, 0.07, 0.036));
    const hx = sx * HAND_X;
    paddle.add(UNIT.sphere, 0xffffff, mat(hx, 0.01, 0.005, 0, 0, 0, 0.115, 0.105, 0.115));
    for (let f = 0; f < 3; f++) paddle.add(UNIT.sphere, 0xf2f2f2, mat(hx - sx * 0.05 + sx * f * 0.05, 0.075, 0.06, 0, 0, 0, 0.042));
    paddle.add(UNIT.sphere, 0xffffff, mat(hx - sx * 0.09, 0.06, -0.03, 0, 0, sx * 0.6, 0.045, 0.065, 0.045));
    paddle.add(new THREE.TorusGeometry(0.07, 0.03, 6, 14), 0xe9edf2, mat(hx, -0.01, -0.1));
  }

  g = { head: head.build(), pupils: pupils.build(), lids: lids.build(), paddle: paddle.build(), headY: 0.32 + HEAD_R * sp.scale[1] * 0.92 };
  geoCache.set(key, g);
  return g;
}

const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** A big-headed cartoon sailor sitting in the boat, paddling with a kayak paddle. Local +Z = forward. */
export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private pupils: THREE.Mesh;
  private lids: THREE.Mesh;
  private paddle: THREE.Mesh;
  private arms: THREE.Mesh[] = [];
  private headY: number;
  private phase = Math.random() * 6;
  private blinkT = 1 + Math.random() * 3;
  private glanceT = 0;
  private glance = 0;
  private hitT = 0;
  private cheerT = 0;
  private time = 0;

  constructor(species: SpeciesId, outfit: number) {
    const sp = speciesById(species);
    const g = geometries(sp, outfit);

    // Small shirt in the player's colour; the big head hides most of it.
    const torso = new THREE.Mesh(UNIT.sphere, lambert(outfit));
    torso.scale.set(0.3, 0.27, 0.26);
    torso.position.y = 0.17;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 16), lambert(0xffffff));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.36;

    this.headY = g.headY;
    this.head.add(new THREE.Mesh(g.head, vertexColored));
    this.pupils = new THREE.Mesh(g.pupils, vertexColored);
    this.lids = new THREE.Mesh(g.lids, vertexColored);
    this.lids.visible = false;
    this.head.add(this.pupils, this.lids);
    this.head.position.y = this.headY;

    this.paddle = new THREE.Mesh(g.paddle, vertexColored);
    this.paddle.position.set(0, PADDLE_Y, PADDLE_Z);
    const sleeve = lambert(SLEEVE);
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(ARM, sleeve);
      this.arms.push(arm);
      this.body.add(arm);
    }
    this.body.add(torso, collar, this.head, this.paddle);
    this.root.add(this.body);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    this.lids.castShadow = this.pupils.castShadow = false;
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
    // Big heads bob a little with each stroke.
    let headBob = Math.abs(dip) * 0.025 * effort;
    let headSquash = 1;

    if (this.cheerT > 0) {
      // Hop and raise the paddle overhead.
      this.cheerT = Math.max(0, this.cheerT - dt);
      const k = Math.sin((1 - this.cheerT / 1.1) * Math.PI);
      this.body.position.y += Math.abs(Math.sin(this.cheerT * 9)) * 0.18 * k;
      py += 0.75 * k;
      pz -= 0.3 * k;
      rz = Math.sin(t * 14) * 0.15 * k + rz * (1 - k);
      ry *= 1 - k;
      headSquash = 1 + Math.sin(this.cheerT * 18) * 0.05 * k;
    }
    if (this.hitT > 0) {
      // Squash and wobble.
      this.hitT = Math.max(0, this.hitT - dt);
      const k = this.hitT / 0.7;
      this.body.rotation.z = Math.sin(this.hitT * 30) * 0.2 * k;
      headSquash = 1 - 0.18 * k;
      headBob -= 0.05 * k;
    }

    this.paddle.position.set(0, py, pz);
    this.paddle.rotation.set(0, ry, rz);
    this.head.position.y = this.headY + headBob;
    this.head.scale.set(2 - headSquash, headSquash, 2 - headSquash);
    this.head.rotation.set(Math.sin(t * 1.7) * 0.04, -steer * 0.3, -steer * 0.07 + (this.hitT > 0 ? Math.sin(this.hitT * 40) * 0.25 : 0));
    this.body.rotation.z += -steer * 0.05;

    // Googly pupils dart toward the turn, with the odd random glance.
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      this.glanceT = 0.8 + Math.random() * 2.5;
      this.glance = (Math.random() - 0.5) * 0.04;
    }
    const look = -steer * 0.03 + this.glance;
    this.pupils.position.x += (look - this.pupils.position.x) * Math.min(1, dt * 12);
    this.pupils.position.y = this.hitT > 0 ? Math.sin(this.hitT * 50) * 0.015 : 0;

    // Rubber-hose arms reach from the shoulders to the gloves on the shaft.
    this.paddle.updateMatrix();
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const hand = _v.set(sx * HAND_X, -0.01, -0.1).applyMatrix4(this.paddle.matrix);
      const dir = _s.set(sx * 0.22, SHOULDER_Y, 0.06);
      const arm = this.arms[i];
      arm.position.copy(dir).add(hand).multiplyScalar(0.5);
      dir.subVectors(hand, dir);
      const len = dir.length();
      arm.quaternion.setFromUnitVectors(_up, dir.divideScalar(len || 1));
      arm.scale.set(1, len, 1);
    }

    // Blink every few seconds (eyes squeeze shut when hit).
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.lids.visible = this.blinkT > -0.12;
      if (this.blinkT < -0.12) this.blinkT = 1.5 + Math.random() * 3.5;
    }
    if (this.hitT > 0.35) this.lids.visible = true;
  }
}
