// Wave height function shared by the water shader (GPU) and boat bobbing (CPU).
// Keep WAVE_GLSL and waveHeight() in sync. Peak height is 2.8 × amp.

export function waveHeight(x: number, z: number, t: number, amp: number): number {
  return (
    amp *
    (Math.sin(x * 0.16 + t * 1.3) +
      Math.sin(z * 0.21 + t * 1.0) * 0.8 +
      Math.sin((x + z) * 0.09 + t * 1.6) * 0.6 +
      Math.sin((x * 0.6 - z) * 0.12 + t * 0.8) * 0.4)
  );
}

export const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uAmp;
float waveHeight(vec2 p) {
  return uAmp * (sin(p.x * 0.16 + uTime * 1.3)
    + sin(p.y * 0.21 + uTime * 1.0) * 0.8
    + sin((p.x + p.y) * 0.09 + uTime * 1.6) * 0.6
    + sin((p.x * 0.6 - p.y) * 0.12 + uTime * 0.8) * 0.4);
}
// Analytic slope (d/dx, d/dz) for smooth per-vertex normals.
vec2 waveGrad(vec2 p) {
  float c3 = cos((p.x + p.y) * 0.09 + uTime * 1.6) * 0.054;
  float c4 = cos((p.x * 0.6 - p.y) * 0.12 + uTime * 0.8) * 0.048;
  float dx = cos(p.x * 0.16 + uTime * 1.3) * 0.16 + c3 + c4 * 0.6;
  float dz = cos(p.y * 0.21 + uTime * 1.0) * 0.168 + c3 - c4;
  return uAmp * vec2(dx, dz);
}
`;
