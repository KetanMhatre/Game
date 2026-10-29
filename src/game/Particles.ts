import * as THREE from 'three';

const MAX = 900;

/** One InstancedMesh for every particle in the game: a single draw call. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private maxLife = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private next = 0;
  private dummy = new THREE.Object3D();
  private col = new THREE.Color();

  constructor() {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    // Unlit: particles stay bright from every angle and cost less to shade.
    const mat = new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.col.set(0xffffff));
    }
  }

  emit(
    x: number, y: number, z: number, count: number, color: number,
    opts: { speed?: number; up?: number; life?: number; size?: number; gravity?: number; spread?: number } = {},
  ): void {
    const speed = opts.speed ?? 6, up = opts.up ?? 6, life = opts.life ?? 0.8, size = opts.size ?? 0.3;
    const gravity = opts.gravity ?? 18, spread = opts.spread ?? 0.3;
    this.col.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.px[i] = x + (Math.random() - 0.5) * spread;
      this.py[i] = y;
      this.pz[i] = z + (Math.random() - 0.5) * spread;
      this.vx[i] = Math.cos(a) * s;
      this.vz[i] = Math.sin(a) * s;
      this.vy[i] = up * (0.5 + Math.random() * 0.7);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6);
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.grav[i] = gravity;
      this.rot[i] = Math.random() * 6;
      this.mesh.setColorAt(i, this.col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const d = this.dummy;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        d.scale.setScalar(0);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += dt * 5;
      d.position.set(this.px[i], this.py[i], this.pz[i]);
      d.rotation.set(this.rot[i], this.rot[i] * 0.7, 0);
      d.scale.setScalar(this.size[i] * (this.life[i] / this.maxLife[i]));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.update(0);
  }
}
