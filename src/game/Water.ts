import * as THREE from 'three';
import { WAVE_GLSL } from './waves';
import type { MapDef } from './config';

/** Low-poly animated water: displaced plane, flat shaded, coloured by wave height. */
export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms = {
    uTime: { value: 0 },
    uAmp: { value: 0.2 },
    uShallow: { value: new THREE.Color() },
    uDeep: { value: new THREE.Color() },
  };

  constructor(map: MapDef) {
    const size = map.radius * 2 + 260;
    const segs = Math.min(150, Math.round(size / 2.6));
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    this.uniforms.uAmp.value = map.waveAmp;
    this.uniforms.uShallow.value.setHex(map.waterShallow);
    this.uniforms.uDeep.value.setHex(map.waterDeep);

    const mat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      flatShading: true,
      shininess: 50,
      specular: 0x4a6a7a,
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WAVE_GLSL}\nvarying float vH;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float h = waveHeight(transformed.xz);
           transformed.y += h;
           vH = h / max(uAmp, 0.001);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\nuniform vec3 uShallow;\nuniform vec3 uDeep;\nvarying float vH;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float k = smoothstep(-1.6, 1.8, vH);
           diffuseColor.rgb = mix(uDeep, uShallow, k);`,
        );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }
}
