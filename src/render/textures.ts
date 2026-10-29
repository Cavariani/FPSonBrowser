import * as THREE from 'three';
import type { MaterialId } from '../maps/types';

/** Texturas pequenas geradas em canvas (pixel art, NearestFilter). */

type Ctx = CanvasRenderingContext2D;

let seed = 9001;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

function rgb(hex: number, k = 1, add = 0): string {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) * k + add));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) * k + add));
  const b = Math.max(0, Math.min(255, (hex & 255) * k + add));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Ruído por pixel em cima do que já foi desenhado. */
function noise(ctx: Ctx, w: number, h: number, amp: number, chance = 1): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (rnd() > chance) continue;
    const n = (rnd() - 0.5) * 2 * amp;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.9;
  }
  ctx.putImageData(img, 0, 0);
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
}

function sand(base: number): HTMLCanvasElement {
  const [c, ctx] = canvas(64);
  px(ctx, 0, 0, 64, 64, rgb(base));
  // manchas suaves
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 64, y = rnd() * 64, r = 3 + rnd() * 7;
    ctx.fillStyle = rgb(base, 0.94 + rnd() * 0.1);
    ctx.fillRect(x - r, y - r / 2, r * 2, r);
  }
  noise(ctx, 64, 64, 9);
  for (let i = 0; i < 70; i++) px(ctx, (rnd() * 64) | 0, (rnd() * 64) | 0, 1, 1, rgb(base, rnd() < 0.5 ? 0.78 : 1.12));
  // ondinhas de vento
  for (let i = 0; i < 6; i++) {
    const y = (rnd() * 64) | 0, x = (rnd() * 64) | 0;
    px(ctx, x, y, 6 + ((rnd() * 6) | 0), 1, rgb(base, 0.9));
  }
  return c;
}

function blocks(base: number, mortar: number, rows: number, cols: number, sz = 64): HTMLCanvasElement {
  const [c, ctx] = canvas(sz);
  px(ctx, 0, 0, sz, sz, rgb(mortar));
  const rh = sz / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? sz / cols / 2 : 0;
    const bw = sz / cols;
    for (let k = -1; k < cols; k++) {
      const x = Math.round(off + k * bw), y = Math.round(r * rh);
      const col = rgb(base, 0.92 + rnd() * 0.14);
      // desenha com wrap horizontal
      for (const dx of [0, sz]) {
        px(ctx, x + 1 - dx, y + 1, Math.round(bw) - 2, Math.round(rh) - 2, col);
        px(ctx, x + 1 - dx, y + 1, Math.round(bw) - 2, 1, rgb(base, 1.12));
        px(ctx, x + 1 - dx, y + Math.round(rh) - 2, Math.round(bw) - 2, 1, rgb(base, 0.82));
      }
    }
  }
  noise(ctx, sz, sz, 7);
  for (let i = 0; i < 18; i++) px(ctx, (rnd() * sz) | 0, (rnd() * sz) | 0, 1 + ((rnd() * 2) | 0), 1, rgb(base, 0.75));
  return c;
}

function plaster(base: number): HTMLCanvasElement {
  const [c, ctx] = canvas(32);
  px(ctx, 0, 0, 32, 32, rgb(base));
  for (let i = 0; i < 10; i++) {
    const x = rnd() * 32, y = rnd() * 32;
    ctx.fillStyle = rgb(base, 0.95 + rnd() * 0.06);
    ctx.fillRect(x, y, 3 + rnd() * 8, 2 + rnd() * 5);
  }
  noise(ctx, 32, 32, 5);
  // rachadinha
  let x = (rnd() * 32) | 0, y = (rnd() * 32) | 0;
  for (let i = 0; i < 6; i++) {
    px(ctx, x, y, 1, 1, rgb(base, 0.8));
    x += rnd() < 0.5 ? 1 : 0;
    y += 1;
  }
  return c;
}

function planks(base: number, n: number, vertical: boolean, sz = 32, gap = 0x000000): HTMLCanvasElement {
  const [c, ctx] = canvas(sz);
  const pw = sz / n;
  for (let i = 0; i < n; i++) {
    const col = base;
    const k = 0.88 + rnd() * 0.22;
    for (let j = 0; j < sz; j++) {
      // veios
      const kk = k * (0.96 + rnd() * 0.06);
      if (vertical) px(ctx, Math.round(i * pw), j, Math.round(pw), 1, rgb(col, kk));
      else px(ctx, j, Math.round(i * pw), 1, Math.round(pw), rgb(col, kk));
    }
    // fresta
    if (vertical) px(ctx, Math.round(i * pw), 0, 1, sz, rgb(gap || base, gap ? 1 : 0.55));
    else px(ctx, 0, Math.round(i * pw), sz, 1, rgb(gap || base, gap ? 1 : 0.55));
    // emenda + pregos
    const e = (rnd() * sz) | 0;
    if (vertical) {
      px(ctx, Math.round(i * pw) + 1, e, Math.round(pw) - 1, 1, rgb(base, 0.6));
      px(ctx, Math.round(i * pw + pw / 2), (e + 2) % sz, 1, 1, rgb(0x3a2a1a));
    } else {
      px(ctx, e, Math.round(i * pw) + 1, 1, Math.round(pw) - 1, rgb(base, 0.6));
      px(ctx, (e + 2) % sz, Math.round(i * pw + pw / 2), 1, 1, rgb(0x3a2a1a));
    }
  }
  noise(ctx, sz, sz, 4);
  return c;
}

function roof(): HTMLCanvasElement {
  const [c, ctx] = canvas(64);
  const cols = [0xa9532f, 0xb8643a, 0x96442a, 0xa65d3c, 0xbf6b3f];
  const n = 8, pw = 8;
  for (let i = 0; i < n; i++) {
    let x = 0;
    while (x < 64) {
      const len = 14 + ((rnd() * 24) | 0);
      const col = cols[(rnd() * cols.length) | 0];
      px(ctx, x, i * pw, len, pw, rgb(col));
      px(ctx, x, i * pw + 1, len, 1, rgb(col, 1.12));
      px(ctx, x, i * pw + pw - 2, len, 1, rgb(col, 0.85));
      px(ctx, x, i * pw, 1, pw, rgb(0x4a2416));
      px(ctx, x + 2, i * pw + 3, 1, 1, rgb(0x3a1c10));
      x += len;
    }
    px(ctx, 0, i * pw, 64, 1, rgb(0x4a2416));
  }
  noise(ctx, 64, 64, 6);
  return c;
}

function crate(): HTMLCanvasElement {
  const [c, ctx] = canvas(32);
  const base = 0xb98345, frame = 0x7c4f27;
  for (let i = 0; i < 4; i++) {
    const k = 0.9 + rnd() * 0.18;
    px(ctx, 0, i * 8, 32, 8, rgb(base, k));
    px(ctx, 0, i * 8, 32, 1, rgb(base, 0.6));
  }
  // moldura
  px(ctx, 0, 0, 32, 4, rgb(frame));
  px(ctx, 0, 28, 32, 4, rgb(frame));
  px(ctx, 0, 0, 4, 32, rgb(frame));
  px(ctx, 28, 0, 4, 32, rgb(frame));
  px(ctx, 1, 1, 30, 1, rgb(frame, 1.25));
  // travessa diagonal
  for (let i = 3; i < 29; i++) px(ctx, i, i - 1, 3, 2, rgb(frame, 1.08));
  for (const [x, y] of [[1, 1], [29, 1], [1, 29], [29, 29]]) px(ctx, x, y, 2, 2, rgb(0x3b3b3b));
  noise(ctx, 32, 32, 6);
  return c;
}

function door(): HTMLCanvasElement {
  const c = planks(0x6d4527, 4, true, 32);
  const ctx = c.getContext('2d')!;
  px(ctx, 0, 0, 32, 2, rgb(0x4a2c17));
  px(ctx, 0, 0, 2, 32, rgb(0x4a2c17));
  px(ctx, 30, 0, 2, 32, rgb(0x4a2c17));
  for (const y of [6, 24]) {
    px(ctx, 2, y, 28, 2, rgb(0x3c3c40));
    for (let x = 4; x < 30; x += 6) px(ctx, x, y, 1, 1, rgb(0x9a9aa0));
  }
  px(ctx, 24, 15, 2, 3, rgb(0x2b2b2b));
  return c;
}

function windowTex(): HTMLCanvasElement {
  const [c, ctx] = canvas(16);
  px(ctx, 0, 0, 16, 16, rgb(0x5d3a20));
  px(ctx, 2, 2, 12, 12, rgb(0x1f2029));
  px(ctx, 3, 3, 4, 2, rgb(0x3a3d4a));
  px(ctx, 7, 2, 2, 12, rgb(0x5d3a20));
  px(ctx, 2, 7, 12, 2, rgb(0x5d3a20));
  px(ctx, 10, 10, 3, 3, rgb(0x15161c));
  return c;
}

function metal(): HTMLCanvasElement {
  const [c, ctx] = canvas(32);
  px(ctx, 0, 0, 32, 32, rgb(0x8c9198));
  noise(ctx, 32, 32, 10);
  for (let y = 2; y < 32; y += 10) for (let x = 2; x < 32; x += 10) {
    px(ctx, x, y, 1, 1, rgb(0xc5c9cf));
    px(ctx, x + 1, y + 1, 1, 1, rgb(0x55595e));
  }
  px(ctx, 0, 15, 32, 1, rgb(0x6c7076));
  return c;
}

function burlap(): HTMLCanvasElement {
  const [c, ctx] = canvas(16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const k = (x + y) % 2 ? 0.92 : 1.04;
    px(ctx, x, y, 1, 1, rgb(0xd2b98a, k * (0.96 + rnd() * 0.08)));
  }
  px(ctx, 0, 7, 16, 1, rgb(0xa98f62));
  return c;
}

function water(): HTMLCanvasElement {
  const [c, ctx] = canvas(32);
  px(ctx, 0, 0, 32, 32, rgb(0x3f9fb8));
  for (let i = 0; i < 14; i++) {
    const x = (rnd() * 32) | 0, y = (rnd() * 32) | 0;
    px(ctx, x, y, 3 + ((rnd() * 4) | 0), 1, rgb(0x8fdcea));
  }
  noise(ctx, 32, 32, 6);
  return c;
}

function plain(base: number, amp = 4): HTMLCanvasElement {
  const [c, ctx] = canvas(16);
  px(ctx, 0, 0, 16, 16, rgb(base));
  noise(ctx, 16, 16, amp);
  return c;
}

export interface MatSpec {
  canvas: HTMLCanvasElement | null;
  /** Metros por repetição (modo mundo) ou 0 = UV por face da caixa (0..1). */
  tile: number;
  color?: number;
  emissive?: number;
  basic?: boolean;
}

export function materialSpecs(): Record<MaterialId, MatSpec> {
  seed = 9001;
  return {
    sand: { canvas: sand(0xdcb577), tile: 4 },
    sandDark: { canvas: sand(0xc49a62), tile: 4 },
    stone: { canvas: blocks(0xcfb68c, 0xa58b63, 4, 3), tile: 2.6 },
    wall: { canvas: blocks(0xdcc394, 0xb09468, 4, 2), tile: 3 },
    wallDark: { canvas: blocks(0xae8f62, 0x866c47, 4, 2), tile: 3 },
    plaster: { canvas: plaster(0xf2dfba), tile: 2 },
    trim: { canvas: plaster(0xd6b98c), tile: 2 },
    wood: { canvas: planks(0x8d5d35, 4, true), tile: 1.6 },
    crate: { canvas: crate(), tile: 0 },
    metal: { canvas: metal(), tile: 1 },
    door: { canvas: door(), tile: 0 },
    roof: { canvas: roof(), tile: 2.4 },
    cloth: { canvas: burlap(), tile: 0.7 },
    glass: { canvas: windowTex(), tile: 0 },
    water: { canvas: water(), tile: 2, emissive: 0x0b3a48 },
    lamp: { canvas: null, tile: 1, color: 0xffe2a0, basic: true },
    paint: { canvas: plain(0xf4f4f4), tile: 1 },
  };
}

export function makeTexture(c: HTMLCanvasElement, nearest = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}

/** Atlas de toldos: 4 faixas (vermelho, verde, azul, amarelo) com listras creme. */
export const AWNING_ROWS = ['red', 'green', 'blue', 'yellow'] as const;
export function awningAtlas(): HTMLCanvasElement {
  const [c, ctx] = canvas(64);
  const cols = [0xc23b2b, 0x3f8a3c, 0x2f6aa6, 0xe0a92e];
  for (let r = 0; r < 4; r++) {
    for (let x = 0; x < 64; x++) {
      const stripe = Math.floor(x / 8) % 2 === 0;
      px(ctx, x, r * 16, 1, 16, stripe ? rgb(cols[r]) : rgb(0xf3e6c8));
    }
    px(ctx, 0, r * 16 + 15, 64, 1, 'rgba(0,0,0,0.25)');
  }
  noise(ctx, 64, 64, 6);
  return c;
}

/** Sombra "blob" redonda para personagens. */
export function blobTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(32);
  const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
