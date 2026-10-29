import * as THREE from 'three';

// Procedural canvas textures: zero image downloads, generated once at startup.

type Ctx = CanvasRenderingContext2D;

let seed = 98765;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function css(hex: number, k = 1, a = 1): string {
  const r = Math.min(255, ((hex >> 16) & 255) * k);
  const g = Math.min(255, ((hex >> 8) & 255) * k);
  const b = Math.min(255, (hex & 255) * k);
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

function make(w: number, h: number, draw: (c: Ctx, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, fn: () => T): T {
  let t = cache.get(key) as T | undefined;
  if (!t) {
    t = fn();
    cache.set(key, t);
  }
  return t;
}

/** Wavy wood-grain lines that wrap seamlessly horizontally. */
function grainH(c: Ctx, w: number, y0: number, y1: number, count: number): void {
  c.strokeStyle = '#4a2a10';
  for (let i = 0; i < count; i++) {
    const y = y0 + rnd() * (y1 - y0);
    c.globalAlpha = 0.06 + rnd() * 0.12;
    c.lineWidth = 0.6 + rnd() * 1.6;
    const k = 1 + Math.floor(rnd() * 3);
    const amp = 0.6 + rnd() * 2.2;
    const ph = rnd() * 6.28;
    c.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const yy = y + Math.sin((x / w) * Math.PI * 2 * k + ph) * amp;
      if (x === 0) c.moveTo(x, yy);
      else c.lineTo(x, yy);
    }
    c.stroke();
  }
  c.globalAlpha = 1;
}

/** Hull planks: horizontal boards with bevel shading, seams and grain. */
export function planksTexture(): THREE.CanvasTexture {
  return cached('planks', () =>
    make(512, 256, (c, w, h) => {
      const n = 6;
      const ph = h / n;
      for (let i = 0; i < n; i++) {
        const y = i * ph;
        c.fillStyle = css(0xc88a4e, 0.86 + rnd() * 0.24);
        c.fillRect(0, y, w, ph);
        const g = c.createLinearGradient(0, y, 0, y + ph);
        g.addColorStop(0, 'rgba(255,236,200,0.35)');
        g.addColorStop(0.3, 'rgba(255,236,200,0)');
        g.addColorStop(0.75, 'rgba(70,35,10,0)');
        g.addColorStop(1, 'rgba(70,35,10,0.4)');
        c.fillStyle = g;
        c.fillRect(0, y, w, ph);
        grainH(c, w, y + 3, y + ph - 3, 16);
        // Butt joints between boards.
        c.fillStyle = 'rgba(60,30,10,0.55)';
        const joints = 1 + Math.floor(rnd() * 2);
        for (let j = 0; j < joints; j++) c.fillRect(Math.floor(rnd() * w), y, 2, ph);
      }
      c.fillStyle = 'rgba(52,26,8,0.85)';
      for (let i = 0; i <= n; i++) c.fillRect(0, i * ph - 1.5, w, 3);
      // A few knots.
      for (let k = 0; k < 5; k++) {
        const x = rnd() * w, y = rnd() * h;
        c.strokeStyle = 'rgba(70,35,12,0.5)';
        c.lineWidth = 1.5;
        for (let r = 2; r < 9; r += 2.5) {
          c.beginPath();
          c.ellipse(x, y, r * 1.8, r * 0.7, 0, 0, Math.PI * 2);
          c.stroke();
        }
      }
    }),
  );
}

/** Barrel: vertical staves, two iron hoops, lids at the top/bottom of the V range. */
export function barrelTexture(): THREE.CanvasTexture {
  return cached('barrel', () =>
    make(256, 256, (c, w, h) => {
      const staves = 8;
      const sw = w / staves;
      for (let i = 0; i < staves; i++) {
        c.fillStyle = css(0xb8743c, 0.85 + rnd() * 0.28);
        c.fillRect(i * sw, 0, sw, h);
        const g = c.createLinearGradient(i * sw, 0, (i + 1) * sw, 0);
        g.addColorStop(0, 'rgba(255,230,190,0.25)');
        g.addColorStop(0.4, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(60,30,10,0.35)');
        c.fillStyle = g;
        c.fillRect(i * sw, 0, sw, h);
        c.strokeStyle = '#4a2a10';
        for (let k = 0; k < 6; k++) {
          c.globalAlpha = 0.08 + rnd() * 0.1;
          c.lineWidth = 1;
          const x = i * sw + 4 + rnd() * (sw - 8);
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x + (rnd() - 0.5) * 6, h);
          c.stroke();
        }
        c.globalAlpha = 1;
        c.fillStyle = 'rgba(52,26,8,0.8)';
        c.fillRect(i * sw - 1, 0, 2, h);
      }
      // Lids live in the first/last 12.5% of V on the lathe profile.
      c.fillStyle = css(0xd29a5c);
      c.fillRect(0, 0, w, h * 0.125);
      c.fillRect(0, h * 0.875, w, h * 0.125);
      for (const v of [0.3, 0.7]) {
        const y = v * h;
        const g = c.createLinearGradient(0, y - 9, 0, y + 9);
        g.addColorStop(0, '#2f3640');
        g.addColorStop(0.35, '#8a96a3');
        g.addColorStop(0.6, '#4b5561');
        g.addColorStop(1, '#232930');
        c.fillStyle = g;
        c.fillRect(0, y - 9, w, 18);
        c.fillStyle = '#c9d2db';
        for (let x = sw / 2; x < w; x += sw) {
          c.beginPath();
          c.arc(x, y, 2.2, 0, Math.PI * 2);
          c.fill();
        }
      }
    }),
  );
}

/** Sailor shirt: white with stripes in the player's colour. */
export function stripesTexture(color: number): THREE.CanvasTexture {
  return cached(`stripes-${color}`, () => {
    const t = make(64, 64, (c, w, h) => {
      c.fillStyle = '#f7f9fc';
      c.fillRect(0, 0, w, h);
      c.fillStyle = css(color);
      for (let i = 0; i < 4; i++) c.fillRect(0, i * 16 + 4, w, 8);
    });
    t.repeat.set(1, 1.5);
    return t;
  });
}

/** Soft round glow, white → transparent. Tint via material colour. */
export function glowTexture(): THREE.CanvasTexture {
  return cached('glow', () =>
    make(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }),
  );
}

/** Thin glowing ring for pickup markers and mine warnings. */
export function ringTexture(): THREE.CanvasTexture {
  return cached('ring', () =>
    make(256, 256, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.62, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.88, 'rgba(255,255,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }),
  );
}

/**
 * Floating "?" badge above pickup crates. The fake-crate version is nearly identical:
 * the "?" is pale pink with a dark-red outline: a fair tell for players who look closely.
 */
export function badgeTexture(fake = false): THREE.CanvasTexture {
  return cached(fake ? 'badge-fake' : 'badge', () =>
    make(128, 128, (c, w, h) => {
      const cx = w / 2, cy = h / 2;
      c.beginPath();
      c.arc(cx, cy + 3, 52, 0, Math.PI * 2);
      c.fillStyle = 'rgba(10,40,70,0.45)';
      c.fill();
      const g = c.createLinearGradient(0, 10, 0, 118);
      g.addColorStop(0, '#ffe680');
      g.addColorStop(1, '#ffa412');
      c.beginPath();
      c.arc(cx, cy, 50, 0, Math.PI * 2);
      c.fillStyle = g;
      c.fill();
      c.lineWidth = 8;
      c.strokeStyle = '#ffffff';
      c.stroke();
      c.font = '900 72px "Lilita One", "Arial Black", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 10;
      c.strokeStyle = fake ? '#6e0f24' : '#0d3b66';
      c.strokeText('?', cx, cy + 4);
      c.fillStyle = fake ? '#ffd9df' : '#ffffff';
      c.fillText('?', cx, cy + 4);
    }),
  );
}

/** Wooden supply crate face: frame, planks, diagonal brace and nails. Used on all six faces. */
export function crateTexture(): THREE.CanvasTexture {
  return cached('crate', () =>
    make(256, 256, (c, w, h) => {
      const planks = 4;
      for (let i = 0; i < planks; i++) {
        c.fillStyle = css(0xc07c42, 0.88 + rnd() * 0.22);
        c.fillRect(0, (i * h) / planks, w, h / planks);
      }
      grainH(c, w, 0, h, 30);
      c.fillStyle = 'rgba(52,26,8,0.7)';
      for (let i = 1; i < planks; i++) c.fillRect(0, (i * h) / planks - 1.5, w, 3);
      // Diagonal brace.
      c.save();
      c.translate(w / 2, h / 2);
      c.rotate(-Math.PI / 4);
      c.fillStyle = 'rgba(40,20,5,0.35)';
      c.fillRect(-w * 0.72, -15, w * 1.44, 34);
      c.fillStyle = css(0xd49656);
      c.fillRect(-w * 0.72, -17, w * 1.44, 30);
      c.fillStyle = 'rgba(255,235,200,0.3)';
      c.fillRect(-w * 0.72, -17, w * 1.44, 5);
      c.restore();
      // Frame.
      const f = 26;
      c.fillStyle = css(0x9a5e2e);
      c.fillRect(0, 0, w, f);
      c.fillRect(0, h - f, w, f);
      c.fillRect(0, 0, f, h);
      c.fillRect(w - f, 0, f, h);
      c.strokeStyle = 'rgba(40,20,5,0.6)';
      c.lineWidth = 3;
      c.strokeRect(f, f, w - 2 * f, h - 2 * f);
      c.strokeRect(1.5, 1.5, w - 3, h - 3);
      c.fillStyle = 'rgba(255,235,200,0.25)';
      c.fillRect(0, 0, w, 4);
      // Nails.
      c.fillStyle = '#3b3f45';
      for (const [x, y] of [[13, 13], [w - 13, 13], [13, h - 13], [w - 13, h - 13], [w / 2, 13], [w / 2, h - 13], [13, h / 2], [w - 13, h / 2]]) {
        c.beginPath();
        c.arc(x, y, 3.5, 0, Math.PI * 2);
        c.fill();
      }
    }),
  );
}

/** Landing marker for mortar strikes (tinted red by its material). */
export function targetTexture(): THREE.CanvasTexture {
  return cached('target', () =>
    make(256, 256, (c, w, h) => {
      const cx = w / 2, cy = h / 2;
      c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.lineWidth = 12;
      c.beginPath();
      c.arc(cx, cy, w * 0.42, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 8;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * w * 0.16, cy + Math.sin(a) * h * 0.16);
        c.lineTo(cx + Math.cos(a) * w * 0.32, cy + Math.sin(a) * h * 0.32);
        c.stroke();
      }
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.beginPath();
      c.arc(cx, cy, w * 0.42, 0, Math.PI * 2);
      c.fill();
    }),
  );
}
