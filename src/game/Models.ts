import * as THREE from 'three';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { lambert, vertexColored } from './render/materials';
import { badgeTexture, barrelTexture, coconutTexture, foamRingTexture, glowTexture, ringTexture } from './render/textures';

// Prototype models for weapons and pickups. Clone with .clone(): geometry & materials are shared.

const up = new THREE.Vector3(0, 1, 0);

function spikes(b: GeoBuilder, count: number, radius: number, len: number, width: number, color: number, tips?: GeoBuilder, tipColor = 0xffffff): void {
  const cone = new THREE.ConeGeometry(1, 1, 6);
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    // Fibonacci sphere: evenly spread directions.
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    q.setFromUnitVectors(up, dir);
    m.compose(dir.clone().multiplyScalar(radius + len * 0.4), q, new THREE.Vector3(width, len, width));
    b.add(cone, color, m);
    if (tips) tips.add(UNIT.sphere, tipColor, mat(...dir.clone().multiplyScalar(radius + len * 0.9).toArray(), 0, 0, 0, width * 0.55));
  }
}

let coconut: THREE.Object3D | null = null;
export function coconutModel(): THREE.Object3D {
  if (!coconut) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(UNIT.sphereHi, lambert(0xffffff, { map: coconutTexture() }));
    ball.scale.setScalar(0.38);
    const eyes = new GeoBuilder();
    for (const [x, y] of [[-0.1, 0.1], [0.1, 0.1], [0, -0.08]]) eyes.add(UNIT.sphere, 0x2a170a, mat(x, y, 0.33, 0, 0, 0, 0.065, 0.065, 0.04));
    const e = new THREE.Mesh(eyes.build(), vertexColored);
    g.add(ball, e);
    g.traverse((o) => (o.castShadow = true));
    coconut = g;
  }
  return coconut.clone();
}

let puffer: THREE.Object3D | null = null;
export function pufferModel(): THREE.Object3D {
  if (!puffer) {
    const b = new GeoBuilder();
    b.add(UNIT.sphereHi, 0xffcf3a, mat(0, 0, 0, 0, 0, 0, 0.48, 0.44, 0.5));
    b.add(UNIT.sphere, 0xfff3c4, mat(0, -0.16, 0.06, 0, 0, 0, 0.36, 0.26, 0.4));
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, yy = 0.15 + (i % 3) * 0.1;
      b.add(UNIT.sphere, 0xd9881c, mat(Math.cos(a) * 0.36, yy, Math.sin(a) * 0.36 - 0.05, 0, 0, 0, 0.05, 0.05, 0.03));
    }
    spikes(b, 22, 0.42, 0.2, 0.05, 0xfff0c0);
    for (const sx of [-1, 1]) {
      b.add(UNIT.sphere, 0xffffff, mat(sx * 0.2, 0.14, 0.4, 0, 0, 0, 0.13, 0.14, 0.1));
      b.add(UNIT.sphere, 0x1d1d26, mat(sx * 0.21, 0.13, 0.48, 0, 0, 0, 0.075, 0.08, 0.05));
      b.add(UNIT.sphere, 0xffffff, mat(sx * 0.18 + 0.03, 0.18, 0.52, 0, 0, 0, 0.025));
      b.add(UNIT.sphere, 0xff9a2e, mat(sx * 0.48, -0.02, 0.05, 0, sx * 0.4, 0, 0.04, 0.15, 0.12));
    }
    b.add(new THREE.TorusGeometry(0.06, 0.03, 6, 12), 0xff7a2e, mat(0, -0.06, 0.5));
    b.add(new THREE.ConeGeometry(0.22, 0.32, 4), 0xff9a2e, mat(0, 0.02, -0.6, -Math.PI / 2, 0, 0, 1, 1, 0.35));
    const mesh = new THREE.Mesh(b.build(), vertexColored);
    mesh.castShadow = true;
    puffer = mesh;
  }
  return puffer.clone();
}

let urchin: { body: THREE.BufferGeometry; tips: THREE.BufferGeometry } | null = null;
/** Returns the mine and its glowing tip material (unique per mine so it can pulse when armed). */
export function urchinModel(): { obj: THREE.Object3D; tipMat: THREE.MeshBasicMaterial; ring: THREE.Mesh } {
  if (!urchin) {
    const b = new GeoBuilder();
    const tips = new GeoBuilder();
    b.add(UNIT.sphereHi, 0x4a2a6e, mat(0, 0, 0, 0, 0, 0, 0.5));
    spikes(b, 30, 0.46, 0.42, 0.065, 0x3a1f5a, tips);
    urchin = { body: b.build(), tips: tips.build() };
  }
  const g = new THREE.Group();
  const body = new THREE.Mesh(urchin.body, vertexColored);
  body.castShadow = true;
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff4fa0 });
  const tips = new THREE.Mesh(urchin.tips, tipMat);
  g.add(body, tips);
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xff3d6e, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  return { obj: g, tipMat, ring };
}

let barrel: THREE.BufferGeometry | null = null;
// Created lazily: the badge is drawn with the game font, which loads during boot.
let badgeMat: THREE.SpriteMaterial | null = null;
const pickupRingMat = new THREE.MeshBasicMaterial({
  map: ringTexture(),
  color: 0xffd23f,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe680, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

/** Floating weapon barrel: the barrel itself, a "?" badge that faces the camera, and a glowing ring on the water. */
export function pickupModel(): { obj: THREE.Group; barrel: THREE.Mesh; badge: THREE.Sprite; ring: THREE.Mesh } {
  if (!barrel) {
    const prof: [number, number][] = [[0, -0.75], [0.56, -0.75], [0.64, -0.6], [0.74, -0.3], [0.78, 0], [0.74, 0.3], [0.64, 0.6], [0.56, 0.75], [0, 0.75]];
    barrel = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 20);
  }
  badgeMat ??= new THREE.SpriteMaterial({ map: badgeTexture(), depthWrite: false });
  const obj = new THREE.Group();
  const mesh = new THREE.Mesh(barrel, lambert(0xffffff, { map: barrelTexture() }));
  mesh.castShadow = true;
  const badge = new THREE.Sprite(badgeMat);
  badge.scale.setScalar(1.05);
  badge.position.y = 1.55;
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(2.4);
  glow.position.y = 1.55;
  badge.renderOrder = 9;
  glow.renderOrder = 8;
  obj.add(mesh, glow, badge);
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), pickupRingMat);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  return { obj, barrel: mesh, badge, ring };
}

export function tidalRingMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: foamRingTexture(), transparent: true, depthWrite: false, opacity: 1 });
}
