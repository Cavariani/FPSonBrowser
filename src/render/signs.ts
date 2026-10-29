import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapSign } from '../maps/types';
import { makeTexture } from './textures';

const PPM = 40; // pixels por metro
const ATLAS_W = 1024;

function drawRug(ctx: CanvasRenderingContext2D, w: number, h: number, s: MapSign): void {
  const a = s.bg ?? '#8e2b1f', b = s.fg ?? '#e7b85a', c = s.border ?? '#1f3b5c';
  const u = Math.max(2, Math.round(Math.min(w, h) / 16));
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w, h);
  // bordas em faixas
  ctx.fillStyle = c;
  ctx.fillRect(u, u, w - 2 * u, h - 2 * u);
  ctx.fillStyle = a;
  ctx.fillRect(2 * u, 2 * u, w - 4 * u, h - 4 * u);
  // dentes na borda
  ctx.fillStyle = b;
  for (let x = 2 * u; x < w - 2 * u; x += 2 * u) {
    ctx.fillRect(x, u, u, u);
    ctx.fillRect(x + u, h - 2 * u, u, u);
  }
  // losangos centrais
  const cx = w / 2, cy = h / 2;
  const n = Math.max(1, Math.round((w - 6 * u) / (h - 6 * u)));
  const step = (w - 6 * u) / n;
  for (let i = 0; i < n; i++) {
    const x = 3 * u + step * (i + 0.5);
    const r = Math.min(step, h - 6 * u) * 0.45;
    for (const [rr, col] of [[r, b], [r * 0.66, c], [r * 0.33, b]] as [number, string][]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, cy - rr);
      ctx.lineTo(x + rr, cy);
      ctx.lineTo(x, cy + rr);
      ctx.lineTo(x - rr, cy);
      ctx.closePath();
      ctx.fill();
    }
  }
  void cx;
  // franjas
  ctx.fillStyle = '#f0e2c0';
  for (let x = 0; x < w; x += u) ctx.fillRect(x, h - Math.max(1, u / 2), Math.max(1, u / 2), u / 2);
}

function drawSign(ctx: CanvasRenderingContext2D, w: number, h: number, s: MapSign): void {
  if (s.kind === 'rug') return drawRug(ctx, w, h, s);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = s.bg ?? '#f3e6c8';
  ctx.fillRect(0, 0, w, h);
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.05));
  if (s.border) {
    ctx.strokeStyle = s.border;
    ctx.lineWidth = bw;
    ctx.strokeRect(bw / 2 + 1, bw / 2 + 1, w - bw - 2, h - bw - 2);
  }
  ctx.fillStyle = s.fg ?? '#222';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (s.kind === 'letter') {
    ctx.font = `900 ${Math.round(h * 0.82)}px Impact, "Arial Black", sans-serif`;
    ctx.fillText(s.lines[0] ?? '', w / 2, h * 0.54);
    return;
  }
  const n = s.lines.length;
  const lh = (h - bw * 2) / Math.max(1, n);
  s.lines.forEach((line, i) => {
    let size = Math.round(lh * (i === 0 ? 0.78 : 0.6));
    ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    while (ctx.measureText(line).width > w - bw * 4 && size > 6) {
      size -= 1;
      ctx.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    }
    ctx.fillText(line, w / 2, bw + lh * (i + 0.5));
  });
}

/** Junta todas as placas num atlas e numa malha só. */
export function buildSigns(signs: MapSign[]): THREE.Mesh | null {
  if (!signs.length) return null;
  // empacota em prateleiras
  const rects = signs.map((s) => ({
    s,
    w: Math.min(ATLAS_W - 2, Math.max(8, Math.round(s.w * PPM))),
    h: Math.max(8, Math.round(s.h * PPM)),
    x: 0,
    y: 0,
  }));
  const order = [...rects].sort((a, b) => b.h - a.h);
  let x = 1, y = 1, shelf = 0;
  for (const r of order) {
    if (x + r.w + 1 > ATLAS_W) {
      x = 1;
      y += shelf + 2;
      shelf = 0;
    }
    r.x = x;
    r.y = y;
    x += r.w + 2;
    shelf = Math.max(shelf, r.h);
  }
  const H = THREE.MathUtils.ceilPowerOfTwo(y + shelf + 1);
  const c = document.createElement('canvas');
  c.width = ATLAS_W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  for (const r of rects) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    drawSign(ctx, r.w, r.h, r.s);
    ctx.restore();
  }
  const tex = makeTexture(c, false);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;

  const geos: THREE.BufferGeometry[] = [];
  for (const r of rects) {
    const s = r.s;
    const g = new THREE.PlaneGeometry(s.w, s.h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = (r.x + uv.getX(i) * r.w) / ATLAS_W;
      const v = 1 - (r.y + (1 - uv.getY(i)) * r.h) / H;
      uv.setXY(i, u, v);
    }
    const o = 0.015;
    switch (s.face) {
      case 's': g.translate(0, 0, o); break;
      case 'n': g.rotateY(Math.PI); g.translate(0, 0, -o); break;
      case 'e': g.rotateY(Math.PI / 2); g.translate(o, 0, 0); break;
      case 'w': g.rotateY(-Math.PI / 2); g.translate(-o, 0, 0); break;
      case 'u': g.rotateX(-Math.PI / 2); g.rotateY(s.rot ?? 0); break;
    }
    g.translate(s.pos[0], s.pos[1], s.pos[2]);
    geos.push(g);
  }
  const geo = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
