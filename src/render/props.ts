import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapAwning, MapDef, MapPalm } from '../maps/types';
import { AWNING_ROWS, awningAtlas, makeTexture } from './textures';

const _c = new THREE.Color();
let seed = 4242;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/** Acumulador de triângulos com cor por vértice (linear). */
class TriBuilder {
  pos: number[] = [];
  col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, hex: number, k = 1): void {
    _c.setHex(hex).multiplyScalar(k);
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, hex: number, k = 1): void {
    this.tri(a, b, c, hex, k);
    this.tri(a, c, d, hex, k);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ palmeiras

function palmGeometry(): THREE.BufferGeometry {
  const t = new TriBuilder();
  const H = 6.3, lean = 0.9, segs = 7, sides = 6;
  const center = (u: number) => V(lean * u * u, H * u, 0);
  for (let s = 0; s < segs; s++) {
    const u0 = s / segs, u1 = (s + 1) / segs;
    const c0 = center(u0), c1 = center(u1);
    const r0 = (0.26 - 0.1 * u0) * 1.12, r1 = (0.26 - 0.1 * u1) * 0.92;
    const col = s % 2 ? 0x8a6a45 : 0x6f5434;
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const p00 = V(c0.x + Math.cos(a0) * r0, c0.y, c0.z + Math.sin(a0) * r0);
      const p01 = V(c0.x + Math.cos(a1) * r0, c0.y, c0.z + Math.sin(a1) * r0);
      const p10 = V(c1.x + Math.cos(a0) * r1, c1.y, c1.z + Math.sin(a0) * r1);
      const p11 = V(c1.x + Math.cos(a1) * r1, c1.y, c1.z + Math.sin(a1) * r1);
      t.quad(p00, p10, p11, p01, col);
    }
  }
  const top = center(1);
  // cocos
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const c = V(top.x + Math.cos(a) * 0.22, top.y - 0.25, top.z + Math.sin(a) * 0.22);
    const r = 0.13;
    const pts = [V(-r, -r, -r), V(r, -r, -r), V(r, r, -r), V(-r, r, -r), V(-r, -r, r), V(r, -r, r), V(r, r, r), V(-r, r, r)].map((p) => p.add(c));
    const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
    for (const q of f) t.quad(pts[q[0]], pts[q[1]], pts[q[2]], pts[q[3]], 0x5a3e22);
  }
  // folhas
  const fronds = 9;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
    const dx = Math.cos(a), dz = Math.sin(a);
    const sx = -dz, sz = dx; // lateral
    const L = 2.9 + rnd() * 0.6;
    const lift = 0.7 + rnd() * 0.3;
    const pts: THREE.Vector3[] = [];
    const widths = [0.1, 0.55, 0.5, 0.3, 0.04];
    for (let k = 0; k < widths.length; k++) {
      const u = k / (widths.length - 1);
      pts.push(V(top.x + dx * L * u, top.y + lift * u * 2.2 - 2.4 * u * u, top.z + dz * L * u));
    }
    const col = i % 2 ? 0x4f8f3a : 0x67a845;
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k], p1 = pts[k + 1];
      const w0 = widths[k], w1 = widths[k + 1];
      const fold = 0.12;
      const l0 = V(p0.x + sx * w0, p0.y - fold, p0.z + sz * w0), r0 = V(p0.x - sx * w0, p0.y - fold, p0.z - sz * w0);
      const l1 = V(p1.x + sx * w1, p1.y - fold, p1.z + sz * w1), r1 = V(p1.x - sx * w1, p1.y - fold, p1.z - sz * w1);
      t.quad(p0, l0, l1, p1, col, 1.0);
      t.quad(p0, p1, r1, r0, col, 0.85);
    }
  }
  return t.geometry();
}

export function buildPalms(palms: MapPalm[]): THREE.InstancedMesh | null {
  if (!palms.length) return null;
  const geo = palmGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, palms.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  palms.forEach((pl, i) => {
    const k = pl.h / 7;
    q.setFromAxisAngle(up, pl.yaw);
    s.set(k, k, k);
    p.set(...pl.pos);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, _c.setRGB(0.9 + rnd() * 0.15, 0.9 + rnd() * 0.15, 0.9 + rnd() * 0.1));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// ------------------------------------------------------------------ toldos

const NORMALS: Record<MapAwning['face'], [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export function buildAwnings(list: MapAwning[]): THREE.Mesh | null {
  if (!list.length) return null;
  const geos: THREE.BufferGeometry[] = [];
  const TILE = 3.2;
  for (const a of list) {
    const [nx, nz] = NORMALS[a.face];
    const L = Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]);
    const W = Math.hypot(a.depth, a.drop);
    const theta = Math.atan2(a.drop, a.depth);
    const psi = Math.atan2(nx, nz);
    const row = AWNING_ROWS.indexOf(a.color);
    const v = 1 - (row + 0.5) / 4;
    const mx = (a.a[0] + a.b[0]) / 2, mz = (a.a[1] + a.b[1]) / 2;

    const fix = (g: THREE.BufferGeometry) => {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + L / 2) / TILE, v);
    };
    const slab = new THREE.BoxGeometry(L, 0.05, W);
    fix(slab);
    slab.rotateX(theta);
    slab.rotateY(psi);
    slab.translate(mx + nx * a.depth / 2, a.y - a.drop / 2, mz + nz * a.depth / 2);
    geos.push(slab);

    const val = new THREE.BoxGeometry(L, 0.28, 0.04);
    fix(val);
    val.rotateY(psi);
    val.translate(mx + nx * a.depth, a.y - a.drop - 0.12, mz + nz * a.depth);
    geos.push(val);
  }
  const geo = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const tex = makeTexture(awningAtlas());
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ deserto em volta

function dune(x: number, z: number): number {
  return (
    Math.sin(x * 0.031 + Math.sin(z * 0.018) * 2.2) * 0.55 +
    Math.sin(z * 0.043 + x * 0.012) * 0.35 +
    Math.sin((x + z) * 0.071) * 0.12 + 0.5
  );
}

export function buildDesert(map: MapDef): THREE.Mesh {
  seed = 777;
  const t = new TriBuilder();
  const half = Math.max(map.bounds.max[0], -map.bounds.min[0]) + 2;
  const radii = [50, 58, 66, 76, 88, 102, 120, 142, 168, 200, 240, 290, 350];
  const segs = 72;
  const height = (x: number, z: number) => {
    const d = Math.max(Math.abs(x), Math.abs(z)) - half;
    if (d < 0) return -0.6;
    const r = Math.hypot(x, z);
    const amp = 1.5 + d * 0.05 + Math.max(0, r - 200) * 0.06;
    return dune(x, z) * amp * THREE.MathUtils.smoothstep(d, 0, 18) - 0.05;
  };
  const grid: THREE.Vector3[][] = radii.map((r, ri) =>
    Array.from({ length: segs }, (_, i) => {
      const a = ((i + (ri % 2) * 0.5) / segs) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      return V(x, height(x, z), z);
    }),
  );
  const sandCols = [0xdcb577, 0xd2a868, 0xe3c088, 0xcfa060];
  for (let ri = 0; ri < radii.length - 1; ri++) {
    for (let i = 0; i < segs; i++) {
      const a0 = grid[ri][i], a1 = grid[ri][(i + 1) % segs];
      const b0 = grid[ri + 1][i], b1 = grid[ri + 1][(i + 1) % segs];
      const c1 = sandCols[(rnd() * sandCols.length) | 0];
      const c2 = sandCols[(rnd() * sandCols.length) | 0];
      if (ri % 2 === 0) {
        t.tri(a0, b0, a1, c1);
        t.tri(a1, b0, b1, c2);
      } else {
        t.tri(a0, b0, b1, c1);
        t.tri(a0, b1, a1, c2);
      }
    }
  }
  // mesas / montanhas de arenito
  const bands = [0xb8734a, 0xc98d5f, 0xa5603c, 0xd09a6a];
  for (let m = 0; m < 22; m++) {
    const ang = rnd() * Math.PI * 2;
    const r = 210 + rnd() * 110;
    const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
    const rad = 14 + rnd() * 30, h = 18 + rnd() * 45;
    const sides = 6 + ((rnd() * 3) | 0);
    const levels = [0, 0.35, 0.7, 1];
    const ring = levels.map((lv, li) => {
      const rr = rad * (1 - lv * (0.35 + rnd() * 0.15)) * (li === 3 ? 0.9 : 1);
      return Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2 + rnd() * 0.3;
        return V(cx + Math.cos(a) * rr * (0.85 + rnd() * 0.3), lv * h - 4, cz + Math.sin(a) * rr * (0.85 + rnd() * 0.3));
      });
    });
    for (let li = 0; li < ring.length - 1; li++) {
      const col = bands[(li + m) % bands.length];
      for (let i = 0; i < sides; i++) {
        const a0 = ring[li][i], a1 = ring[li][(i + 1) % sides], b0 = ring[li + 1][i], b1 = ring[li + 1][(i + 1) % sides];
        t.quad(a0, b0, b1, a1, col, 0.92 + rnd() * 0.1);
      }
    }
    const topR = ring[ring.length - 1];
    const tc = topR.reduce((acc, p) => acc.add(p), V(0, 0, 0)).divideScalar(sides);
    for (let i = 0; i < sides; i++) t.tri(tc, topR[(i + 1) % sides], topR[i], 0xd8a878);
  }
  const mesh = new THREE.Mesh(t.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function buildClouds(): THREE.Mesh {
  seed = 99;
  const geos: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 14; c++) {
    const ang = rnd() * Math.PI * 2, r = 170 + rnd() * 120, y = 70 + rnd() * 60;
    const cx = Math.cos(ang) * r, cz = Math.sin(ang) * r;
    const n = 3 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const w = 14 + rnd() * 22, h = 5 + rnd() * 6, d = 10 + rnd() * 14;
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(cx + (rnd() - 0.5) * 30, y + rnd() * 6, cz + (rnd() - 0.5) * 20);
      geos.push(g);
    }
  }
  const geo = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xfff4e6, emissiveIntensity: 0.55, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

export function buildSky(map: MapDef): THREE.Mesh {
  const sun = new THREE.Vector3(...map.sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(map.skyTop) },
      uBottom: { value: new THREE.Color(map.skyBottom) },
      uFog: { value: new THREE.Color(map.fogColor) },
      uSun: { value: sun },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uBottom, uFog, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uBottom, uTop, pow(clamp(h, 0.0, 1.0), 0.55));
        col = mix(uFog, col, smoothstep(-0.02, 0.12, h));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 60.0) * 0.35;
        col = mix(col, vec3(1.0, 0.98, 0.9) * 1.6, smoothstep(0.9993, 0.9996, s));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 12), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
