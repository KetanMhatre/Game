// Wave height function shared by the water shader (GPU) and boat bobbing (CPU).
// Keep WAVE_GLSL and waveHeight() in sync.

export function waveHeight(x: number, z: number, t: number, amp: number): number {
  return (
    amp *
    (Math.sin(x * 0.16 + t * 1.3) +
      Math.sin(z * 0.21 + t * 1.0) * 0.8 +
      Math.sin((x + z) * 0.09 + t * 1.6) * 0.6)
  );
}

export const WAVE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uAmp;
float waveHeight(vec2 p) {
  return uAmp * (sin(p.x * 0.16 + uTime * 1.3)
    + sin(p.y * 0.21 + uTime * 1.0) * 0.8
    + sin((p.x + p.y) * 0.09 + uTime * 1.6) * 0.6);
}
`;
