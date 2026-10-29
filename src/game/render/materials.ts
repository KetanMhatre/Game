import * as THREE from 'three';

// Shared, cached materials so identical colours reuse one shader program and one GPU state.

const lamberts = new Map<string, THREE.MeshLambertMaterial>();

export function lambert(color: number, opts: { map?: THREE.Texture; side?: THREE.Side } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.map?.uuid ?? ''}|${opts.side ?? 0}`;
  let m = lamberts.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, map: opts.map ?? null, side: opts.side ?? THREE.FrontSide });
    lamberts.set(key, m);
  }
  return m;
}

/** One material for every vertex-coloured mesh. */
export const vertexColored = new THREE.MeshLambertMaterial({ vertexColors: true });
