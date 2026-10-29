import * as THREE from 'three';

/** [x0, y0, z0, x1, y1, z1, cor sRGB] */
export type Part = [number, number, number, number, number, number, number];

const _c = new THREE.Color();
const cache = new Map<string, THREE.BufferGeometry>();

/** Geometria de várias caixas com cor por vértice (uma malha = um draw call). Cacheada por chave. */
export function partsGeo(key: string, make: () => Part[]): THREE.BufferGeometry {
  const hit = cache.get(key);
  if (hit) return hit;
  const parts = make();
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1, hex] of parts) {
    _c.setHex(hex);
    const faces: [number[][], number[]][] = [
      [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]],
      [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]],
      [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
      [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]],
      [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]],
      [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]],
    ];
    for (const [p, n] of faces) {
      const b = pos.length / 3;
      // leve sombreado: faces de baixo um pouco mais escuras
      const k = n[1] < 0 ? 0.8 : 1;
      for (const v of p) {
        pos.push(v[0], v[1], v[2]);
        nor.push(n[0], n[1], n[2]);
        col.push(_c.r * k, _c.g * k, _c.b * k);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}

/** Caixa centrada em x (simétrica): [hx, y0, y1, z0, z1]. */
export const sym = (hx: number, y0: number, y1: number, z0: number, z1: number, c: number, cx = 0): Part =>
  [cx - hx, y0, z0, cx + hx, y1, z1, c];
