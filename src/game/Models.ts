import * as THREE from 'three';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { lambert, vertexColored } from './render/materials';
import { badgeTexture, crateTexture, glowTexture, ringTexture, targetTexture } from './render/textures';

// Prototype models for weapons and pickups. Geometry is built once and shared; local +Z is "forward".

const STEEL = 0x8f9ba7;
const STEEL_DARK = 0x4b5663;
const IRON = 0x2f353d;
const ORANGE = 0xff7a2e;
const WOOD = 0xc8925a;

const up = new THREE.Vector3(0, 1, 0);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const HORN = new THREE.CylinderGeometry(0.05, 0.07, 0.24, 8);

function once<T>(fn: () => T): () => T {
  let v: T | undefined;
  return () => (v ??= fn());
}

function castShadows(o: THREE.Object3D): THREE.Object3D {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh) c.castShadow = true;
  });
  return o;
}

/** Evenly spread spikes over a sphere (Fibonacci lattice). */
function spikes(b: GeoBuilder, count: number, radius: number, len: number, width: number, color: number): void {
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    q.setFromUnitVectors(up, dir);
    m.compose(dir.clone().multiplyScalar(radius + len * 0.4), q, new THREE.Vector3(width, len, width));
    b.add(CONE, color, m);
  }
}

// ---------------------------------------------------------------- projectiles

const torpedoGeo = once(() => {
  const b = new GeoBuilder();
  b.add(CYL, STEEL, mat(0, 0, 0, Math.PI / 2, 0, 0, 0.16, 1.0, 0.16));
  b.add(UNIT.sphere, ORANGE, mat(0, 0, 0.5, 0, 0, 0, 0.16, 0.16, 0.26));
  b.add(CYL, 0xffd23f, mat(0, 0, 0.3, Math.PI / 2, 0, 0, 0.165, 0.06, 0.165));
  b.add(CONE, STEEL_DARK, mat(0, 0, -0.62, -Math.PI / 2, 0, 0, 0.16, 0.25, 0.16));
  for (const [rz, sx, sy] of [[0, 0.02, 0.24], [Math.PI / 2, 0.02, 0.24]] as const) {
    b.add(BOX, STEEL_DARK, mat(0, 0, -0.55, 0, 0, rz, sx, sy * 2, 0.16));
  }
  b.add(BOX, IRON, mat(0, 0, -0.77, 0, 0, 0.6, 0.3, 0.04, 0.03));
  return b.build();
});
export function torpedoModel(): THREE.Object3D {
  return castShadows(new THREE.Mesh(torpedoGeo(), vertexColored));
}

const cannonballGeo = once(() => new THREE.SphereGeometry(0.3, 16, 12));
export function cannonballModel(): THREE.Object3D {
  return castShadows(new THREE.Mesh(cannonballGeo(), lambert(IRON)));
}

const shellGeo = once(() => {
  const b = new GeoBuilder();
  b.add(CYL, STEEL_DARK, mat(0, 0, 0, Math.PI / 2, 0, 0, 0.17, 0.5, 0.17));
  b.add(CONE, 0xff5a3c, mat(0, 0, 0.42, Math.PI / 2, 0, 0, 0.17, 0.36, 0.17));
  b.add(CYL, 0xffd23f, mat(0, 0, 0.2, Math.PI / 2, 0, 0, 0.175, 0.07, 0.175));
  for (const rz of [0, Math.PI / 2]) b.add(BOX, IRON, mat(0, 0, -0.3, 0, 0, rz, 0.03, 0.46, 0.18));
  return b.build();
});
export function mortarShellModel(): THREE.Object3D {
  return castShadows(new THREE.Mesh(shellGeo(), vertexColored));
}

const harpoonGeo = once(() => {
  const b = new GeoBuilder();
  b.add(CYL, WOOD, mat(0, 0, -0.1, Math.PI / 2, 0, 0, 0.04, 1.2, 0.04));
  b.add(CONE, 0xd7dee6, mat(0, 0, 0.62, Math.PI / 2, 0, 0, 0.09, 0.32, 0.09));
  for (const s of [-1, 1]) b.add(CONE, 0xb8c2cc, mat(s * 0.08, 0, 0.45, -Math.PI / 2, 0, s * 0.5, 0.035, 0.2, 0.035));
  b.add(CYL, 0x7a5a3a, mat(0, 0, -0.68, Math.PI / 2, 0, 0, 0.06, 0.08, 0.06));
  return b.build();
});
export function harpoonModel(): THREE.Object3D {
  return castShadows(new THREE.Mesh(harpoonGeo(), vertexColored));
}

/** A unit-length rope along +Y; scale.y sets its length. */
export function ropeMesh(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6);
  geo.translate(0, 0.5, 0);
  return new THREE.Mesh(geo, lambert(0x6b4a2e));
}

// ---------------------------------------------------------------- traps

const mineGeo = once(() => {
  const b = new GeoBuilder();
  b.add(UNIT.sphereHi, 0x56616e, mat(0, 0, 0, 0, 0, 0, 0.55));
  b.add(new THREE.TorusGeometry(0.56, 0.05, 6, 24), IRON, mat(0, 0, 0, Math.PI / 2, 0, 0));
  // Contact horns.
  const dirs = [[1, 0.2, 0], [-1, 0.2, 0], [0, 0.2, 1], [0, 0.2, -1], [0.7, 0.75, 0.7], [-0.7, 0.75, 0.7], [0.7, 0.75, -0.7], [-0.7, 0.75, -0.7]];
  const q = new THREE.Quaternion();
  for (const [x, y, z] of dirs) {
    const d = new THREE.Vector3(x, y, z).normalize();
    q.setFromUnitVectors(up, d);
    const p = d.clone().multiplyScalar(0.62);
    b.add(HORN, IRON, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
    b.add(UNIT.sphere, 0x3b4450, mat(...d.clone().multiplyScalar(0.75).toArray(), 0, 0, 0, 0.065));
  }
  b.add(CYL, IRON, mat(0, 0.6, 0, 0, 0, 0, 0.11, 0.1, 0.11));
  return b.build();
});

/** Naval mine: horned steel sphere with a blinking beacon and a warning ring on the water. */
export function navalMineModel(): { obj: THREE.Object3D; beaconMat: THREE.MeshBasicMaterial; ring: THREE.Mesh } {
  const obj = new THREE.Group();
  const body = new THREE.Mesh(mineGeo(), vertexColored);
  body.castShadow = true;
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
  const beacon = new THREE.Mesh(UNIT.sphere, beaconMat);
  beacon.scale.set(0.1, 0.13, 0.1);
  beacon.position.y = 0.72;
  obj.add(body, beacon);
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xff3d5e, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  return { obj, beaconMat, ring };
}

const chargeGeo = once(() => {
  const b = new GeoBuilder();
  b.add(CYL, 0x6f7b87, mat(0, 0, 0, 0, 0, 0, 0.32, 0.72, 0.32));
  b.add(CYL, 0xffc93c, mat(0, 0.18, 0, 0, 0, 0, 0.33, 0.1, 0.33));
  b.add(CYL, 0xffc93c, mat(0, -0.18, 0, 0, 0, 0, 0.33, 0.1, 0.33));
  b.add(CYL, STEEL_DARK, mat(0, 0.4, 0, 0, 0, 0, 0.12, 0.1, 0.12));
  return b.build();
});
export function depthChargeModel(): THREE.Object3D {
  return castShadows(new THREE.Mesh(chargeGeo(), vertexColored));
}

// ---------------------------------------------------------------- crates (real & fake)

const crateGeo = once(() => new THREE.BoxGeometry(1.2, 1.2, 1.2));
let badgeReal: THREE.SpriteMaterial | null = null;
let badgeFake: THREE.SpriteMaterial | null = null;
const pickupRingMat = new THREE.MeshBasicMaterial({
  map: ringTexture(),
  color: 0xffd23f,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe680, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

/** Floating supply crate with a camera-facing "?" badge and a glowing ring on the water. */
export function crateModel(fake = false): { obj: THREE.Group; crate: THREE.Mesh; badge: THREE.Sprite; ring: THREE.Mesh } {
  // Badges are created lazily: they're drawn with the game font, which loads during boot.
  badgeReal ??= new THREE.SpriteMaterial({ map: badgeTexture(false), depthWrite: false });
  badgeFake ??= new THREE.SpriteMaterial({ map: badgeTexture(true), depthWrite: false });
  const obj = new THREE.Group();
  const crate = new THREE.Mesh(crateGeo(), lambert(0xffffff, { map: crateTexture() }));
  crate.castShadow = true;
  const badge = new THREE.Sprite(fake ? badgeFake : badgeReal);
  badge.scale.setScalar(1.05);
  badge.position.y = 1.55;
  badge.renderOrder = 9;
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(2.4);
  glow.position.y = 1.55;
  glow.renderOrder = 8;
  obj.add(crate, glow, badge);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), pickupRingMat);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  return { obj, crate, badge, ring };
}

/** Shared bob/spin/pop animation for real and fake crates. */
export function animateCrate(
  p: { x: number; z: number; obj: THREE.Object3D; crate: THREE.Object3D; badge: THREE.Sprite; ring: THREE.Object3D; appear: number },
  wy: number,
  time: number,
  dt: number,
): void {
  p.appear = Math.min(1, p.appear + dt * 3);
  const pop = p.appear < 1 ? 1 + Math.sin(p.appear * Math.PI) * 0.35 : 1;
  p.obj.position.y = wy + 0.35 + Math.sin(time * 2 + p.x) * 0.15;
  p.obj.scale.setScalar(p.appear * pop);
  p.crate.rotation.set(Math.sin(time * 1.7 + p.z) * 0.12, p.crate.rotation.y + dt * 1.1, Math.cos(time * 1.3 + p.x) * 0.1);
  p.badge.position.y = 1.55 + Math.sin(time * 3 + p.x) * 0.08;
  p.ring.position.y = wy + 0.06;
  const rs = 1 + 0.08 * Math.sin(time * 3 + p.z);
  p.ring.scale.set(rs, rs, 1);
}

// ---------------------------------------------------------------- flail & drone

const flailGeo = once(() => {
  const b = new GeoBuilder();
  b.add(UNIT.sphereHi, STEEL_DARK, mat(0, 0, 0, 0, 0, 0, 0.5));
  spikes(b, 16, 0.44, 0.34, 0.09, 0x3b4450);
  return b.build();
});
export function flailBallModel(): THREE.Object3D {
  return castShadows(new THREE.Mesh(flailGeo(), vertexColored));
}
export const chainLinkGeo = new THREE.TorusGeometry(0.11, 0.035, 6, 10);

const droneGeo = once(() => {
  const hull = new GeoBuilder();
  hull.add(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xe9eef3, mat(0, 0.05, 0, 0, 0, 0, 0.42, 0.3, 0.85));
  hull.add(new THREE.SphereGeometry(1.01, 18, 1, 0, Math.PI * 2, Math.PI / 2 + 0.08, 0.14), 0x3fa9ff, mat(0, 0.05, 0, 0, 0, 0, 0.42, 0.3, 0.85));
  hull.add(BOX, 0xcfd8e0, mat(0, 0.12, 0, 0, 0, 0, 0.7, 0.08, 1.4));
  hull.add(BOX, 0x9aa6b2, mat(0, 0.3, -0.25, 0, 0, 0, 0.42, 0.28, 0.42));
  hull.add(BOX, 0x1d2a38, mat(0, 0.34, -0.03, 0, 0, 0, 0.36, 0.1, 0.02));
  hull.add(CYL, 0x6c7a88, mat(0.12, 0.62, -0.32, 0, 0, 0, 0.015, 0.4, 0.015));
  const turret = new GeoBuilder();
  turret.add(CYL, 0x5f6b78, mat(0, 0, 0, 0, 0, 0, 0.14, 0.12, 0.14));
  turret.add(CYL, IRON, mat(0, 0.02, 0.22, Math.PI / 2, 0, 0, 0.035, 0.36, 0.035));
  return { hull: hull.build(), turret: turret.build() };
});

/** Patrol drone: mini gunboat with a rotating turret and a blinking mast light. */
export function droneModel(): { obj: THREE.Group; turret: THREE.Mesh; lightMat: THREE.MeshBasicMaterial } {
  const g = droneGeo();
  const obj = new THREE.Group();
  const hull = new THREE.Mesh(g.hull, vertexColored);
  const turret = new THREE.Mesh(g.turret, vertexColored);
  turret.position.set(0, 0.24, 0.32);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
  const light = new THREE.Mesh(UNIT.sphere, lightMat);
  light.scale.setScalar(0.05);
  light.position.set(0.12, 0.84, -0.32);
  obj.add(hull, turret, light);
  castShadows(obj);
  return { obj, turret, lightMat };
}

// ---------------------------------------------------------------- area effects

const vortexBase = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uAlpha: { value: 0 },
    uDeep: { value: new THREE.Color(0x06243f) },
    uMid: { value: new THREE.Color(0x1d79b0) },
    uFoam: { value: new THREE.Color(0xeefbff) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uAlpha;
    uniform vec3 uDeep, uMid, uFoam;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float a = atan(p.y, p.x);
      // Logarithmic spiral arms rotating inward.
      float arms = sin(a * 3.0 + log(r + 0.04) * 6.5 + uTime * 5.5);
      float foam = smoothstep(0.45, 0.95, arms) * smoothstep(0.08, 0.5, r) * (1.0 - smoothstep(0.8, 1.0, r));
      vec3 col = mix(uDeep, uMid, smoothstep(0.0, 0.85, r));
      col = mix(col, uFoam, foam * 0.85);
      float alpha = (1.0 - smoothstep(0.7, 1.0, r)) * 0.9 + foam * 0.1;
      gl_FragColor = vec4(col, alpha * uAlpha);
      #include <colorspace_fragment>
    }`,
  transparent: true,
  depthWrite: false,
});

/** Swirling whirlpool disc (radius 1 → scale it). Unique material per instance for its fade. */
export function vortexMesh(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = vortexBase.clone();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 3;
  return { mesh, material };
}

/** Red landing marker for the mortar. */
export function targetMarker(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: targetTexture(), color: 0xff3d3d, transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 4;
  return m;
}
