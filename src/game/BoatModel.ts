import * as THREE from 'three';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { lambert, vertexColored } from './render/materials';
import { planksTexture } from './render/textures';
import { Character, type SpeciesId } from './Character';

// The "nutshell" boat from assets/boat-reference.png: an ellipsoidal half-shell hull with a
// thick rim and curved ribs inside, now with plank texture, a colour stripe, seat, bow cannon
// and pennant. Local space: +Z is the bow, +Y up. ~1.9 wide × 2.6 long.

const HX = 0.95, HY = 0.62, HZ = 1.3;
/** Height of the rim above the water surface: shows off the hull while keeping the inner floor dry. */
export const RIDE_HEIGHT = 0.47;
const RIM = 0xe3ad6a;
const RIB = 0xd49a5a;

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
  // Rim.
  const rim = new THREE.TorusGeometry(1, 0.085, 10, 64);
  rim.rotateX(Math.PI / 2);
  b.add(rim, RIM, mat(0, 0.01, 0, 0, 0, 0, HX * 0.975, 1.5, HZ * 0.975));
  // Paint stripe just under the rim.
  const stripe = new THREE.SphereGeometry(1.012, 40, 1, 0, Math.PI * 2, Math.PI / 2 + 0.1, 0.16);
  b.add(stripe, color, mat(0, 0, 0, 0, 0, 0, HX, HY, HZ));
  // Ribs inside the hull.
  for (const zn of [-0.48, 0.02, 0.5]) {
    const s = Math.sqrt(1 - zn * zn);
    const rib = new THREE.TorusGeometry(1, 0.05, 6, 14, Math.PI);
    rib.rotateZ(Math.PI);
    b.add(rib, RIB, mat(0, 0, zn * HZ * 0.9, 0, 0, 0, HX * s * 0.86, HY * s * 0.76, 1));
  }
  // Bench seat.
  b.add(new THREE.BoxGeometry(1, 1, 1), 0xd9a066, mat(0, -0.17, -0.18, 0, 0, 0, 1.55, 0.07, 0.34));
  // Bow cannon on a wooden block.
  b.add(new THREE.BoxGeometry(1, 1, 1), 0xb07a45, mat(0, 0.04, 0.98, 0, 0, 0, 0.26, 0.12, 0.26));
  b.add(new THREE.CylinderGeometry(0.075, 0.1, 0.46, 14), 0x3b4450, mat(0, 0.16, 1.1, Math.PI / 2, 0, 0));
  b.add(new THREE.TorusGeometry(0.078, 0.024, 6, 14), 0x2c333c, mat(0, 0.16, 1.33));
  b.add(UNIT.sphere, 0x3b4450, mat(0, 0.16, 0.87, 0, 0, 0, 0.09));
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

const shieldMaterialBase = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      float rim = pow(f, 2.2);
      vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + f * 1.4 + uTime * 0.25));
      vec3 col = mix(vec3(0.75, 0.97, 1.0), iri, 0.45);
      gl_FragColor = vec4(col, (0.06 + rim * 0.8) * uOpacity);
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
  }

  animate(dt: number, speed: number, effort: number, steer: number, time: number): void {
    this.character.update(dt, effort, steer, speed);
    if (this.shield.visible) this.shieldMat.uniforms.uTime.value = time;
  }

  setShieldOpacity(o: number): void {
    this.shieldMat.uniforms.uOpacity.value = o;
  }
}
