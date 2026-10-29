import * as THREE from 'three';
import { BOAT } from './config';
import type { Boat } from './Boat';
import { waveHeight } from './waves';

const SAMPLES = 28;
const LIFE = 1.7;
const SPACING = 0.55;

interface Sample {
  x: number;
  z: number;
  rx: number;
  rz: number;
  age: number;
  strength: number;
}

const material = new THREE.MeshBasicMaterial({
  vertexColors: true,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});

/** Foam ribbon trailing behind a boat: three vertices across (edges bright, centre faint), spreading as it ages. */
export class Wake {
  readonly mesh: THREE.Mesh;
  private samples: Sample[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private lastX = 0;
  private lastZ = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(SAMPLES * 3 * 3);
    this.col = new Float32Array(SAMPLES * 3 * 4);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 3, b = (i + 1) * 3;
      idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  reset(): void {
    this.samples.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  update(dt: number, b: Boat, time: number, amp: number): void {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > LIFE) this.samples.pop();

    const fx = b.forwardX, fz = b.forwardZ;
    const sx = b.x - fx * 1.15, sz = b.z - fz * 1.15;
    const speed = b.speed;
    if (b.alive && speed > 1.2 && Math.hypot(sx - this.lastX, sz - this.lastZ) > SPACING) {
      this.samples.unshift({
        x: sx,
        z: sz,
        rx: -fz,
        rz: fx,
        age: 0,
        strength: Math.min(1.2, speed / BOAT.maxSpeed) * (b.turboT > 0 ? 1.4 : 1),
      });
      if (this.samples.length > SAMPLES) this.samples.pop();
      this.lastX = sx;
      this.lastZ = sz;
    }

    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const s = i === 0 && b.alive ? { ...this.samples[0], x: sx, z: sz } : this.samples[i];
      const k = s.age / LIFE;
      const w = 0.45 + s.age * 1.5;
      const y = waveHeight(s.x, s.z, time, amp) + 0.05;
      const fade = Math.pow(1 - k, 1.6) * Math.min(1, s.strength) * (i === 0 ? 0.4 : 1);
      const p = i * 9;
      this.pos[p] = s.x - s.rx * w;
      this.pos[p + 1] = y;
      this.pos[p + 2] = s.z - s.rz * w;
      this.pos[p + 3] = s.x;
      this.pos[p + 4] = y;
      this.pos[p + 5] = s.z;
      this.pos[p + 6] = s.x + s.rx * w;
      this.pos[p + 7] = y;
      this.pos[p + 8] = s.z + s.rz * w;
      const c = i * 12;
      for (let v = 0; v < 3; v++) {
        this.col[c + v * 4] = 1;
        this.col[c + v * 4 + 1] = 1;
        this.col[c + v * 4 + 2] = 1;
        this.col[c + v * 4 + 3] = (v === 1 ? 0.25 : 0.75) * fade;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, n - 1) * 12);
  }
}
