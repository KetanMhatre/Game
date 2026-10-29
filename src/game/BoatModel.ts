import * as THREE from 'three';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { lambert, vertexColored } from './render/materials';
import { planksTexture } from './render/textures';
import { Character, type SpeciesId } from './Character';
import type { WeaponId } from './config';

// The "nutshell" boat from assets/boat-reference.png: an ellipsoidal half-shell hull with a
// thick rim and curved ribs inside, plus plank texture, a colour stripe, seat and pennant.
// The bow mount changes with the held weapon. Local space: +Z is the bow, +Y up. ~1.9 × 2.6.

const HX = 0.95, HY = 0.62, HZ = 1.3;
/** Height of the rim above the water surface: shows off the hull while keeping the inner floor dry. */
export const RIDE_HEIGHT = 0.47;
const RIM = 0xe3ad6a;
const RIB = 0xd49a5a;
const WOOD = 0xb07a45;
const IRON = 0x3b4450;
const IRON_DARK = 0x2c333c;
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);

let hullGeo: { outer: THREE.BufferGeometry; inner: THREE.BufferGeometry } | null = null;
const detailCache = new Map<number, THREE.BufferGeometry>();

function hull() {
  if (hullGeo) return hullGeo;
  const outer = new THREE.SphereGeometry(1, 36, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  outer.scale(HX, HY, HZ);
  // Inner shell is shallower than the outer one so its floor stays above the waterline
  // (otherwise the water surface would show inside the boat on wave crests).
  const inner = outer.clone();
  inner.scale(0.93, 0.8, 0.95);
  hullGeo = { outer, inner };
  return hullGeo;
}

function details(color: number): THREE.BufferGeometry {
  let g = detailCache.get(color);
  if (g) return g;
  const b = new GeoBuilder();
  const rim = new THREE.TorusGeometry(1, 0.085, 10, 64);
  rim.rotateX(Math.PI / 2);
  b.add(rim, RIM, mat(0, 0.01, 0, 0, 0, 0, HX * 0.975, 1.5, HZ * 0.975));
  const stripe = new THREE.SphereGeometry(1.012, 40, 1, 0, Math.PI * 2, Math.PI / 2 + 0.1, 0.16);
  b.add(stripe, color, mat(0, 0, 0, 0, 0, 0, HX, HY, HZ));
  for (const zn of [-0.48, 0.02, 0.5]) {
    const s = Math.sqrt(1 - zn * zn);
    const rib = new THREE.TorusGeometry(1, 0.05, 6, 14, Math.PI);
    rib.rotateZ(Math.PI);
    b.add(rib, RIB, mat(0, 0, zn * HZ * 0.9, 0, 0, 0, HX * s * 0.86, HY * s * 0.76, 1));
  }
  b.add(BOX, 0xd9a066, mat(0, -0.17, -0.18, 0, 0, 0, 1.55, 0.07, 0.34));
  // Stern pole + pennant (off-centre so the camera sees the sailor).
  b.add(new THREE.CylinderGeometry(0.03, 0.035, 1.55, 6), 0x6d4c35, mat(0.52, 0.66, -0.86));
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.7, -0.21), new THREE.Vector2(0, -0.42)]);
  const flag = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false });
  flag.rotateY(Math.PI / 2);
  b.add(flag, color, mat(0.5, 1.42, -0.86));
  b.add(UNIT.sphere, 0xffd23f, mat(0.52, 1.46, -0.86, 0, 0, 0, 0.05));
  g = b.build();
  detailCache.set(color, g);
  return g;
}

// ---------------------------------------------------------------- weapon mounts

type MountId = 'cannon' | 'gatling' | 'harpoon' | 'mortar' | 'broadside' | 'torpedo';

const MOUNT_FOR: Partial<Record<WeaponId, MountId>> = {
  torpedoes: 'torpedo',
  broadside: 'broadside',
  deckGun: 'gatling',
  harpoon: 'harpoon',
  mortar: 'mortar',
};

const mountGeo = new Map<string, THREE.BufferGeometry>();
function mountGeometry(id: MountId | 'gatlingBarrels'): THREE.BufferGeometry {
  let g = mountGeo.get(id);
  if (g) return g;
  const b = new GeoBuilder();
  switch (id) {
    case 'cannon':
      b.add(BOX, WOOD, mat(0, 0.04, 0.98, 0, 0, 0, 0.26, 0.12, 0.26));
      b.add(new THREE.CylinderGeometry(0.075, 0.1, 0.46, 14), IRON, mat(0, 0.16, 1.1, Math.PI / 2, 0, 0));
      b.add(new THREE.TorusGeometry(0.078, 0.024, 6, 14), IRON_DARK, mat(0, 0.16, 1.33));
      b.add(UNIT.sphere, IRON, mat(0, 0.16, 0.87, 0, 0, 0, 0.09));
      break;
    case 'gatling':
      b.add(BOX, WOOD, mat(0, 0.04, 0.95, 0, 0, 0, 0.3, 0.12, 0.3));
      b.add(BOX, 0x5f6b78, mat(0, 0.2, 0.98, 0, 0, 0, 0.22, 0.18, 0.3));
      b.add(BOX, 0x6b7a4a, mat(0.22, 0.12, 0.9, 0, 0, 0, 0.14, 0.14, 0.2));
      for (let i = 0; i < 3; i++) b.add(BOX, 0xffc93c, mat(0.13 - i * 0.03, 0.2 - i * 0.015, 0.95 + i * 0.04, 0, 0, 0.3, 0.05, 0.03, 0.03));
      break;
    case 'gatlingBarrels':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(CYL, 0x8a96a3, mat(Math.cos(a) * 0.06, Math.sin(a) * 0.06, 0.25, Math.PI / 2, 0, 0, 0.026, 0.5, 0.026));
      }
      b.add(CYL, IRON, mat(0, 0, 0.47, Math.PI / 2, 0, 0, 0.095, 0.04, 0.095));
      b.add(CYL, IRON, mat(0, 0, 0.03, Math.PI / 2, 0, 0, 0.1, 0.06, 0.1));
      break;
    case 'harpoon':
      b.add(BOX, WOOD, mat(0, 0.04, 0.95, 0, 0, 0, 0.26, 0.12, 0.26));
      b.add(CYL, IRON, mat(0, 0.14, 0.98, 0, 0, 0, 0.05, 0.14, 0.05));
      b.add(CYL, 0xb08d57, mat(0, 0.23, 1.06, Math.PI / 2, 0, 0, 0.075, 0.55, 0.075));
      b.add(new THREE.ConeGeometry(1, 1, 10), 0xd7dee6, mat(0, 0.23, 1.42, Math.PI / 2, 0, 0, 0.08, 0.22, 0.08));
      b.add(new THREE.TorusGeometry(0.1, 0.035, 6, 14), 0x6b4a2e, mat(0, 0.1, 0.76, Math.PI / 2, 0, 0));
      break;
    case 'mortar': {
      b.add(BOX, 0x5f6b78, mat(0, 0.05, 0.95, 0, 0, 0, 0.38, 0.08, 0.38));
      const tilt = 0.65;
      const ax = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
      const c = new THREE.Vector3(0, 0.27, 1.0);
      b.add(new THREE.CylinderGeometry(0.13, 0.15, 0.44, 14), IRON, mat(c.x, c.y, c.z, tilt, 0, 0));
      const top = c.clone().addScaledVector(ax, 0.21);
      b.add(CYL, IRON_DARK, mat(top.x, top.y, top.z, tilt, 0, 0, 0.16, 0.06, 0.16));
      b.add(BOX, IRON_DARK, mat(0, 0.14, 0.86, -0.4, 0, 0, 0.06, 0.22, 0.06));
      break;
    }
    case 'broadside':
      for (const s of [-1, 1]) {
        b.add(BOX, WOOD, mat(s * 0.74, 0.05, 0.05, 0, 0, 0, 0.26, 0.1, 0.3));
        // Cylinder top (narrow end) points outward: Rz(∓π/2) maps +Y to ±X.
        b.add(new THREE.CylinderGeometry(0.07, 0.095, 0.44, 14), IRON, mat(s * 0.95, 0.16, 0.05, 0, 0, -s * (Math.PI / 2)));
        b.add(CYL, IRON_DARK, mat(s * 1.16, 0.16, 0.05, 0, 0, Math.PI / 2, 0.085, 0.05, 0.085));
      }
      break;
    case 'torpedo':
      for (const s of [-1, 1]) {
        b.add(CYL, 0x4b5663, mat(s * 0.5, 0.08, 0.72, Math.PI / 2, 0, 0, 0.09, 0.7, 0.09));
        b.add(CYL, IRON_DARK, mat(s * 0.5, 0.08, 1.06, Math.PI / 2, 0, 0, 0.105, 0.05, 0.105));
        b.add(UNIT.sphere, 0xff7a2e, mat(s * 0.5, 0.08, 1.08, 0, 0, 0, 0.075, 0.075, 0.1));
      }
      break;
  }
  g = b.build();
  mountGeo.set(id, g);
  return g;
}

// ---------------------------------------------------------------- Hydro-Barrier

const shieldMaterialBase = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    varying vec2 vUv;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vUv = uv;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    varying vec3 vN;
    varying vec3 vV;
    varying vec2 vUv;
    // Distance to the nearest hexagon edge (0 on the edge).
    float hexEdge(vec2 p) {
      p.x *= 1.1547;
      p.y += mod(floor(p.x), 2.0) * 0.5;
      p = abs(fract(p) - 0.5);
      return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
    }
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float rim = pow(f, 2.2);
      float hex = 1.0 - smoothstep(0.0, 0.1, hexEdge(vUv * vec2(20.0, 9.0)));
      float shimmer = 0.5 + 0.5 * sin(uTime * 4.0 - vUv.y * 18.0);
      vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + f * 1.4 + uTime * 0.25));
      vec3 col = mix(vec3(0.7, 0.96, 1.0), iri, 0.4) + hex * 0.3;
      gl_FragColor = vec4(col, (0.05 + rim * 0.75 + hex * (0.18 + 0.22 * shimmer)) * uOpacity);
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
});

export class BoatModel {
  /** Positioned/rotated by the Boat entity. */
  readonly root = new THREE.Group();
  /** Pitch/roll applied here so heading stays clean on root. */
  readonly tilt = new THREE.Group();
  readonly shield: THREE.Mesh;
  readonly character: Character;
  private shieldMat: THREE.ShaderMaterial;
  private mounts = new Map<MountId, THREE.Object3D>();
  private mount: MountId | null = null;
  private barrels: THREE.Mesh | null = null;
  private gunSpinT = 0;

  constructor(color: number, species: SpeciesId) {
    const h = hull();
    const tex = planksTexture();
    const outer = new THREE.Mesh(h.outer, lambert(0xffffff, { map: tex }));
    const inner = new THREE.Mesh(h.inner, lambert(0xb48a66, { map: tex, side: THREE.BackSide }));
    const detail = new THREE.Mesh(details(color), vertexColored);
    outer.castShadow = detail.castShadow = true;
    inner.receiveShadow = detail.receiveShadow = true;
    this.tilt.add(outer, inner, detail);

    this.character = new Character(species, color);
    this.character.root.position.set(0, -0.2, -0.16);
    this.tilt.add(this.character.root);

    this.shieldMat = shieldMaterialBase.clone();
    this.shield = new THREE.Mesh(UNIT.sphereHi, this.shieldMat);
    this.shield.scale.set(1.9, 1.6, 2.1);
    this.shield.position.y = 0.45;
    this.shield.visible = false;
    this.shield.renderOrder = 5;
    this.tilt.add(this.shield);
    this.root.add(this.tilt);
    this.setMount(null);
  }

  /** Swap the bow/side weapon mount to match the held weapon (default: small bow cannon). */
  setMount(weapon: WeaponId | null): void {
    const id = (weapon && MOUNT_FOR[weapon]) || 'cannon';
    if (id === this.mount) return;
    if (this.mount) this.mounts.get(this.mount)!.visible = false;
    let m = this.mounts.get(id);
    if (!m) {
      const mesh = new THREE.Mesh(mountGeometry(id), vertexColored);
      mesh.castShadow = true;
      m = mesh;
      if (id === 'gatling') {
        this.barrels = new THREE.Mesh(mountGeometry('gatlingBarrels'), vertexColored);
        this.barrels.position.set(0, 0.2, 1.08);
        this.barrels.castShadow = true;
        mesh.add(this.barrels);
      }
      this.mounts.set(id, m);
      this.tilt.add(m);
    }
    m.visible = true;
    this.mount = id;
  }

  /** Called on every Deck Gun shot: keeps the barrels spinning briefly. */
  spinGun(): void {
    this.gunSpinT = 0.2;
  }

  animate(dt: number, speed: number, effort: number, steer: number, time: number): void {
    this.character.update(dt, effort, steer, speed);
    if (this.shield.visible) this.shieldMat.uniforms.uTime.value = time;
    if (this.barrels && this.gunSpinT > 0) {
      this.gunSpinT -= dt;
      this.barrels.rotation.z += dt * 28;
    }
  }

  setShieldOpacity(o: number): void {
    this.shieldMat.uniforms.uOpacity.value = o;
  }
}
