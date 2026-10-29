import * as THREE from 'three';
import type { Boat } from '../Boat';
import type { Combat } from '../Combat';

// Tracer bullets for the Deck Gun and Patrol Drone. All bullets share one InstancedMesh.

interface Bullet {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  life: number;
  owner: Boat;
  dmg: number;
  icon: string;
}

const MAX = 240;
const _o = new THREE.Object3D();

export class BulletLayer {
  readonly mesh: THREE.InstancedMesh;
  private list: Bullet[] = [];

  constructor(private c: Combat) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffe08a }), MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.renderOrder = 6;
  }

  fire(owner: Boat, x: number, y: number, z: number, heading: number, speed: number, life: number, dmg: number, icon: string): void {
    if (this.list.length >= MAX) return;
    this.list.push({ x, y, z, vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed, heading, life, owner, dmg, icon });
  }

  threatens(b: Boat): boolean {
    return this.list.some((u) => u.owner !== b && (u.x - b.x) ** 2 + (u.z - b.z) ** 2 < 36);
  }

  clear(): void {
    this.list.length = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    const c = this.c;
    const P = c.host.particles;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const u = this.list[i];
      u.life -= dt;
      u.x += u.vx * dt;
      u.z += u.vz * dt;
      const target = c.hitTest(u.x, u.z, 0.25, u.owner);
      if (target) {
        c.hit(target, u.dmg, u.owner, u.icon, u.vx * 0.015, u.vz * 0.015);
        P.emit(u.x, u.y, u.z, 3, 0xffd27a, { glow: true, speed: 3, up: 2, life: 0.18, size: 0.35, gravity: 0 });
      } else if (c.blocked(u.x, u.z)) {
        P.emit(u.x, u.y, u.z, 3, 0xd8dde3, { speed: 2.5, up: 2.5, life: 0.3, size: 0.22 });
      } else if (u.life <= 0) {
        P.emit(u.x, c.waveY(u.x, u.z), u.z, 2, 0xf2fbff, { speed: 1, up: 3, life: 0.35, size: 0.2 });
      } else {
        continue;
      }
      this.list.splice(i, 1);
    }
    this.list.forEach((u, i) => {
      _o.position.set(u.x, u.y, u.z);
      _o.rotation.set(0, u.heading, 0);
      _o.scale.set(0.07, 0.07, 0.9);
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
