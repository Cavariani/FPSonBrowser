import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export interface SpawnOpts {
  /** Escala base (x,y,z). */
  sx: number;
  sy: number;
  sz: number;
  life: number;
  gravity: number;
  /** Arrasto linear (1/s). */
  drag: number;
  /** Chão aproximado: quica/para aqui. -Infinity = sem chão. */
  floor: number;
  /** Papel: cai planando e balançando, deita no chão. */
  flutter: boolean;
  spin: number;
  /** Encolhe no fim (fração da vida). */
  shrink: number;
}

const DEF: SpawnOpts = { sx: 0.05, sy: 0.05, sz: 0.05, life: 0.6, gravity: 9.8, drag: 1, floor: -Infinity, flutter: false, spin: 10, shrink: 0.35 };

/**
 * Pool de partículas num único InstancedMesh (1 draw call). Estrutura de arrays,
 * remoção por swap com o último, zero alocação no update.
 */
export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly cap: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private rot: Float32Array;
  private ang: Float32Array;
  private scl: Float32Array;
  /** life, maxLife, gravity, drag, floor, flutter, shrink, phase */
  private prm: Float32Array;
  private col: Float32Array;
  private time = 0;
  private colorDirty = false;

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.rot = new Float32Array(cap * 3);
    this.ang = new Float32Array(cap * 3);
    this.scl = new Float32Array(cap * 3);
    this.prm = new Float32Array(cap * 8);
    this.col = this.mesh.instanceColor!.array as Float32Array;
  }

  get active(): number {
    return this.n;
  }

  /** Spawna uma partícula. Se lotado, sobrescreve uma aleatória (as mais antigas tendem a sumir). */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, o: Partial<SpawnOpts> = DEF): void {
    let i = this.n;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0;
    else this.n++;
    const i3 = i * 3, i8 = i * 8;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const spin = o.spin ?? DEF.spin;
    this.rot[i3] = Math.random() * 6.28; this.rot[i3 + 1] = Math.random() * 6.28; this.rot[i3 + 2] = Math.random() * 6.28;
    this.ang[i3] = (Math.random() * 2 - 1) * spin; this.ang[i3 + 1] = (Math.random() * 2 - 1) * spin; this.ang[i3 + 2] = (Math.random() * 2 - 1) * spin;
    this.scl[i3] = o.sx ?? DEF.sx; this.scl[i3 + 1] = o.sy ?? DEF.sy; this.scl[i3 + 2] = o.sz ?? DEF.sz;
    const life = o.life ?? DEF.life;
    this.prm[i8] = life;
    this.prm[i8 + 1] = life;
    this.prm[i8 + 2] = o.gravity ?? DEF.gravity;
    this.prm[i8 + 3] = o.drag ?? DEF.drag;
    this.prm[i8 + 4] = o.floor ?? DEF.floor;
    this.prm[i8 + 5] = o.flutter ? 1 : 0;
    this.prm[i8 + 6] = o.shrink ?? DEF.shrink;
    this.prm[i8 + 7] = Math.random() * 6.28;
    _c.setHex(color);
    this.col[i3] = _c.r; this.col[i3 + 1] = _c.g; this.col[i3 + 2] = _c.b;
    this.colorDirty = true;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    const i3 = i * 3, l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k];
      this.vel[i3 + k] = this.vel[l3 + k];
      this.rot[i3 + k] = this.rot[l3 + k];
      this.ang[i3 + k] = this.ang[l3 + k];
      this.scl[i3 + k] = this.scl[l3 + k];
      this.col[i3 + k] = this.col[l3 + k];
    }
    this.prm.copyWithin(i * 8, last * 8, last * 8 + 8);
    this.colorDirty = true;
  }

  update(dt: number): void {
    this.time += dt;
    const P = this.pos, V = this.vel, R = this.rot, A = this.ang, S = this.scl, M = this.prm;
    for (let i = this.n - 1; i >= 0; i--) {
      const i8 = i * 8;
      M[i8] -= dt;
      if (M[i8] <= 0) {
        this.kill(i);
        continue;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, i8 = i * 8;
      const life = M[i8], max = M[i8 + 1], g = M[i8 + 2], drag = M[i8 + 3], floor = M[i8 + 4], flutter = M[i8 + 5];
      const dk = Math.exp(-drag * dt);
      let grounded = P[i3 + 1] <= floor + 0.002 && V[i3 + 1] <= 0.01;
      if (!grounded) {
        V[i3] *= dk; V[i3 + 2] *= dk;
        V[i3 + 1] = V[i3 + 1] * dk - g * dt;
        if (flutter) {
          // planar: velocidade terminal baixa e deriva lateral
          if (V[i3 + 1] < -1.1) V[i3 + 1] += (-1.1 - V[i3 + 1]) * Math.min(1, dt * 6);
          const ph = this.time * 4 + M[i8 + 7];
          V[i3] += Math.sin(ph) * 2.2 * dt;
          V[i3 + 2] += Math.cos(ph * 0.8) * 2.2 * dt;
        }
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        R[i3] += A[i3] * dt; R[i3 + 1] += A[i3 + 1] * dt; R[i3 + 2] += A[i3 + 2] * dt;
        if (P[i3 + 1] < floor) {
          P[i3 + 1] = floor;
          if (flutter || V[i3 + 1] > -1.5) {
            V[i3] = V[i3 + 1] = V[i3 + 2] = 0;
            grounded = true;
          } else {
            V[i3 + 1] *= -0.35;
            V[i3] *= 0.5; V[i3 + 2] *= 0.5;
            A[i3] *= 0.5; A[i3 + 1] *= 0.5; A[i3 + 2] *= 0.5;
          }
        }
      }
      if (grounded && flutter) {
        // papel deita no chão (plano XY → horizontal)
        R[i3] += (-Math.PI / 2 - R[i3]) * Math.min(1, dt * 12);
        R[i3 + 2] *= 1 - Math.min(1, dt * 12);
        P[i3 + 1] = floor + 0.005;
      }
      const shrink = M[i8 + 6];
      const f = life / max;
      const k = shrink > 0 && f < shrink ? f / shrink : 1;
      _p.set(P[i3], P[i3 + 1], P[i3 + 2]);
      _e.set(R[i3], R[i3 + 1], R[i3 + 2]);
      _q.setFromEuler(_e);
      _s.set(S[i3] * k, S[i3 + 1] * k, S[i3 + 2] * k);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = this.n;
    if (this.n > 0) this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty) {
      this.mesh.instanceColor!.needsUpdate = true;
      this.colorDirty = false;
    }
  }
}
