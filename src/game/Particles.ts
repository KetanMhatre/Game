import * as THREE from 'three';

interface EmitOpts {
  speed?: number;
  up?: number;
  life?: number;
  size?: number;
  gravity?: number;
  spread?: number;
  /** Size multiplier reached at end of life (smoke grows, sparks shrink). */
  grow?: number;
  /** Velocity damping per second. */
  drag?: number;
  /** Glowing (additive) layer, for fire and sparkles. */
  glow?: boolean;
  /** Initial alpha. */
  alpha?: number;
}

const VERT = /* glsl */ `
  attribute float aAlpha;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_vertex>
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  #include <fog_pars_fragment>
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5 || vAlpha <= 0.001) discard;
    float a = smoothstep(0.5, 0.28, d) * vAlpha;
    // Soft top-lit shading so puffs read as round blobs.
    vec3 col = vColor * (1.05 - c.y * 0.35 - d * 0.25);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

class Layer {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private a0: Float32Array;
  private next = 0;
  private active = 0;

  constructor(private max: number, glow: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = glow ? 8 : 7;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, o: Required<EmitOpts>): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col[k] = color.r;
    this.col[k + 1] = color.g;
    this.col[k + 2] = color.b;
    this.life[i] = this.maxLife[i] = o.life * (0.65 + Math.random() * 0.6);
    this.size0[i] = o.size * (0.65 + Math.random() * 0.7);
    this.size[i] = this.size0[i];
    this.grow[i] = o.grow;
    this.grav[i] = o.gravity;
    this.drag[i] = o.drag;
    this.a0[i] = o.alpha;
    this.alpha[i] = o.alpha;
    this.active = Math.max(this.active, i + 1);
    (this.points.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.active; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      const k = i * 3;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= damp;
      this.vel[k + 2] *= damp;
      this.vel[k + 1] = this.vel[k + 1] * damp - this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * t);
      // Quick fade-in, long fade-out.
      this.alpha[i] = this.a0[i] * Math.min(1, t * 8) * (1 - t * t);
    }
    const g = this.points.geometry.attributes;
    (g.position as THREE.BufferAttribute).needsUpdate = true;
    (g.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.active = 0;
    this.update(0);
  }
}

const _c = new THREE.Color();

/** Soft sprite particles: one draw call per layer (normal + glowing). */
export class Particles {
  readonly group = new THREE.Group();
  private normal = new Layer(1400, false);
  private glow = new Layer(700, true);

  constructor() {
    this.group.add(this.normal.points, this.glow.points);
  }

  /** Call on resize: converts world-unit sizes to pixels. */
  setViewport(heightPx: number, fovDeg: number): void {
    const s = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
    this.normal.material.uniforms.uScale.value = s;
    this.glow.material.uniforms.uScale.value = s;
  }

  emit(x: number, y: number, z: number, count: number, color: number, opts: EmitOpts = {}): void {
    const o: Required<EmitOpts> = {
      speed: opts.speed ?? 6,
      up: opts.up ?? 6,
      life: opts.life ?? 0.8,
      size: opts.size ?? 0.5,
      gravity: opts.gravity ?? 16,
      spread: opts.spread ?? 0.3,
      grow: opts.grow ?? 1,
      drag: opts.drag ?? 0.5,
      glow: opts.glow ?? false,
      alpha: opts.alpha ?? 1,
    };
    const layer = o.glow ? this.glow : this.normal;
    _c.set(color);
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const s = o.speed * (0.35 + Math.random() * 0.65);
      layer.spawn(
        x + (Math.random() - 0.5) * o.spread,
        y + (Math.random() - 0.5) * o.spread * 0.5,
        z + (Math.random() - 0.5) * o.spread,
        Math.cos(a) * s,
        o.up * (0.45 + Math.random() * 0.75),
        Math.sin(a) * s,
        _c,
        o,
      );
    }
  }

  // ---- canned effects ------------------------------------------------------

  /** Water droplets + foam ring. power ~1 for a hit, 2 for a big blast. */
  splash(x: number, y: number, z: number, power = 1): void {
    this.emit(x, y, z, Math.round(14 * power), 0xf2fbff, { speed: 3.5 * power, up: 7 * power, life: 0.9, size: 0.32, gravity: 18, spread: 0.6 });
    this.emit(x, y, z, Math.round(6 * power), 0xc9efff, { speed: 2.2 * power, up: 1.2, life: 1.1, size: 0.9 * power, gravity: 0, grow: 2.2, drag: 2.5, alpha: 0.7, spread: 0.8 });
  }

  explosion(x: number, y: number, z: number, big: boolean): void {
    const p = big ? 1.6 : 1;
    this.emit(x, y + 0.3, z, Math.round(12 * p), 0xffb347, { glow: true, speed: 5 * p, up: 4 * p, life: 0.45, size: 1.3 * p, gravity: -1, grow: 1.6, drag: 3 });
    this.emit(x, y + 0.3, z, Math.round(8 * p), 0xfff1a8, { glow: true, speed: 3 * p, up: 3 * p, life: 0.3, size: 0.9 * p, gravity: 0, grow: 1.3, drag: 3 });
    this.emit(x, y + 0.5, z, Math.round(9 * p), 0x6f747c, { speed: 2.5 * p, up: 3.5, life: 1.3, size: 1.1 * p, gravity: -1.5, grow: 2.4, drag: 1.8, alpha: 0.75 });
    this.emit(x, y + 0.3, z, Math.round(10 * p), 0x8a5a33, { speed: 7 * p, up: 8 * p, life: 0.9, size: 0.2, gravity: 22, drag: 0.3 });
    this.splash(x, y, z, p);
  }

  muzzle(x: number, y: number, z: number): void {
    this.emit(x, y, z, 5, 0xffd27a, { glow: true, speed: 2, up: 1, life: 0.18, size: 0.9, gravity: 0, grow: 1.4, drag: 5 });
    this.emit(x, y, z, 5, 0xdfe3e8, { speed: 1.5, up: 1.5, life: 0.7, size: 0.6, gravity: -1, grow: 2.2, drag: 2, alpha: 0.6 });
  }

  sparkle(x: number, y: number, z: number, color = 0xffe680): void {
    this.emit(x, y, z, 14, color, { glow: true, speed: 4, up: 5, life: 0.6, size: 0.35, gravity: 6, drag: 1.5 });
  }

  update(dt: number): void {
    this.normal.update(dt);
    this.glow.update(dt);
  }

  clear(): void {
    this.normal.clear();
    this.glow.clear();
  }
}
