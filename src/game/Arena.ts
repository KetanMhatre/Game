import * as THREE from 'three';
import type { MapDef } from './config';
import { mulberry32 } from './util';
import { waveHeight } from './waves';
import { GeoBuilder, UNIT, flat, mat, smooth } from './render/GeoBuilder';
import { vertexColored } from './render/materials';
import { LAND_FIELD_RANGE } from './Water';

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface Spot {
  x: number;
  z: number;
  heading: number;
}

/** Boats stop this far inside the shoreline curve (the visible waterline sits ~0.1 inside it). */
const SHORE_MARGIN = 0.6;
/** Static scenery is split into square cells so off-screen parts are culled (and skipped in the shadow pass). */
const CELL = 36;

interface Island extends Collider {
  phase: number;
}

interface Floater {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  lift: number;
  tilt: number;
}

interface Profile {
  off: number[];
  base: number[];
  hill: number[];
}

// Terrain cross-section (distance beyond the shoreline curve → height), per theme.
const OFFSETS = [-9, -4, -1.6, -0.35, 0.5, 1.6, 2.8, 4.5, 7, 11, 17, 26, 40, 60, 95, 160, 260];
const PROFILES: Record<MapDef['decor'], Profile> = {
  lily: {
    off: OFFSETS,
    base: [-2.8, -1.8, -0.8, -0.1, 0.22, 0.42, 0.6, 0.75, 0.95, 1.3, 1.9, 2.8, 4, 5.5, 7, 8, 8],
    hill: [0, 0, 0, 0, 0, 0, 0.05, 0.15, 0.3, 0.6, 1, 1.6, 2.6, 3.5, 4, 4, 4],
  },
  pine: {
    off: OFFSETS,
    base: [-2.8, -1.8, -0.8, -0.1, 0.22, 0.42, 0.62, 0.8, 1.1, 1.6, 2.6, 4.2, 6.5, 9, 11, 12, 12],
    hill: [0, 0, 0, 0, 0, 0, 0.05, 0.2, 0.4, 0.9, 1.6, 2.6, 3.5, 4.5, 5, 5, 5],
  },
  palm: {
    off: [-9, -4, -1.6, -0.35, 0.5, 1.6, 2.8, 4.5, 7, 10, 13, 17, 24, 40, 400],
    base: [-2.8, -1.8, -0.8, -0.1, 0.22, 0.42, 0.62, 0.75, 0.8, 0.65, 0.3, -0.4, -2, -3.2, -3.2],
    hill: [0, 0, 0, 0, 0, 0, 0.05, 0.12, 0.18, 0.12, 0.05, 0, 0, 0, 0],
  },
};

// Low-poly building blocks (vertex budgets matter: these are repeated hundreds of times).
const TRUNK = new THREE.CylinderGeometry(0.16, 0.26, 1.6, 7);
const PALM_SEG = new THREE.CylinderGeometry(0.17, 0.22, 0.68, 7);
const PINE_CONE = flat(new THREE.ConeGeometry(1, 1, 8, 1));
const LEAF = new THREE.SphereGeometry(1, 8, 5);
const TINY = smooth(new THREE.IcosahedronGeometry(1, 0));
const REED = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
const TUFT = new THREE.ConeGeometry(1, 1, 5);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 12);

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Arena {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly spawnPoints: Spot[] = [];
  readonly pickupSpots: { x: number; z: number }[] = [];
  /** Distance-to-land field for the water shader (Uint8, 0..LAND_FIELD_RANGE). */
  landField = new Uint8Array(1);
  landSize = 1;
  landExtent = 1;

  private islands: Island[] = [];
  private lighthouseIsland: Island | null = null;
  /** Extra circles (rocks, posts, buoys) that get shore foam but aren't islands. */
  private foamCircles: Collider[] = [];
  /** Areas kept clear of random vegetation (cabin, dock). */
  private clearZones: Collider[] = [];
  private floaters: { mesh: THREE.InstancedMesh; items: Floater[] }[] = [];
  private cells = new Map<number, GeoBuilder>();
  private far = new GeoBuilder();
  private phase: number[];
  private rnd: () => number;
  private profile: Profile;
  private dummy = new THREE.Object3D();

  constructor(readonly map: MapDef) {
    this.rnd = mulberry32(map.seed);
    this.phase = [this.rnd() * 6.28, this.rnd() * 6.28, this.rnd() * 6.28];
    this.profile = PROFILES[map.decor];
    this.buildTerrain();
    this.buildIslands();
    this.buildRocks();
    this.buildProps();
    this.buildShoreVegetation();
    this.buildMountains();
    this.finishStatic();
    this.buildSpawns();
    this.buildPickupSpots();
    this.buildLandField();
  }

  /** Distance from the arena centre to the shoreline curve at angle theta. */
  shoreRadius(theta: number): number {
    const [a, b, c] = this.phase;
    const n = Math.sin(3 * theta + a) * 0.5 + Math.sin(5 * theta + b) * 0.3 + Math.sin(7 * theta + c) * 0.2;
    return this.map.radius * (1 + this.map.shoreNoise * n);
  }

  /** True if a circle of the given radius at (x,z) is open water. */
  isFree(x: number, z: number, margin: number): boolean {
    const d = Math.hypot(x, z);
    if (d > this.shoreRadius(Math.atan2(z, x)) - SHORE_MARGIN - margin) return false;
    for (const c of this.colliders) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + margin) ** 2) return false;
    }
    return true;
  }

  /** Pushes a circle out of the shore and obstacles, bouncing its velocity. Returns impact speed. */
  resolve(p: { x: number; z: number }, v: { x: number; z: number }, radius: number, bounce: number): number {
    let impact = 0;
    const d = Math.hypot(p.x, p.z);
    const lim = this.shoreRadius(Math.atan2(p.z, p.x)) - SHORE_MARGIN - radius;
    if (d > lim) {
      const nx = p.x / d, nz = p.z / d;
      p.x = nx * lim;
      p.z = nz * lim;
      const vn = v.x * nx + v.z * nz;
      if (vn > 0) {
        v.x -= (1 + bounce) * vn * nx;
        v.z -= (1 + bounce) * vn * nz;
        impact = vn;
      }
    }
    for (const c of this.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const min = c.r + radius;
      const dist2 = dx * dx + dz * dz;
      if (dist2 >= min * min) continue;
      const dist = Math.sqrt(dist2) || 0.001;
      const nx = dx / dist, nz = dz / dist;
      p.x = c.x + nx * min;
      p.z = c.z + nz * min;
      const vn = v.x * nx + v.z * nz;
      if (vn < 0) {
        v.x -= (1 + bounce) * vn * nx;
        v.z -= (1 + bounce) * vn * nz;
        impact = Math.max(impact, -vn);
      }
    }
    return impact;
  }

  randomFreeSpot(margin: number): { x: number; z: number } {
    for (let i = 0; i < 200; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.map.radius * 0.85;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.isFree(x, z, margin)) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  update(time: number): void {
    const amp = this.map.waveAmp;
    const d = this.dummy;
    for (const f of this.floaters) {
      f.items.forEach((it, i) => {
        d.position.set(it.x, waveHeight(it.x, it.z, time, amp) + it.lift, it.z);
        d.rotation.set(Math.sin(time * 1.3 + it.x) * it.tilt, it.yaw, Math.cos(time * 1.1 + it.z) * it.tilt);
        d.scale.setScalar(it.scale);
        d.updateMatrix();
        f.mesh.setMatrixAt(i, d.matrix);
      });
      f.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- static batching

  private cell(x: number, z: number): GeoBuilder {
    const key = (Math.floor(x / CELL) + 500) * 1000 + (Math.floor(z / CELL) + 500);
    let b = this.cells.get(key);
    if (!b) {
      b = new GeoBuilder();
      this.cells.set(key, b);
    }
    return b;
  }

  private put(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4): void {
    this.cell(m.elements[12], m.elements[14]).add(geo, color, m);
  }

  /** Adds a geometry with its own vertex colours (world-space unless a matrix is given). */
  private putColored(geo: THREE.BufferGeometry, m?: THREE.Matrix4): void {
    let x: number, z: number;
    if (m) {
      x = m.elements[12];
      z = m.elements[14];
    } else {
      geo.computeBoundingSphere();
      x = geo.boundingSphere!.center.x;
      z = geo.boundingSphere!.center.z;
    }
    this.cell(x, z).addColored(geo, m);
  }

  private finishStatic(): void {
    for (const b of this.cells.values()) {
      if (b.empty) continue;
      const mesh = new THREE.Mesh(b.build(), vertexColored);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.cells.clear();
    if (!this.far.empty) this.group.add(new THREE.Mesh(this.far.build(), vertexColored));
  }

  // ---------------------------------------------------------------- terrain

  /** Smooth periodic noise in [-1, 1]. */
  private tn(th: number, k: number): number {
    const [a, b, c] = this.phase;
    return Math.sin(th * 3 + k * 1.3 + a) * 0.5 + Math.sin(th * 7 + k * 0.7 + b) * 0.3 + Math.sin(th * 13 + c + k * 2.1) * 0.2;
  }

  private rowHeight(i: number, th: number): number {
    const P = this.profile;
    return P.base[i] + P.hill[i] * (0.5 + 0.5 * this.tn(th * 1.7 + 3, i * 0.6));
  }

  /** Approximate ground height at a given angle and distance beyond the shoreline. */
  private groundAt(th: number, off: number): number {
    const P = this.profile;
    for (let i = 0; i < P.off.length - 1; i++) {
      if (off <= P.off[i + 1]) {
        const t = (off - P.off[i]) / (P.off[i + 1] - P.off[i]);
        return this.rowHeight(i, th) * (1 - t) + this.rowHeight(i + 1, th) * t;
      }
    }
    return this.rowHeight(P.off.length - 1, th);
  }

  private buildTerrain(): void {
    const m = this.map;
    const P = this.profile;
    const A = 168;
    const rows = P.off.length;
    const pos = new Float32Array(rows * A * 3);
    const col = new Float32Array(rows * A * 3);
    const sand = new THREE.Color(m.sand);
    const deep = new THREE.Color(m.waterDeep);
    const wet = sand.clone().multiplyScalar(0.78).lerp(deep, 0.12);
    const seabed = wet.clone().lerp(deep, 0.55);
    const grass = new THREE.Color(m.grass);
    const grass2 = grass.clone().offsetHSL(0.035, 0.04, 0.07);
    const rock = new THREE.Color(0x8d929c);
    const snow = new THREE.Color(0xf5f8fc);
    const c = new THREE.Color();
    const g = new THREE.Color();

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < A; j++) {
        const th = (j / A) * Math.PI * 2;
        const off = P.off[i] + (P.off[i] > 3 ? this.tn(th * 2.3, i) * Math.min(4, P.off[i] * 0.12) : 0);
        const r = this.shoreRadius(th) + off;
        const y = this.rowHeight(i, th);
        const k = (i * A + j) * 3;
        pos[k] = Math.cos(th) * r;
        pos[k + 1] = y;
        pos[k + 2] = Math.sin(th) * r;
        if (y < 0) c.copy(wet).lerp(seabed, Math.min(1, -y / 2.6));
        else if (m.decor === 'palm' || off < 2.2) c.copy(sand);
        else {
          g.copy(grass).lerp(grass2, 0.5 + 0.5 * this.tn(th * 5, off * 0.2));
          c.copy(sand).lerp(g, smoothstep(2.2, 3.8, off));
        }
        if (m.decor === 'pine') {
          c.lerp(rock, smoothstep(7.5, 9.5, y));
          c.lerp(snow, smoothstep(10.5, 12, y));
        }
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    const index: number[] = [];
    for (let i = 0; i < rows - 1; i++) {
      for (let j = 0; j < A; j++) {
        const a = i * A + j, b = i * A + ((j + 1) % A), cc = (i + 1) * A + j, d = (i + 1) * A + ((j + 1) % A);
        index.push(a, b, cc, b, d, cc); // counter-clockwise from above → faces up
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, vertexColored);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Lake backdrop: big faceted snow-capped peaks far beyond the shore. */
  private buildMountains(): void {
    if (this.map.decor !== 'pine') return;
    const rnd = this.rnd;
    const rock = new THREE.Color(0x7f8794), rockDark = new THREE.Color(0x5f6672), snow = new THREE.Color(0xf4f7fb);
    const grass = new THREE.Color(this.map.grass).multiplyScalar(0.8);
    const c = new THREE.Color();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.25;
      const d = this.shoreRadius(a) + 75 + rnd() * 70;
      const h = 38 + rnd() * 38;
      const r = h * (0.75 + rnd() * 0.35);
      const geo = new THREE.ConeGeometry(r, h, 7, 4).toNonIndexed();
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < p.count; v++) {
        const y = p.getY(v);
        if (y > h / 2 - 0.01) continue;
        const key = Math.sin(p.getX(v) * 0.37 + y * 0.21) * Math.cos(p.getZ(v) * 0.29 - y * 0.17);
        p.setXYZ(v, p.getX(v) * (1 + key * 0.18), y + key * h * 0.05, p.getZ(v) * (1 + key * 0.18));
      }
      geo.applyMatrix4(mat(Math.cos(a) * d, h / 2 - 3, Math.sin(a) * d, 0, rnd() * 6, 0));
      geo.deleteAttribute('normal');
      geo.computeVertexNormals();
      const colors = new Float32Array(p.count * 3);
      for (let v = 0; v < p.count; v++) {
        const t = (p.getY(v) + 3) / h;
        c.copy(grass).lerp(rockDark, smoothstep(0.02, 0.18, t)).lerp(rock, smoothstep(0.2, 0.45, t)).lerp(snow, smoothstep(0.6, 0.66, t));
        colors.set([c.r, c.g, c.b], v * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.far.addColored(geo);
    }
  }

  // ---------------------------------------------------------------- islands & rocks

  private islandK(isl: Island, a: number): number {
    return 1 + 0.05 * Math.sin(3 * a + isl.phase) + 0.025 * Math.sin(5 * a + isl.phase * 2);
  }

  private buildIslands(): void {
    const m = this.map;
    const rnd = this.rnd;
    const palm = m.decor === 'palm';
    let tries = 0;
    while (this.islands.length < m.islandCount && tries++ < 600) {
      const a = rnd() * Math.PI * 2;
      const dist = (0.22 + rnd() * 0.56) * m.radius;
      const r = (palm ? 3.6 : 2.8) + rnd() * (palm ? 4.2 : 3.4);
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (dist + r > this.shoreRadius(a) - 12) continue;
      if (this.islands.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 10)) continue;
      this.islands.push({ x, z, r, phase: rnd() * 6.28 });
    }
    if (palm && this.islands.length) this.lighthouseIsland = this.islands.reduce((a, b) => (b.r > a.r ? b : a));

    const profile: [number, number][] = palm
      ? [[1.6, -2.6], [1.3, -1.1], [1.08, -0.28], [1.0, 0], [0.86, 0.3], [0.62, 0.55], [0.32, 0.7], [0, 0.73]]
      : [[1.6, -2.6], [1.3, -1.1], [1.08, -0.28], [1.0, 0], [0.9, 0.24], [0.78, 0.4], [0.7, 0.56], [0.55, 0.86], [0.32, 1.08], [0, 1.15]];
    const sand = new THREE.Color(m.sand), wet = sand.clone().multiplyScalar(0.78).lerp(new THREE.Color(m.waterDeep), 0.15);
    const grass = new THREE.Color(m.grass), grass2 = grass.clone().offsetHSL(0.03, 0.04, 0.06);
    const c = new THREE.Color();

    for (const isl of this.islands) {
      const pts = profile.map(([k, y]) => new THREE.Vector2(k * isl.r, y));
      const lathe = new THREE.LatheGeometry(pts, 30);
      const p = lathe.attributes.position as THREE.BufferAttribute;
      for (let v = 0; v < p.count; v++) {
        const x = p.getX(v), z = p.getZ(v);
        const k = this.islandK(isl, Math.atan2(z, x));
        p.setXYZ(v, x * k + isl.x, p.getY(v), z * k + isl.z);
      }
      const geo = smooth(lathe);
      const gp = geo.attributes.position as THREE.BufferAttribute;
      const colors = new Float32Array(gp.count * 3);
      for (let v = 0; v < gp.count; v++) {
        const y = gp.getY(v);
        if (y < -0.02) c.copy(wet);
        else if (palm || y < 0.45) c.copy(sand);
        else c.copy(grass).lerp(grass2, 0.5 + 0.5 * Math.sin(gp.getX(v) * 0.9 + gp.getZ(v) * 1.3));
        colors.set([c.r, c.g, c.b], v * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.putColored(geo);
      this.colliders.push({ x: isl.x, z: isl.z, r: isl.r });

      if (isl === this.lighthouseIsland) continue;
      const topY = palm ? 0.62 : 1.02;
      const n = palm ? 1 + Math.floor(rnd() * 2) : 1 + Math.floor(isl.r / 2.2);
      for (let i = 0; i < n; i++) {
        const ta = rnd() * 6.28, tr = rnd() * isl.r * 0.32;
        this.tree(isl.x + Math.cos(ta) * tr, topY, isl.z + Math.sin(ta) * tr, 0.75 + rnd() * 0.45);
      }
      if (!palm) {
        for (let i = 0; i < 3; i++) {
          const ta = rnd() * 6.28, tr = isl.r * (0.45 + rnd() * 0.2);
          this.bush(isl.x + Math.cos(ta) * tr, 0.55, isl.z + Math.sin(ta) * tr, 0.5 + rnd() * 0.3);
        }
      }
    }
  }

  private buildRocks(): void {
    const m = this.map;
    const rnd = this.rnd;
    const grey = m.decor === 'pine' ? 0x858b95 : 0x9ba1aa;
    const top = new THREE.Color(m.decor === 'palm' ? 0xd8c690 : 0x7fae4e);
    let placed = 0, tries = 0;
    while (placed < m.rockCount && tries++ < 400) {
      const a = rnd() * Math.PI * 2;
      const dist = (0.15 + rnd() * 0.75) * m.radius;
      const r = 1.1 + rnd() * 1.5;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (!this.isFree(x, z, r + 7)) continue;
      this.rock(x, 0.05, z, r, grey, top, true);
      this.colliders.push({ x, z, r: r * 0.9 });
      this.foamCircles.push({ x, z, r: r * 0.92 });
      placed++;
    }
  }

  private rock(x: number, y: number, z: number, r: number, grey: number, top: THREE.Color, inWater: boolean): void {
    const ph = this.rnd() * 10;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) {
      const vx = p.getX(v), vy = p.getY(v), vz = p.getZ(v);
      const k = 1 + 0.18 * Math.sin(vx * 3.1 + vy * 1.7 + ph) * Math.cos(vz * 2.3 - vy * 1.1 + ph);
      p.setXYZ(v, vx * k * r, (vy < 0 ? vy * 0.5 : vy * 0.78) * k * r, vz * k * r);
    }
    geo.applyMatrix4(mat(x, y, z, 0, this.rnd() * 6, 0));
    const g = flat(geo);
    const n = g.attributes.normal as THREE.BufferAttribute;
    const base = new THREE.Color(grey);
    const c = new THREE.Color();
    const colors = new Float32Array(n.count * 3);
    for (let v = 0; v < n.count; v++) {
      c.copy(base).multiplyScalar(0.92 + 0.12 * Math.sin(Math.floor(v / 3) * 0.7));
      if (n.getY(v) > 0.72) c.lerp(top, inWater ? 0.55 : 0.75);
      colors.set([c.r, c.g, c.b], v * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.putColored(g);
  }

  // ---------------------------------------------------------------- vegetation

  private tree(x: number, y: number, z: number, s: number): void {
    const rnd = this.rnd;
    if (this.map.decor === 'pine') {
      this.put(TRUNK, 0x7a4f33, mat(x, y + 0.55 * s, z, 0, 0, 0, 0.8 * s, 0.7 * s, 0.8 * s));
      const g1 = rnd() < 0.5 ? 0x2f8f4e : 0x3d9c57, g2 = 0x2a7a44;
      for (let i = 0; i < 4; i++) {
        const w = (1.75 - i * 0.36) * s;
        this.put(PINE_CONE, i % 2 ? g1 : g2, mat(x, y + (1.45 + i * 0.85) * s, z, 0, rnd() * 6, 0, w, 1.45 * s, w));
      }
    } else if (this.map.decor === 'palm') {
      const lean = 0.18 + rnd() * 0.22, dir = rnd() * 6.28;
      let cx = x, cz = z, cy = y;
      for (let i = 0; i < 6; i++) {
        const t = (i + 1) / 6;
        const nx = x + Math.cos(dir) * lean * t * t * 3.4 * s, nz = z + Math.sin(dir) * lean * t * t * 3.4 * s;
        const ny = y + (i + 1) * 0.62 * s;
        const tilt = Math.atan2(Math.hypot(nx - cx, nz - cz), ny - cy);
        // Rz(-tilt) leans +Y toward +X, Ry(-dir) swings that toward the lean direction.
        this.put(PALM_SEG, i % 2 ? 0x9c6b43 : 0x86583a, mat((cx + nx) / 2, (cy + ny) / 2, (cz + nz) / 2, 0, -dir, -tilt, s * 0.9, s, s * 0.9));
        cx = nx;
        cy = ny;
        cz = nz;
      }
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
        this.put(LEAF, i % 2 ? 0x45a849 : 0x3b9443, mat(cx + Math.cos(a) * 1.05 * s, cy - 0.28 * s, cz - Math.sin(a) * 1.05 * s, 0, a, -0.5 - rnd() * 0.2, 1.35 * s, 0.07 * s, 0.34 * s));
      }
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * 6.28;
        this.put(TINY, 0x6d4526, mat(cx + Math.cos(a) * 0.2 * s, cy - 0.25 * s, cz + Math.sin(a) * 0.2 * s, 0, 0, 0, 0.17 * s));
      }
    } else {
      this.put(TRUNK, 0x8a5a3c, mat(x, y + 0.75 * s, z, 0, 0, 0, s));
      const leaves = [0x5cb85c, 0x6cc04a, 0x4fae52, 0x7cc95a];
      const base = new THREE.Color(leaves[Math.floor(rnd() * leaves.length)]);
      const light = base.clone().offsetHSL(0, 0, 0.06), dark = base.clone().offsetHSL(0, 0, -0.07);
      this.put(UNIT.blob, base, mat(x, y + 2.25 * s, z, 0, 0, 0, 1.25 * s, 1.05 * s, 1.25 * s));
      this.put(UNIT.blob, light, mat(x + 0.65 * s, y + 1.95 * s, z + 0.3 * s, 0, 0, 0, 0.85 * s));
      this.put(UNIT.blob, dark, mat(x - 0.6 * s, y + 2.0 * s, z - 0.25 * s, 0, 0, 0, 0.8 * s));
      this.put(UNIT.blob, light, mat(x + 0.1 * s, y + 2.95 * s, z - 0.1 * s, 0, 0, 0, 0.72 * s));
    }
  }

  private bush(x: number, y: number, z: number, s: number): void {
    const base = new THREE.Color(this.map.decor === 'pine' ? 0x3f9a4c : 0x5fb656).offsetHSL(0, 0, (this.rnd() - 0.5) * 0.08);
    this.put(UNIT.blob, base, mat(x, y + 0.35 * s, z, 0, 0, 0, s, 0.75 * s, s));
    this.put(UNIT.blob, base.clone().offsetHSL(0, 0, 0.05), mat(x + 0.55 * s, y + 0.25 * s, z + 0.2 * s, 0, 0, 0, 0.7 * s, 0.55 * s, 0.7 * s));
  }

  private isClear(x: number, z: number): boolean {
    return !this.clearZones.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r);
  }

  private buildShoreVegetation(): void {
    const m = this.map;
    const rnd = this.rnd;
    const place = (minOff: number, maxOff: number) => {
      for (let tries = 0; tries < 8; tries++) {
        const th = rnd() * Math.PI * 2;
        const off = minOff + rnd() * (maxOff - minOff);
        const r = this.shoreRadius(th) + off;
        const x = Math.cos(th) * r, z = Math.sin(th) * r;
        if (this.isClear(x, z)) return { x, z, y: this.groundAt(th, off) };
      }
      return null;
    };

    if (m.decor === 'palm') {
      for (let i = 0; i < 55; i++) {
        const p = place(3.2, 9);
        if (p) this.tree(p.x, p.y - 0.15, p.z, 0.8 + rnd() * 0.5);
      }
      for (let i = 0; i < 70; i++) {
        const p = place(2.5, 11);
        if (p) this.put(TUFT, 0x8fbf4f, mat(p.x, p.y + 0.18, p.z, 0, 0, (rnd() - 0.5) * 0.4, 0.12, 0.45, 0.12));
      }
      for (let i = 0; i < 9; i++) {
        const p = place(2.4, 5);
        if (p) this.umbrella(p.x, p.y, p.z, i);
      }
      return;
    }

    const trees = m.decor === 'pine' ? 120 : 70;
    for (let i = 0; i < trees; i++) {
      const p = place(5, 34);
      if (p) this.tree(p.x, p.y - 0.2, p.z, 0.85 + rnd() * 0.7);
    }
    for (let i = 0; i < 45; i++) {
      const p = place(3.2, 16);
      if (p) this.bush(p.x, p.y - 0.1, p.z, 0.5 + rnd() * 0.5);
    }
    const flowers = [0xff7eb6, 0xffffff, 0xffd23f, 0xb48cff];
    for (let i = 0; i < 90; i++) {
      const p = place(3.4, 14);
      if (p) this.put(TINY, flowers[i % flowers.length], mat(p.x, p.y + 0.12, p.z, 0, 0, 0, 0.13));
    }
    if (m.decor === 'pine') {
      const top = new THREE.Color(0x7b8a5a);
      for (let i = 0; i < 18; i++) {
        const p = place(1.6, 9);
        if (p) this.rock(p.x, p.y, p.z, 0.5 + rnd() * 0.8, 0x8f959e, top, false);
      }
    } else {
      // Cattail reeds standing in the shallows.
      for (let i = 0; i < 85; i++) {
        const p = place(-0.6, 1.4);
        if (!p) continue;
        for (let k = 0; k < 3; k++) {
          const h = 1.4 + rnd() * 1.4;
          const ox = p.x + (rnd() - 0.5) * 0.9, oz = p.z + (rnd() - 0.5) * 0.9;
          const lean = (rnd() - 0.5) * 0.2;
          this.put(REED, 0x6b9a33, mat(ox, -0.3 + h / 2, oz, lean, 0, lean, 0.045, h, 0.045));
          if (rnd() < 0.65) this.put(TINY, 0x7a4b2a, mat(ox + lean * h * 0.5, h - 0.25, oz - lean * h * 0.5, 0, 0, 0, 0.09, 0.26, 0.09));
        }
      }
    }
  }

  // ---------------------------------------------------------------- props

  private buildProps(): void {
    const d = this.map.decor;
    if (d === 'pine' || d === 'lily') this.buildDock(d === 'pine' ? 12 : 8);
    if (d === 'pine') this.buildCabin();
    if (d === 'palm') {
      this.buildLighthouse();
      this.buildBuoys();
    }
    if (d === 'lily') this.buildLilyPads();
  }

  private umbrella(x: number, y: number, z: number, i: number): void {
    const colors = [0xff5a5f, 0x3fa9ff, 0xffc93c, 0x4cd97b];
    const stripe = colors[i % colors.length];
    this.put(CYL, 0xf5f5f5, mat(x, y + 1.1, z, 0.08, 0, 0.05, 0.05, 2.2, 0.05));
    const cone = new THREE.ConeGeometry(1.35, 0.55, 10, 1).toNonIndexed();
    const n = cone.attributes.position.count;
    const ca = new THREE.Color(stripe), cb = new THREE.Color(0xffffff);
    const arr = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      // The first 10 × 6 vertices are the slanted sides, one radial segment per 6 vertices.
      const c = v < 60 && Math.floor(v / 6) % 2 ? ca : cb;
      arr.set([c.r, c.g, c.b], v * 3);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.putColored(cone, mat(x + 0.09, y + 2.25, z + 0.05, 0.08, i, 0.05));
    this.put(BOX, stripe, mat(x + 1, y + 0.03, z + 0.4, 0, i * 1.3, 0, 0.9, 0.04, 1.8));
  }

  private buildDock(len: number): void {
    const th = this.phase[0];
    const shore = this.shoreRadius(th);
    const ux = -Math.cos(th), uz = -Math.sin(th); // toward the arena centre
    const yaw = Math.atan2(ux, uz);
    const start = shore + 2.5;
    const end = shore - len;
    for (let r = start; r > end; r -= 0.52) {
      const c = new THREE.Color(0xb98a5e).multiplyScalar(0.9 + ((r * 7.3) % 1) * 0.2);
      this.put(BOX, c, mat(Math.cos(th) * r, 0.78, Math.sin(th) * r, 0, yaw, 0, 2.7, 0.12, 0.46));
    }
    for (let r = start; r >= end; r -= 2.6) {
      for (const side of [-1.25, 1.25]) {
        const px = Math.cos(th) * r + uz * side, pz = Math.sin(th) * r - ux * side;
        this.put(CYL, 0x6d4c35, mat(px, -0.5, pz, 0, 0, 0, 0.17, 2.9, 0.17));
        if (r < shore) this.foamCircles.push({ x: px, z: pz, r: 0.22 });
      }
    }
    // Circles along the part that sticks out over the water.
    for (let r = shore - 1.2; r > end - 0.5; r -= 2.4) {
      this.colliders.push({ x: Math.cos(th) * r, z: Math.sin(th) * r, r: 1.6 });
    }
    const mid = (start + end) / 2;
    this.clearZones.push({ x: Math.cos(th) * mid, z: Math.sin(th) * mid, r: (start - end) / 2 + 2 });
  }

  private buildCabin(): void {
    const th = this.phase[0] + 0.16;
    const off = 7.5;
    const r = this.shoreRadius(th) + off;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    const y = this.groundAt(th, off) - 0.1;
    const yaw = Math.atan2(-Math.cos(th), -Math.sin(th)); // door faces the water
    const g = new GeoBuilder();
    for (let i = 0; i < 6; i++) {
      const c = i % 2 ? 0x9b6a43 : 0x8a5c39;
      g.add(CYL, c, mat(0, 0.22 + i * 0.4, 1.6, 0, 0, Math.PI / 2, 0.22, 4.6, 0.22));
      g.add(CYL, c, mat(0, 0.22 + i * 0.4, -1.6, 0, 0, Math.PI / 2, 0.22, 4.6, 0.22));
      g.add(CYL, c, mat(2.1, 0.42 + i * 0.4, 0, Math.PI / 2, 0, 0, 0.22, 3.6, 0.22));
      g.add(CYL, c, mat(-2.1, 0.42 + i * 0.4, 0, Math.PI / 2, 0, 0, 0.22, 3.6, 0.22));
    }
    g.add(BOX, 0x7a5233, mat(0, 1.2, 0, 0, 0, 0, 4, 2.4, 3.1));
    g.add(BOX, 0xb5473a, mat(0, 3.25, 0.95, -0.62, 0, 0, 5, 0.18, 2.5));
    g.add(BOX, 0xa33f33, mat(0, 3.25, -0.95, 0.62, 0, 0, 5, 0.18, 2.5));
    g.add(BOX, 0x9aa1aa, mat(1.3, 3.7, -0.5, 0, 0, 0, 0.5, 1.4, 0.5));
    g.add(BOX, 0x5a3b24, mat(0, 0.85, 1.75, 0, 0, 0, 0.9, 1.6, 0.08));
    g.add(BOX, 0xbfe6ff, mat(-1.3, 1.4, 1.75, 0, 0, 0, 0.75, 0.6, 0.06));
    g.add(BOX, 0xbfe6ff, mat(1.3, 1.4, 1.75, 0, 0, 0, 0.75, 0.6, 0.06));
    this.putColored(g.build(), mat(x, y, z, 0, yaw, 0, 1.1));
    this.clearZones.push({ x, z, r: 5 });
  }

  private buildLighthouse(): void {
    const isl = this.lighthouseIsland;
    if (!isl) return;
    const g = new GeoBuilder();
    const bands = 6;
    for (let i = 0; i < bands; i++) {
      const rb = 1.05 - (i / bands) * 0.35;
      g.add(new THREE.CylinderGeometry(rb - 0.35 / bands, rb, 1, 16), i % 2 ? 0xffffff : 0xe8443a, mat(0, 0.5 + i, 0));
    }
    g.add(CYL, 0x37474f, mat(0, bands + 0.1, 0, 0, 0, 0, 1.05, 0.2, 1.05));
    g.add(CYL, 0xfff3a0, mat(0, bands + 0.75, 0, 0, 0, 0, 0.55, 1.1, 0.55));
    g.add(CONE, 0xe8443a, mat(0, bands + 1.75, 0, 0, 0, 0, 0.75, 0.9, 0.75));
    g.add(TINY, 0xffd23f, mat(0, bands + 2.3, 0, 0, 0, 0, 0.12));
    this.putColored(g.build(), mat(isl.x, 0.55, isl.z));
  }

  private buildBuoys(): void {
    const g = new GeoBuilder();
    g.add(CYL, 0xe8443a, mat(0, 0.1, 0, 0, 0, 0, 0.62, 0.7, 0.62));
    g.add(CYL, 0xffffff, mat(0, 0.6, 0, 0, 0, 0, 0.5, 0.35, 0.5));
    g.add(CONE, 0xe8443a, mat(0, 1.2, 0, 0, 0, 0, 0.45, 0.9, 0.45));
    g.add(TINY, 0xffe066, mat(0, 1.75, 0, 0, 0, 0, 0.16));
    const items: Floater[] = [];
    for (let i = 0; i < 10; i++) {
      const s = this.seededFreeSpot(4);
      if (!s) continue;
      items.push({ x: s.x, z: s.z, yaw: this.rnd() * 6, scale: 1, lift: 0, tilt: 0.16 });
      this.colliders.push({ x: s.x, z: s.z, r: 0.85 });
      this.foamCircles.push({ x: s.x, z: s.z, r: 0.55 });
    }
    this.addFloaters(g.build(), vertexColored, items, true);
  }

  private buildLilyPads(): void {
    const rnd = this.rnd;
    const pad = new THREE.CylinderGeometry(1, 1, 0.06, 18, 1, false, 0.35, Math.PI * 2 - 0.7);
    const pads: Floater[] = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const dist = Math.sqrt(rnd()) * this.map.radius * 0.98;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (!this.isFree(x, z, 1)) continue;
      pads.push({ x, z, yaw: rnd() * 6.28, scale: 0.6 + rnd() * 0.8, lift: 0.04, tilt: 0.02 });
    }
    const mesh = this.addFloaters(pad, new THREE.MeshLambertMaterial({ color: 0xffffff }), pads, false);
    const greens = [0x4caf50, 0x5cbf4a, 0x3f9f46].map((c) => new THREE.Color(c));
    pads.forEach((_, i) => mesh.setColorAt(i, greens[i % 3]));
    const f = new GeoBuilder();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      f.add(UNIT.sphere, 0xff9ec7, mat(Math.cos(a) * 0.17, 0.14, Math.sin(a) * 0.17, 0, -a, 0.6, 0.2, 0.07, 0.1));
    }
    f.add(UNIT.sphere, 0xffe066, mat(0, 0.16, 0, 0, 0, 0, 0.09));
    const flowers = pads.filter((_, i) => i % 4 === 0).map((p) => ({ ...p, scale: 1.1, lift: 0.06 }));
    this.addFloaters(f.build(), vertexColored, flowers, false);
  }

  private addFloaters(geo: THREE.BufferGeometry, material: THREE.Material, items: Floater[], shadow: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
    mesh.count = items.length;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.floaters.push({ mesh, items });
    return mesh;
  }

  private seededFreeSpot(margin: number): { x: number; z: number } | null {
    for (let i = 0; i < 100; i++) {
      const a = this.rnd() * Math.PI * 2;
      const dist = (0.2 + this.rnd() * 0.7) * this.map.radius;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (this.isFree(x, z, margin)) return { x, z };
    }
    return null;
  }

  // ---------------------------------------------------------------- gameplay spots & foam field

  private buildSpawns(): void {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let best = { x: 0, z: 0 };
      for (let f = 0.62; f > 0.1; f -= 0.06) {
        const r = this.shoreRadius(a) * f;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (this.isFree(x, z, 4)) {
          best = { x, z };
          break;
        }
      }
      this.spawnPoints.push({ ...best, heading: Math.atan2(-best.x, -best.z) });
    }
  }

  private buildPickupSpots(): void {
    const m = this.map;
    let tries = 0;
    while (this.pickupSpots.length < m.pickupCount && tries++ < 2000) {
      const a = this.rnd() * Math.PI * 2;
      const dist = Math.sqrt(this.rnd()) * m.radius * 0.85;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (!this.isFree(x, z, 3)) continue;
      if (this.pickupSpots.some((p) => Math.hypot(p.x - x, p.z - z) < m.radius * 0.22)) continue;
      this.pickupSpots.push({ x, z });
    }
  }

  /** Distance from every water point to the nearest land, sampled into a texture for foam & colour. */
  private buildLandField(): void {
    let maxR = 0;
    for (let i = 0; i < 360; i++) maxR = Math.max(maxR, this.shoreRadius((i / 360) * Math.PI * 2));
    const E = maxR + 6;
    const N = Math.min(512, Math.ceil((2 * E) / 0.45));
    const data = new Uint8Array(N * N);
    for (let iz = 0; iz < N; iz++) {
      const z = ((iz + 0.5) / N) * 2 * E - E;
      for (let ix = 0; ix < N; ix++) {
        const x = ((ix + 0.5) / N) * 2 * E - E;
        let dist = this.shoreRadius(Math.atan2(z, x)) - 0.1 - Math.hypot(x, z);
        if (dist > 0) {
          for (const isl of this.islands) {
            const dx = x - isl.x, dz = z - isl.z;
            if (Math.abs(dx) - isl.r * 1.1 > dist || Math.abs(dz) - isl.r * 1.1 > dist) continue;
            const dd = Math.hypot(dx, dz) - isl.r * this.islandK(isl, Math.atan2(dz, dx));
            if (dd < dist) dist = dd;
          }
          for (const c of this.foamCircles) {
            const dd = Math.hypot(x - c.x, z - c.z) - c.r;
            if (dd < dist) dist = dd;
          }
        }
        data[iz * N + ix] = Math.round(Math.min(1, Math.max(0, dist / LAND_FIELD_RANGE)) * 255);
      }
    }
    this.landField = data;
    this.landSize = N;
    this.landExtent = E;
  }
}
