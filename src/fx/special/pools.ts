import * as THREE from 'three';

/** Pools de partículas e fitas usadas pelos efeitos das armas malucas. Independentes do resto de fx/. */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _z = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------ texturas

function canvasTex(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _soft: THREE.CanvasTexture | null = null;
/** Bolha suave (radial branco → transparente). */
export const softTexture = (): THREE.CanvasTexture =>
  (_soft ??= canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }));

let _ring: THREE.CanvasTexture | null = null;
export const ringTexture = (): THREE.CanvasTexture =>
  (_ring ??= canvasTex(64, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }));

let _star: THREE.CanvasTexture | null = null;
export const starTexture = (): THREE.CanvasTexture =>
  (_star ??= canvasTex(32, (c, s) => {
    c.fillStyle = '#ffe14a';
    c.strokeStyle = '#7a5200';
    c.lineWidth = 2;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? s * 0.46 : s * 0.2;
      const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
    c.fill();
    c.stroke();
  }));

export function labelTexture(text: string, color: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.font = 'bold 40px "VT323", ui-monospace, Consolas, monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 8;
  c.strokeStyle = '#000';
  c.lineJoin = 'round';
  c.strokeText(text, 128, 34);
  c.fillStyle = color;
  c.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}

// ------------------------------------------------------------------ QuadPool (sprites billboard com alpha por instância)

export interface QuadOpts {
  life: number;
  size0: number;
  size1: number;
  /** Cor inicial e final (0xRRGGBB). */
  c0: number;
  c1?: number;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** Opacidade inicial (0..1). Cai até 0 no fim da vida. */
  alpha?: number;
  /** Quanto da vida o alpha fica cheio antes de começar a cair (0..1). */
  hold?: number;
}

/**
 * Sprites sempre virados pra câmera, num único InstancedMesh. `additive`: soma luz (fogo/raio/brilho);
 * senão mistura normal (fumaça, espuma, vapor).
 */
export class QuadPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private prm: Float32Array; // life, max, size0, size1, gravity, drag, rot, spin, alpha0, hold
  private col0: Float32Array;
  private col1: Float32Array;
  private alpha: THREE.InstancedBufferAttribute;
  private colorAttr: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, private cap: number, tex: THREE.Texture, additive: boolean) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.a *= vAlpha;');
    };
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = additive ? 5 : 4;
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttr;
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aAlpha', this.alpha);
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.prm = new Float32Array(cap * 10);
    this.col0 = new Float32Array(cap * 3);
    this.col1 = new Float32Array(cap * 3);
    scene.add(this.mesh);
  }

  get active(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: QuadOpts): void {
    let i = this.n;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0;
    else this.n++;
    const i3 = i * 3, i10 = i * 10;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const P = this.prm;
    P[i10] = o.life; P[i10 + 1] = o.life; P[i10 + 2] = o.size0; P[i10 + 3] = o.size1;
    P[i10 + 4] = o.gravity ?? 0; P[i10 + 5] = o.drag ?? 0;
    P[i10 + 6] = Math.random() * 6.28; P[i10 + 7] = (Math.random() * 2 - 1) * (o.spin ?? 2);
    P[i10 + 8] = o.alpha ?? 1; P[i10 + 9] = o.hold ?? 0.2;
    _c.setHex(o.c0);
    this.col0[i3] = _c.r; this.col0[i3 + 1] = _c.g; this.col0[i3 + 2] = _c.b;
    _c.setHex(o.c1 ?? o.c0);
    this.col1[i3] = _c.r; this.col1[i3 + 1] = _c.g; this.col1[i3 + 2] = _c.b;
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[l * 3 + k];
      this.vel[i * 3 + k] = this.vel[l * 3 + k];
      this.col0[i * 3 + k] = this.col0[l * 3 + k];
      this.col1[i * 3 + k] = this.col1[l * 3 + k];
    }
    this.prm.copyWithin(i * 10, l * 10, l * 10 + 10);
  }

  update(dt: number, camQuat: THREE.Quaternion): void {
    const P = this.prm, pos = this.pos, vel = this.vel;
    for (let i = this.n - 1; i >= 0; i--) {
      P[i * 10] -= dt;
      if (P[i * 10] <= 0) this.kill(i);
    }
    const col = this.colorAttr.array as Float32Array;
    const al = this.alpha.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i10 = i * 10;
      const life = P[i10], max = P[i10 + 1];
      const t = 1 - life / max; // 0 → 1
      const dk = Math.exp(-P[i10 + 5] * dt);
      vel[i3] *= dk; vel[i3 + 2] *= dk;
      vel[i3 + 1] = vel[i3 + 1] * dk - P[i10 + 4] * dt;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      P[i10 + 6] += P[i10 + 7] * dt;
      const size = P[i10 + 2] + (P[i10 + 3] - P[i10 + 2]) * t;
      const hold = P[i10 + 9];
      const a = P[i10 + 8] * (t < hold ? 1 : 1 - (t - hold) / (1 - hold));
      al[i] = a;
      for (let k = 0; k < 3; k++) col[i3 + k] = this.col0[i3 + k] + (this.col1[i3 + k] - this.col0[i3 + k]) * t;
      _qz.setFromAxisAngle(_z, P[i10 + 6]);
      _q.copy(camQuat).multiply(_qz);
      _p.set(pos[i3], pos[i3 + 1], pos[i3 + 2]);
      _s.set(size, size, size);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ ChunkPool (cubinhos opacos com gravidade e chão)

export interface ChunkOpts {
  life: number;
  sx: number;
  sy: number;
  sz: number;
  gravity?: number;
  /** Altura do chão: quica e para. */
  floor?: number;
  spin?: number;
  /** Fração final da vida em que encolhe. */
  shrink?: number;
  /** Planar (penas): velocidade terminal de queda baixa e deriva. */
  flutter?: boolean;
}

export class ChunkPool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private ang: Float32Array;
  private scl: Float32Array;
  private prm: Float32Array; // life, max, gravity, floor, shrink, flutter, phase
  private colorAttr: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, private cap: number) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a2a2a }),
      cap,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colorAttr;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.rot = new Float32Array(cap * 3);
    this.ang = new Float32Array(cap * 3);
    this.scl = new Float32Array(cap * 3);
    this.prm = new Float32Array(cap * 7);
    scene.add(this.mesh);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, o: ChunkOpts): void {
    let i = this.n;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0;
    else this.n++;
    const i3 = i * 3, i7 = i * 7;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const spin = o.spin ?? 10;
    for (let k = 0; k < 3; k++) {
      this.rot[i3 + k] = Math.random() * 6.28;
      this.ang[i3 + k] = (Math.random() * 2 - 1) * spin;
    }
    this.scl[i3] = o.sx; this.scl[i3 + 1] = o.sy; this.scl[i3 + 2] = o.sz;
    const P = this.prm;
    P[i7] = o.life; P[i7 + 1] = o.life; P[i7 + 2] = o.gravity ?? 14; P[i7 + 3] = o.floor ?? -Infinity;
    P[i7 + 4] = o.shrink ?? 0.3; P[i7 + 5] = o.flutter ? 1 : 0; P[i7 + 6] = Math.random() * 6.28;
    _c.setHex(color);
    const col = this.colorAttr.array as Float32Array;
    col[i3] = _c.r; col[i3 + 1] = _c.g; col[i3 + 2] = _c.b;
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    const col = this.colorAttr.array as Float32Array;
    for (let k = 0; k < 3; k++) {
      this.pos[i * 3 + k] = this.pos[l * 3 + k];
      this.vel[i * 3 + k] = this.vel[l * 3 + k];
      this.rot[i * 3 + k] = this.rot[l * 3 + k];
      this.ang[i * 3 + k] = this.ang[l * 3 + k];
      this.scl[i * 3 + k] = this.scl[l * 3 + k];
      col[i * 3 + k] = col[l * 3 + k];
    }
    this.prm.copyWithin(i * 7, l * 7, l * 7 + 7);
  }

  update(dt: number, time: number): void {
    const P = this.prm, pos = this.pos, vel = this.vel, rot = this.rot, ang = this.ang;
    for (let i = this.n - 1; i >= 0; i--) {
      P[i * 7] -= dt;
      if (P[i * 7] <= 0) this.kill(i);
    }
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i7 = i * 7;
      const floor = P[i7 + 3];
      const grounded = pos[i3 + 1] <= floor + 0.003 && vel[i3 + 1] <= 0.05;
      if (!grounded) {
        vel[i3 + 1] -= P[i7 + 2] * dt;
        if (P[i7 + 5] > 0) {
          if (vel[i3 + 1] < -1.2) vel[i3 + 1] += (-1.2 - vel[i3 + 1]) * Math.min(1, dt * 6);
          const ph = time * 5 + P[i7 + 6];
          vel[i3] += Math.sin(ph) * 2 * dt;
          vel[i3 + 2] += Math.cos(ph * 0.8) * 2 * dt;
        }
        pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
        rot[i3] += ang[i3] * dt; rot[i3 + 1] += ang[i3 + 1] * dt; rot[i3 + 2] += ang[i3 + 2] * dt;
        if (pos[i3 + 1] < floor) {
          pos[i3 + 1] = floor;
          if (P[i7 + 5] > 0 || vel[i3 + 1] > -2) {
            vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
          } else {
            vel[i3 + 1] *= -0.3; vel[i3] *= 0.55; vel[i3 + 2] *= 0.55;
            ang[i3] *= 0.5; ang[i3 + 1] *= 0.5; ang[i3 + 2] *= 0.5;
          }
        }
      }
      const f = P[i7] / P[i7 + 1];
      const sh = P[i7 + 4];
      const k = sh > 0 && f < sh ? f / sh : 1;
      _p.set(pos[i3], pos[i3 + 1], pos[i3 + 2]);
      _e.set(rot[i3], rot[i3 + 1], rot[i3 + 2]);
      _q.setFromEuler(_e);
      _s.set(this.scl[i3] * k, this.scl[i3 + 1] * k, this.scl[i3 + 2] * k);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
    }
  }
}

// ------------------------------------------------------------------ Ribbon (fita virada pra câmera: raio elétrico)

export class Ribbon {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private readonly n: number;

  constructor(scene: THREE.Scene, points: number, color: number, opacity: number) {
    this.n = points;
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(points * 2 * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    const idx: number[] = [];
    for (let i = 0; i < points - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** `pts` com `n` pontos; `width` metros; `cam` posição da câmera. */
  set(pts: THREE.Vector3[], width: number, cam: THREE.Vector3): void {
    const a = this.posAttr.array as Float32Array;
    const n = Math.min(this.n, pts.length);
    for (let i = 0; i < this.n; i++) {
      const p = pts[Math.min(i, n - 1)];
      const prev = pts[Math.max(0, Math.min(i, n - 1) - 1)];
      const next = pts[Math.min(n - 1, Math.min(i, n - 1) + 1)];
      _p.subVectors(next, prev);
      _s.subVectors(cam, p);
      _p.cross(_s);
      const l = _p.length();
      if (l < 1e-6) _p.set(0, width, 0); else _p.multiplyScalar(width / l);
      const taper = Math.sin((Math.PI * i) / (this.n - 1)) * 0.7 + 0.3;
      a[i * 6] = p.x - _p.x * taper; a[i * 6 + 1] = p.y - _p.y * taper; a[i * 6 + 2] = p.z - _p.z * taper;
      a[i * 6 + 3] = p.x + _p.x * taper; a[i * 6 + 4] = p.y + _p.y * taper; a[i * 6 + 5] = p.z + _p.z * taper;
    }
    this.posAttr.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  get points(): number {
    return this.n;
  }
}
