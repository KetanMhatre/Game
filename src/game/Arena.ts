import * as THREE from 'three';
import type { MapDef } from './config';
import { mulberry32 } from './util';
import { waveHeight } from './waves';

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

interface Floater {
  obj: THREE.Object3D;
  x: number;
  z: number;
  lift: number;
  tilt: boolean;
}

const matCache = new Map<number, THREE.MeshLambertMaterial>();
export function lambert(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    matCache.set(color, m);
  }
  return m;
}

function jitter(geo: THREE.BufferGeometry, amount: number, rnd: () => number, keepBottom = false): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  // Jitter shared positions consistently so the mesh stays watertight.
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let off = seen.get(key);
    if (!off) {
      off = [(rnd() - 0.5) * amount, keepBottom && y <= 0 ? 0 : (rnd() - 0.5) * amount, (rnd() - 0.5) * amount];
      seen.set(key, off);
    }
    pos.setXYZ(i, x + off[0], y + off[1], z + off[2]);
  }
  geo.computeVertexNormals();
}

export class Arena {
  readonly group = new THREE.Group();
  readonly colliders: Collider[] = [];
  readonly spawnPoints: Spot[] = [];
  readonly pickupSpots: { x: number; z: number }[] = [];
  private floaters: Floater[] = [];
  private clouds: THREE.Object3D[] = [];
  private phase: number[];
  private rnd: () => number;

  constructor(readonly map: MapDef) {
    this.rnd = mulberry32(map.seed);
    this.phase = [this.rnd() * 6.28, this.rnd() * 6.28, this.rnd() * 6.28];
    this.buildTerrain();
    this.buildIslands();
    this.buildRocks();
    this.buildDecor();
    this.buildClouds();
    this.buildSpawns();
    this.buildPickupSpots();
  }

  /** Distance from the arena centre to the water's edge at angle theta. */
  shoreRadius(theta: number): number {
    const [a, b, c] = this.phase;
    const n = Math.sin(3 * theta + a) * 0.5 + Math.sin(5 * theta + b) * 0.3 + Math.sin(7 * theta + c) * 0.2;
    return this.map.radius * (1 + this.map.shoreNoise * n);
  }

  /** True if a circle of the given radius at (x,z) is open water. */
  isFree(x: number, z: number, margin: number): boolean {
    const d = Math.hypot(x, z);
    if (d > this.shoreRadius(Math.atan2(z, x)) - 1 - margin) return false;
    for (const c of this.colliders) {
      if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + margin) ** 2) return false;
    }
    return true;
  }

  /** Pushes a circle out of the shore and obstacles, bouncing its velocity. Returns impact speed. */
  resolve(p: { x: number; z: number }, v: { x: number; z: number }, radius: number, bounce: number): number {
    let impact = 0;
    const d = Math.hypot(p.x, p.z);
    const lim = this.shoreRadius(Math.atan2(p.z, p.x)) - 1 - radius;
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

  update(time: number, dt: number): void {
    const amp = this.map.waveAmp;
    for (const f of this.floaters) {
      f.obj.position.y = waveHeight(f.x, f.z, time, amp) + f.lift;
      if (f.tilt) {
        f.obj.rotation.x = Math.sin(time * 1.3 + f.x) * 0.12 * (amp * 4 + 0.3);
        f.obj.rotation.z = Math.cos(time * 1.1 + f.z) * 0.12 * (amp * 4 + 0.3);
      }
    }
    for (const c of this.clouds) {
      c.position.x += dt * 1.5;
      if (c.position.x > this.map.radius + 150) c.position.x = -this.map.radius - 150;
    }
  }

  // ---------------------------------------------------------------- building

  private buildTerrain(): void {
    const m = this.map;
    const rnd = this.rnd;
    let offsets: number[], heights: number[], jit: number[];
    if (m.decor === 'palm') {
      offsets = [-6, -1.5, 0.6, 3, 7, 11, 15, 22, 400];
      heights = [-2.5, -0.5, 0.35, 0.8, 0.7, 0.4, -0.6, -3, -3];
      jit = [0, 0.1, 0.1, 0.2, 0.3, 0.2, 0.1, 0, 0];
    } else if (m.decor === 'pine') {
      offsets = [-6, -1.5, 0.6, 3, 8, 18, 40, 80, 220];
      heights = [-2.5, -0.5, 0.35, 0.9, 1.8, 4, 12, 30, 40];
      jit = [0, 0.1, 0.1, 0.3, 0.6, 1.5, 6, 16, 12];
    } else {
      offsets = [-6, -1.5, 0.6, 3, 8, 18, 40, 90, 200];
      heights = [-2.5, -0.5, 0.35, 0.8, 1.4, 2.5, 4, 8, 10];
      jit = [0, 0.1, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 2];
    }
    const A = 128;
    const positions: number[] = [];
    const colors: number[] = [];
    const sand = new THREE.Color(m.sand);
    const wetSand = sand.clone().multiplyScalar(0.75);
    const grass = new THREE.Color(m.grass);
    const rock = new THREE.Color(0x8a8f99);
    const snow = new THREE.Color(0xf4f7fb);
    const col = new THREE.Color();

    for (let i = 0; i < offsets.length; i++) {
      for (let j = 0; j < A; j++) {
        const th = (j / A) * Math.PI * 2;
        const r = this.shoreRadius(th) + offsets[i] + (i > 1 ? (rnd() - 0.5) * 2 : 0);
        const y = heights[i] + (rnd() - 0.3) * jit[i];
        positions.push(Math.cos(th) * r, y, Math.sin(th) * r);
        if (m.decor === 'palm') col.copy(y < 0.3 ? wetSand : sand);
        else if (offsets[i] <= 0.6) col.copy(y < 0.3 ? wetSand : sand);
        else if (offsets[i] <= 3) col.copy(sand);
        else if (y > 30) col.copy(snow);
        else if (y > 11) col.copy(rock);
        else col.copy(grass).multiplyScalar(0.9 + rnd() * 0.2);
        colors.push(col.r, col.g, col.b);
      }
    }
    const index: number[] = [];
    for (let i = 0; i < offsets.length - 1; i++) {
      for (let j = 0; j < A; j++) {
        const a = i * A + j, b = i * A + ((j + 1) % A), c = (i + 1) * A + j, d = (i + 1) * A + ((j + 1) % A);
        index.push(a, b, c, b, d, c); // counter-clockwise seen from above → faces point up
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.group.add(mesh);

    // Lake bed so deep water doesn't look like a void at grazing angles.
    const bed = new THREE.Mesh(new THREE.CircleGeometry(m.radius * 1.5, 24), lambert(m.waterDeep));
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = -2.6;
    this.group.add(bed);

    // Shore vegetation.
    const treeCount = m.decor === 'palm' ? 45 : 90;
    for (let k = 0; k < treeCount; k++) {
      const th = rnd() * Math.PI * 2;
      const off = m.decor === 'palm' ? 3 + rnd() * 5 : 5 + rnd() * 26;
      const r = this.shoreRadius(th) + off;
      const t = this.makeTree(0.8 + rnd() * 0.7);
      t.position.set(Math.cos(th) * r, this.terrainHeightAt(offsets, heights, off) - 0.2, Math.sin(th) * r);
      t.rotation.y = rnd() * 6.28;
      this.group.add(t);
    }
  }

  private terrainHeightAt(offsets: number[], heights: number[], off: number): number {
    for (let i = 0; i < offsets.length - 1; i++) {
      if (off <= offsets[i + 1]) {
        const t = (off - offsets[i]) / (offsets[i + 1] - offsets[i]);
        return heights[i] + (heights[i + 1] - heights[i]) * t;
      }
    }
    return heights[heights.length - 1];
  }

  private buildIslands(): void {
    const m = this.map;
    const rnd = this.rnd;
    const placed: Collider[] = [];
    let tries = 0;
    while (placed.length < m.islandCount && tries++ < 500) {
      const a = rnd() * Math.PI * 2;
      const dist = (0.22 + rnd() * 0.55) * m.radius;
      const r = (m.decor === 'palm' ? 3.5 : 2.6) + rnd() * (m.decor === 'palm' ? 4.5 : 3.6);
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (dist + r > this.shoreRadius(a) - 12) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 10)) continue;
      placed.push({ x, z, r });
    }
    for (const c of placed) {
      const g = new THREE.Group();
      const baseGeo = new THREE.CylinderGeometry(c.r * 0.8, c.r * 1.25, 3.2, 10, 1);
      jitter(baseGeo, 0.5, rnd);
      const base = new THREE.Mesh(baseGeo, lambert(m.sand));
      g.add(base);
      if (m.decor !== 'palm') {
        const capGeo = new THREE.CylinderGeometry(c.r * 0.55, c.r * 0.78, 0.7, 10, 1);
        jitter(capGeo, 0.25, rnd);
        const cap = new THREE.Mesh(capGeo, lambert(m.grass));
        cap.position.y = 1.8;
        g.add(cap);
      }
      const trees = m.decor === 'palm' ? 1 + Math.floor(rnd() * 2) : 1 + Math.floor(c.r / 2);
      for (let i = 0; i < trees; i++) {
        const t = this.makeTree(0.7 + rnd() * 0.5);
        const ta = rnd() * 6.28, tr = rnd() * c.r * 0.35;
        t.position.set(Math.cos(ta) * tr, m.decor === 'palm' ? 1.5 : 2.1, Math.sin(ta) * tr);
        t.rotation.y = rnd() * 6.28;
        g.add(t);
      }
      g.position.set(c.x, -1.5, c.z);
      this.group.add(g);
      this.addFoamRing(c.x, c.z, c.r * 1.2);
      this.colliders.push({ x: c.x, z: c.z, r: c.r * 1.12 });
    }
  }

  private buildRocks(): void {
    const m = this.map;
    const rnd = this.rnd;
    let placed = 0, tries = 0;
    while (placed < m.rockCount && tries++ < 400) {
      const a = rnd() * Math.PI * 2;
      const dist = (0.15 + rnd() * 0.75) * m.radius;
      const r = 1 + rnd() * 1.6;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (!this.isFree(x, z, r + 7)) continue;
      const geo = new THREE.DodecahedronGeometry(r, 0);
      jitter(geo, r * 0.35, rnd);
      const rock = new THREE.Mesh(geo, lambert(m.decor === 'pine' ? 0x7d838c : 0x9aa0a6));
      rock.scale.y = 0.8 + rnd() * 0.5;
      rock.position.set(x, 0.1, z);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      this.group.add(rock);
      this.addFoamRing(x, z, r * 1.15);
      this.colliders.push({ x, z, r: r * 0.95 });
      placed++;
    }
  }

  private buildDecor(): void {
    const m = this.map;
    const rnd = this.rnd;
    if (m.decor === 'lily') {
      const padMat = lambert(0x4caf50);
      const flowerMat = lambert(0xff80ab);
      for (let i = 0; i < 60; i++) {
        const a = rnd() * Math.PI * 2;
        const dist = Math.sqrt(rnd()) * m.radius * 0.95;
        const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
        if (!this.isFree(x, z, 1)) continue;
        const r = 0.6 + rnd() * 0.9;
        const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 9, 0.3, Math.PI * 2 - 0.6), padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = rnd() * 6.28;
        const holder = new THREE.Group();
        holder.add(pad);
        if (rnd() < 0.25) {
          const f = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.35, 5), flowerMat);
          f.position.y = 0.15;
          holder.add(f);
        }
        holder.position.set(x, 0, z);
        this.group.add(holder);
        this.floaters.push({ obj: holder, x, z, lift: 0.06, tilt: false });
      }
      // Reeds along the shore.
      const reedMat = lambert(0x6b8e23);
      const tipMat = lambert(0x6d4c41);
      for (let i = 0; i < 70; i++) {
        const th = rnd() * Math.PI * 2;
        const r = this.shoreRadius(th) - 0.5 + rnd() * 2;
        const reed = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const h = 1.5 + rnd() * 1.5;
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 4), reedMat);
          stem.position.set((rnd() - 0.5) * 0.8, h / 2, (rnd() - 0.5) * 0.8);
          reed.add(stem);
          if (rnd() < 0.6) {
            const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 5), tipMat);
            tip.position.set(stem.position.x, h - 0.1, stem.position.z);
            reed.add(tip);
          }
        }
        reed.position.set(Math.cos(th) * r, -0.3, Math.sin(th) * r);
        this.group.add(reed);
      }
    } else if (m.decor === 'pine') {
      // A wooden jetty sticking out from the shore.
      const th = this.phase[0];
      const shore = this.shoreRadius(th);
      const dock = new THREE.Group();
      const plankMat = lambert(0xa1887f);
      const len = 12;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.25, len), plankMat);
      deck.position.set(0, 1.1, -len / 2);
      dock.add(deck);
      for (let k = 0; k <= 3; k++) {
        for (const sx of [-1.3, 1.3]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 5), lambert(0x6d4c41));
          post.position.set(sx, -0.3, -(k / 3) * len);
          dock.add(post);
        }
      }
      dock.position.set(Math.cos(th) * (shore + 1), 0, Math.sin(th) * (shore + 1));
      dock.lookAt(0, 0, 0);
      dock.rotateY(Math.PI);
      this.group.add(dock);
      for (let k = 1; k <= 3; k++) {
        const r = shore + 1 - (k / 3) * len + 1.5;
        this.colliders.push({ x: Math.cos(th) * r, z: Math.sin(th) * r, r: 1.9 });
      }
    } else {
      // Bobbing buoys.
      for (let i = 0; i < 10; i++) {
        const spot = this.randomSeededSpot(4);
        if (!spot) continue;
        const b = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 1.2, 8), lambert(i % 2 ? 0xff5252 : 0xffffff));
        body.position.y = 0.3;
        const top = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 6), lambert(0xff5252));
        top.position.y = 1.5;
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff59d }));
        light.position.y = 2.15;
        b.add(body, top, light);
        b.position.set(spot.x, 0, spot.z);
        this.group.add(b);
        this.floaters.push({ obj: b, x: spot.x, z: spot.z, lift: 0, tilt: true });
        this.colliders.push({ x: spot.x, z: spot.z, r: 0.9 });
      }
    }
  }

  private randomSeededSpot(margin: number): { x: number; z: number } | null {
    for (let i = 0; i < 100; i++) {
      const a = this.rnd() * Math.PI * 2;
      const dist = (0.2 + this.rnd() * 0.7) * this.map.radius;
      const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
      if (this.isFree(x, z, margin)) return { x, z };
    }
    return null;
  }

  private addFoamRing(x: number, z: number, r: number): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.92, r * 1.25, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(ring);
    holder.position.set(x, 0, z);
    this.group.add(holder);
    this.floaters.push({ obj: holder, x, z, lift: 0.05, tilt: false });
  }

  private buildClouds(): void {
    const rnd = this.rnd;
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x666666 });
    for (let i = 0; i < 14; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + rnd() * 3, 0), mat);
        s.position.set(k * 4 - n * 2, rnd() * 2, (rnd() - 0.5) * 4);
        c.add(s);
      }
      c.scale.y = 0.6;
      const a = rnd() * Math.PI * 2, d = rnd() * (this.map.radius + 100);
      c.position.set(Math.cos(a) * d, 45 + rnd() * 25, Math.sin(a) * d);
      this.group.add(c);
      this.clouds.push(c);
    }
  }

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

  private makeTree(scale: number): THREE.Object3D {
    const g = new THREE.Group();
    const rnd = this.rnd;
    const trunkMat = lambert(0x8d6e63);
    if (this.map.decor === 'pine') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.5, 5), trunkMat);
      trunk.position.y = 0.75;
      g.add(trunk);
      const green = lambert(rnd() < 0.5 ? 0x2e7d32 : 0x388e3c);
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6 - i * 0.4, 2, 7), green);
        cone.position.y = 2 + i * 1.1;
        g.add(cone);
      }
    } else if (this.map.decor === 'palm') {
      let y = 0, x = 0;
      const lean = 0.12 + rnd() * 0.12;
      for (let i = 0; i < 5; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.1, 5), trunkMat);
        seg.position.set(x, y + 0.55, 0);
        seg.rotation.z = -lean * i * 0.6;
        g.add(seg);
        y += 1.0;
        x += lean * i * 0.6;
      }
      const leafMat = lambert(0x43a047);
      for (let i = 0; i < 6; i++) {
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.7), leafMat);
        const pivot = new THREE.Group();
        leaf.position.x = 1.2;
        leaf.rotation.z = -0.35;
        pivot.add(leaf);
        pivot.rotation.y = (i / 6) * Math.PI * 2;
        pivot.position.set(x, y + 0.1, 0);
        g.add(pivot);
      }
      const nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), lambert(0x6d4c41));
      nut.position.set(x + 0.2, y - 0.2, 0.15);
      g.add(nut);
    } else {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 5), trunkMat);
      trunk.position.y = 0.8;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 0), lambert(rnd() < 0.5 ? 0x66bb6a : 0x7cb342));
      crown.position.y = 2.4;
      crown.scale.y = 0.85;
      g.add(trunk, crown);
    }
    g.scale.setScalar(scale);
    return g;
  }
}
