import * as THREE from 'three';
import type { MapDef } from './config';
import { GeoBuilder, UNIT, mat } from './render/GeoBuilder';
import { mulberry32 } from './util';

/** Gradient sky dome with a sun glow, plus a ring of puffy stylised clouds. */
export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private clouds: THREE.Mesh;

  constructor(map: MapDef, sunDir: THREE.Vector3) {
    const mat0 = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(map.skyTop) },
        uHorizon: { value: new THREE.Color(map.skyHorizon) },
        uBottom: { value: new THREE.Color(map.skyHorizon).lerp(new THREE.Color(map.waterDeep), 0.35) },
        uSunDir: { value: sunDir.clone().normalize() },
        uSun: { value: new THREE.Color(0xfff2d0) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 col = d.y > 0.0
            ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, d.y), 0.75))
            : mix(uHorizon, uBottom, smoothstep(0.0, -0.15, d.y));
          float s = max(dot(d, uSunDir), 0.0);
          col += uSun * (pow(s, 900.0) * 1.6 + pow(s, 40.0) * 0.22 + pow(s, 6.0) * 0.08);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat0);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    // Clouds: clusters of soft blobs with flat bottoms, all merged into one mesh.
    const rnd = mulberry32(map.seed * 7 + 3);
    const b = new GeoBuilder();
    const flatBottom = UNIT.blobHi.clone();
    const pos = flatBottom.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0) pos.setY(i, pos.getY(i) * 0.35);
    flatBottom.computeVertexNormals();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
      const d = map.radius + 70 + rnd() * 120;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, cy = 38 + rnd() * 34;
      const n = 4 + Math.floor(rnd() * 4);
      const yaw = rnd() * Math.PI;
      for (let k = 0; k < n; k++) {
        const along = (k - n / 2) * 4.2 + (rnd() - 0.5) * 2;
        const s = 4 + rnd() * 3.5 - Math.abs(k - n / 2) * 0.5;
        b.add(
          flatBottom,
          0xffffff,
          mat(cx + Math.cos(yaw) * along, cy + rnd() * 1.5 + (s - 4) * 0.4, cz + Math.sin(yaw) * along, 0, rnd() * 3, 0, s * 1.25, s * 0.85, s),
        );
      }
    }
    this.clouds = new THREE.Mesh(
      b.build(),
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xb9d3ec, emissiveIntensity: 0.55, fog: false }),
    );
    this.group.add(this.dome, this.clouds);
  }

  update(camera: THREE.Camera, dt: number): void {
    this.dome.position.copy(camera.position);
    this.clouds.rotation.y += dt * 0.003;
  }

  dispose(): void {
    for (const m of [this.dome, this.clouds]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}
