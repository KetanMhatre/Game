import * as THREE from 'three';
import { WAVE_GLSL } from './waves';
import type { MapDef } from './config';
import type { Arena } from './Arena';

/** Max distance (world units) encoded in the land-distance texture. */
export const LAND_FIELD_RANGE = 20;

const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/**
 * Stylised water: smooth analytic wave normals, shallow→deep colour from a land-distance
 * field, animated shore foam, ripple sparkle, sky fresnel and crest foam. Built on Phong so it
 * keeps three.js fog and shadow receiving for free.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(map: MapDef, arena: Arena) {
    const size = map.radius * 2 + 300;
    const segs = Math.min(180, Math.round(size / 2.4));
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const land = new THREE.DataTexture(arena.landField, arena.landSize, arena.landSize, THREE.RedFormat, THREE.UnsignedByteType);
    land.magFilter = land.minFilter = THREE.LinearFilter;
    land.wrapS = land.wrapT = THREE.ClampToEdgeWrapping;
    land.needsUpdate = true;

    this.uniforms = {
      uTime: { value: 0 },
      uAmp: { value: map.waveAmp },
      uShallow: { value: new THREE.Color(map.waterShallow) },
      uDeep: { value: new THREE.Color(map.waterDeep) },
      uSky: { value: new THREE.Color(map.skyHorizon) },
      uFoam: { value: new THREE.Color(0xffffff) },
      uLand: { value: land },
      uLandExtent: { value: arena.landExtent },
      uCrest: { value: map.waveAmp > 0.3 ? 1 : 0 },
    };

    const mat = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      shininess: 140,
      specular: new THREE.Color(0xffffff).multiplyScalar(0.32),
    });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WAVE_GLSL}\nvarying vec2 vWXZ;\nvarying float vH;`)
        .replace(
          '#include <beginnormal_vertex>',
          `vec2 wg = waveGrad(position.xz);
           vec3 objectNormal = normalize(vec3(-wg.x, 1.0, -wg.y));
           #ifdef USE_TANGENT
             vec3 objectTangent = vec3(tangent.xyz);
           #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
           float wh = waveHeight(position.xz);
           transformed.y += wh;
           vH = wh / max(uAmp, 0.001);
           vWXZ = position.xz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uTime;
           uniform vec3 uShallow, uDeep, uSky, uFoam;
           uniform sampler2D uLand;
           uniform float uLandExtent, uCrest;
           varying vec2 vWXZ;
           varying float vH;
           ${NOISE_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           float landD = texture2D(uLand, vWXZ / (2.0 * uLandExtent) + 0.5).r * ${LAND_FIELD_RANGE.toFixed(1)};
           float nA = vnoise(vWXZ * 0.12 + vec2(uTime * 0.04, uTime * 0.03));
           float deepK = smoothstep(0.3, 15.0, landD + (nA - 0.5) * 5.0);
           vec3 waterCol = mix(uShallow, uDeep, deepK);
           waterCol *= 0.9 + 0.2 * smoothstep(-1.4, 2.0, vH);
           diffuseColor.rgb = waterCol;`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
           vec2 rp = vWXZ * 0.85;
           float r1 = vnoise(rp + vec2(uTime * 0.55, uTime * 0.21));
           float r2 = vnoise(rp * 1.9 - vec2(uTime * 0.28, uTime * 0.62));
           vec3 pert = vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.26;
           normal = normalize(normal + (viewMatrix * vec4(pert, 0.0)).xyz);`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float nF = vnoise(vWXZ * 0.55 + uTime * 0.22);
           float edge = 1.0 - smoothstep(0.1, 0.65 + nF * 0.7, landD);
           float band = fract(landD * 0.42 + uTime * 0.3 + nF * 0.4);
           float lines = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.09, 0.2, band));
           lines *= 1.0 - smoothstep(0.6, 4.2, landD);
           float crest = smoothstep(2.15, 2.7, vH + nF * 0.7) * uCrest;
           float foam = clamp(max(edge, lines * 0.7) + crest * 0.4, 0.0, 1.0);
           vec3 vdir = normalize(vViewPosition);
           float fres = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 5.0);
           outgoingLight = mix(outgoingLight, uSky, fres * 0.3);
           outgoingLight = mix(outgoingLight, uFoam, foam * 0.9);
           #include <opaque_fragment>`,
        );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  dispose(): void {
    (this.uniforms.uLand.value as THREE.Texture).dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
