import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Static props are baked into a few big vertex-coloured meshes: hundreds of trees, reeds and
// rocks cost a handful of draw calls instead of hundreds (vital on low-end Chromebooks/phones).

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Shorthand transform: position, euler rotation, scale. */
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/** Rebuilds normals averaged across faces (soft, rounded look). */
export function smooth(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  return m;
}

/** Faceted normals (crisp low-poly look), used for rocks and mountains. */
export function flat(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

function strip(g: THREE.BufferGeometry, keepColor: boolean): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) {
    if (k === 'position' || k === 'normal' || (keepColor && k === 'color')) continue;
    g.deleteAttribute(k);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  _c.set(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  get empty(): boolean {
    return this.parts.length === 0;
  }

  /** Adds a copy of `geo`, transformed and painted a single colour. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4): this {
    const g = strip(geo.index ? geo.toNonIndexed() : geo.clone(), false);
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push(paint(g, color));
    return this;
  }

  /** Adds a copy of a geometry that already carries its own `color` attribute. */
  addColored(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): this {
    const g = strip(geo.index ? geo.toNonIndexed() : geo.clone(), true);
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!g) throw new Error('GeoBuilder: incompatible parts');
    g.computeBoundingSphere();
    return g;
  }
}

// Shared unit primitives (smooth). Scale them with `mat(...)`.
export const UNIT = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  sphereHi: new THREE.SphereGeometry(1, 24, 16),
  blob: smooth(new THREE.IcosahedronGeometry(1, 1)),
  blobHi: smooth(new THREE.IcosahedronGeometry(1, 2)),
};
