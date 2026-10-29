import * as THREE from 'three';
import type { MapBox, MapDef, MaterialId } from '../maps/types';
import { buildAwnings, buildClouds, buildDesert, buildPalms, buildSky } from './props';
import { buildSigns } from './signs';
import { makeTexture, materialSpecs, type MatSpec } from './textures';

export interface Environment {
  update(dt: number, camera: THREE.Camera): void;
}

const _col = new THREE.Color();
const _tint = new THREE.Color();

/** Hash determinístico por caixa (variação de cor). */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul((x * 73856093) | 0, 1) ^ Math.imul((y * 19349663) | 0, 1) ^ Math.imul((z * 83492791) | 0, 1);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class GeoAccum {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  /** Adiciona uma face (4 cantos em ordem anti-horária vista de fora). */
  face(p: number[][], n: number[], uvs: number[][], cols: THREE.Color[]): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(cols[i].r, cols[i].g, cols[i].b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Escreve as 6 faces de uma caixa, com UV em projeção de mundo (ou 0..1 por face),
 * cor por vértice = tint × variação × "AO" falso no pé das paredes.
 */
function addBox(acc: GeoAccum, b: MapBox, spec: MatSpec): void {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const S = spec.tile;
  _tint.setHex(b.tint ?? 0xffffff);
  const v = 0.94 + hash3(x0 * 10, y0 * 10, z0 * 10) * 0.1;
  _tint.multiplyScalar(v);
  const h = y1 - y0;
  const floorMat = b.mat === 'sand' || b.mat === 'sandDark';
  const grounded = y0 <= 0.05 && h > 0.25 && !floorMat;
  const top = _tint.clone();
  // "AO" falso: escurece o pé das caixas que encostam no chão (menos nas altas)
  const bot = _tint.clone().multiplyScalar(grounded ? (h > 2 ? 0.8 : 0.66) : 0.92);

  const W = (u: number, vv: number) => (S > 0 ? [u / S, vv / S] : [u, vv]);
  const sideCols = [bot, bot, top, top];
  const topCols = [top, top, top, top];
  const botCols = [bot, bot, bot, bot];

  // +X
  acc.face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0],
    S > 0 ? [W(-z1, y0), W(-z0, y0), W(-z0, y1), W(-z1, y1)] : [[0, 0], [1, 0], [1, 1], [0, 1]], sideCols);
  // -X
  acc.face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0],
    S > 0 ? [W(z0, y0), W(z1, y0), W(z1, y1), W(z0, y1)] : [[0, 0], [1, 0], [1, 1], [0, 1]], sideCols);
  // +Z
  acc.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1],
    S > 0 ? [W(x0, y0), W(x1, y0), W(x1, y1), W(x0, y1)] : [[0, 0], [1, 0], [1, 1], [0, 1]], sideCols);
  // -Z
  acc.face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1],
    S > 0 ? [W(-x1, y0), W(-x0, y0), W(-x0, y1), W(-x1, y1)] : [[0, 0], [1, 0], [1, 1], [0, 1]], sideCols);
  // +Y
  acc.face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0],
    S > 0 ? [W(x0, -z1), W(x1, -z1), W(x1, -z0), W(x0, -z0)] : [[0, 0], [1, 0], [1, 1], [0, 1]], topCols);
  // -Y (só se estiver no ar)
  if (y0 > 0.01) {
    acc.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0],
      S > 0 ? [W(x0, z0), W(x1, z0), W(x1, z1), W(x0, z1)] : [[0, 0], [1, 0], [1, 1], [0, 1]], botCols);
  }
}

/**
 * Constrói a parte visual do mapa: caixas mescladas por material (1 draw call por material),
 * céu em gradiente, sol com sombra estática, deserto low-poly em volta, palmeiras instanciadas,
 * toldos e placas em atlas.
 */
export function buildEnvironment(scene: THREE.Scene, map: MapDef): Environment {
  scene.background = new THREE.Color(map.fogColor);
  scene.fog = new THREE.Fog(map.fogColor, 70, 340);

  // ---------------------------------------------------------------- luz
  const hemi = new THREE.HemisphereLight(0xbfd7ff, 0xc89a62, 0.95);
  scene.add(hemi);
  const sunDir = new THREE.Vector3(...map.sunDir).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  const sh = sun.shadow;
  sh.mapSize.set(2048, 2048);
  sh.bias = -0.0006;
  sh.normalBias = 0.04;
  sh.radius = 1;
  // ajusta a câmera de sombra aos cantos do mapa no espaço da luz
  const cam = sh.camera;
  cam.position.copy(sun.position);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  const bmin = new THREE.Vector3(Infinity, Infinity, Infinity), bmax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const ex = Math.max(map.bounds.max[0], -map.bounds.min[0]) + 2.5;
  for (const x of [-ex, ex]) for (const y of [0, 13]) for (const z of [-ex, ex]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
    bmin.min(p);
    bmax.max(p);
  }
  cam.left = bmin.x;
  cam.right = bmax.x;
  cam.bottom = bmin.y;
  cam.top = bmax.y;
  cam.near = Math.max(0.5, -bmax.z - 5);
  cam.far = -bmin.z + 5;
  cam.updateProjectionMatrix();
  // mapa estático: renderiza a sombra uma vez só
  sh.autoUpdate = false;
  sh.needsUpdate = true;
  scene.add(sun, sun.target);

  // ---------------------------------------------------------------- caixas por material
  const specs = materialSpecs();
  const accs = new Map<MaterialId, GeoAccum>();
  for (const b of map.boxes) {
    if (b.hidden) continue;
    let acc = accs.get(b.mat);
    if (!acc) accs.set(b.mat, (acc = new GeoAccum()));
    addBox(acc, b, specs[b.mat]);
  }
  let waterTex: THREE.Texture | null = null;
  for (const [id, acc] of accs) {
    const spec = specs[id];
    let mat: THREE.Material;
    if (spec.basic) {
      mat = new THREE.MeshBasicMaterial({ color: spec.color ?? 0xffffff });
    } else {
      const tex = spec.canvas ? makeTexture(spec.canvas) : null;
      if (id === 'water') waterTex = tex;
      mat = new THREE.MeshLambertMaterial({
        map: tex,
        vertexColors: true,
        emissive: spec.emissive ?? 0x000000,
      });
    }
    const mesh = new THREE.Mesh(acc.build(), mat);
    mesh.name = `map:${id}`;
    mesh.castShadow = id !== 'sand' && id !== 'sandDark' && id !== 'water' && id !== 'lamp';
    mesh.receiveShadow = id !== 'lamp';
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  const add = (o: THREE.Object3D | null) => {
    if (!o) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    scene.add(o);
  };
  add(buildPalms(map.palms ?? []));
  add(buildAwnings(map.awnings ?? []));
  add(buildSigns(map.signs ?? []));
  add(buildDesert(map));

  // palmeiras do lado de fora (aparecem por cima da muralha)
  const outside: { pos: [number, number, number]; h: number; yaw: number }[] = [];
  const half = Math.max(map.bounds.max[0], -map.bounds.min[0]);
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const side = i % 4;
    const along = (hash3(i, 3, 7) - 0.5) * 2 * (half - 6);
    const out = half + 4 + hash3(i, 9, 1) * 10;
    const p: [number, number, number] =
      side === 0 ? [along, 0, -out] : side === 1 ? [along, 0, out] : side === 2 ? [-out, 0, along] : [out, 0, along];
    outside.push({ pos: p, h: 8.5 + hash3(i, t, 2) * 4, yaw: hash3(i, 1, 1) * 6.28 });
  }
  const outPalms = buildPalms(outside);
  if (outPalms) {
    outPalms.castShadow = false;
    outPalms.receiveShadow = false;
    add(outPalms);
  }

  const sky = buildSky(map);
  scene.add(sky);
  const clouds = buildClouds();
  scene.add(clouds);

  return {
    update(dt, camera) {
      sky.position.copy(camera.position);
      clouds.rotation.y += dt * 0.004;
      if (waterTex) {
        waterTex.offset.x += dt * 0.05;
        waterTex.offset.y += dt * 0.02;
      }
    },
  };
}
