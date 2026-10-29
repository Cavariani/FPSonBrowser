import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Paleta chapada do viewmodel (sRGB hex). */
export const PAL = {
  black: 0x1d1f22,
  graphite: 0x3a3e44,
  steel: 0x5b6169,
  chrome: 0x9aa3ad,
  wood: 0x9a5f34,
  woodDark: 0x6e4122,
  tan: 0xbfa274,
  orange: 0xc4562a,
  red: 0xd3332b,
  redDark: 0x9c2420,
  brass: 0xd9a63a,
  skin: 0xe7b58e,
  glove: 0x2e3135,
  glovePad: 0x4a4f56,
  sleeve: 0x6b7552,
  sleeveDark: 0x555e40,
  cuff: 0x3d4229,
  white: 0xf4f4ef,
  yellow: 0xffe158,
  green: 0x2fa85a,
  blue: 0x2c5aa8,
  gold: 0xe8c04a,
} as const;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/**
 * Junta várias caixas/cilindros coloridos (cor por vértice) em UMA geometria → 1 draw call por peça.
 * Coordenadas em metros; -Z é "pra frente" (cano).
 */
export class Builder {
  private parts: THREE.BufferGeometry[] = [];

  /** Adiciona qualquer geometria (é consumida) com cor chapada e transformação. */
  push(g: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    _c.setHex(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (g.index) g = g.toNonIndexed();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (!g.attributes.normal) g.computeVertexNormals();
    this.parts.push(g);
    return this;
  }

  box(color: number, w: number, h: number, d: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): this {
    return this.push(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  /** Cilindro ao longo de Z (cano). Poucos lados para ficar low-poly. */
  cylZ(color: number, r: number, len: number, x = 0, y = 0, z = 0, seg = 6, r2 = r): this {
    return this.push(new THREE.CylinderGeometry(r2, r, len, seg), color, x, y, z, Math.PI / 2, 0, 0);
  }

  cyl(color: number, r: number, len: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 6): this {
    return this.push(new THREE.CylinderGeometry(r, r, len, seg), color, x, y, z, rx, ry, rz);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    g.computeBoundingSphere();
    return g;
  }

  mesh(mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(this.build(), mat);
    m.frustumCulled = false;
    return m;
  }
}

/** Material único do viewmodel: Lambert com cor por vértice e flat shading. */
export const vmMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Textura de estrela/flash (aditiva), compartilhada entre viewmodel e mundo. */
let flashTex: THREE.Texture | null = null;
export function flashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const c = S / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.25, 'rgba(255,220,120,0.95)');
  g.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  // estrela de 6 pontas
  ctx.beginPath();
  const pts = 6;
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? c : c * 0.38;
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  const g2 = ctx.createRadialGradient(c, c, 0, c, c, c * 0.45);
  g2.addColorStop(0, 'rgba(255,255,255,1)');
  g2.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, S, S);
  flashTex = new THREE.CanvasTexture(cv);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  return flashTex;
}
