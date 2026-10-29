import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

/**
 * Tracers: "riscos" que viajam rápido do cano até o ponto de impacto. InstancedMesh de caixas finas,
 * aditivo, ring buffer. Zero alocação.
 */
export class Tracers {
  readonly mesh: THREE.InstancedMesh;
  private cap: number;
  private head = 0;
  private sx: Float32Array;
  private dir: Float32Array;
  /** dist total, percorrido, velocidade, comprimento do risco, largura, vida extra */
  private prm: Float32Array;
  private alive: Uint8Array;
  private col: Float32Array;
  private baseCol: Float32Array;

  constructor(cap = 64) {
    this.cap = cap;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, -0.5); // origem na cabeça do risco, corpo para trás (+z local = trás)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, _c.set(0, 0, 0));
    this.col = this.mesh.instanceColor!.array as Float32Array;
    this.baseCol = new Float32Array(cap * 3);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, _m);
    this.sx = new Float32Array(cap * 3);
    this.dir = new Float32Array(cap * 3);
    this.prm = new Float32Array(cap * 6);
    this.alive = new Uint8Array(cap);
  }

  spawn(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.035, speed = 320, len = 5): void {
    _d.subVectors(to, from);
    const dist = _d.length();
    if (dist < 0.5) return;
    _d.multiplyScalar(1 / dist);
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const i3 = i * 3, i6 = i * 6;
    this.sx[i3] = from.x; this.sx[i3 + 1] = from.y; this.sx[i3 + 2] = from.z;
    this.dir[i3] = _d.x; this.dir[i3 + 1] = _d.y; this.dir[i3 + 2] = _d.z;
    this.prm[i6] = dist;
    this.prm[i6 + 1] = Math.min(dist * 0.25, 1.5); // começa já um pouco à frente do cano
    this.prm[i6 + 2] = speed;
    this.prm[i6 + 3] = Math.min(len, dist);
    this.prm[i6 + 4] = width;
    this.prm[i6 + 5] = 0.03; // demora um pouquinho para sumir depois de chegar
    _c.setHex(color);
    this.baseCol[i3] = _c.r; this.baseCol[i3 + 1] = _c.g; this.baseCol[i3 + 2] = _c.b;
    this.alive[i] = 1;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      any = true;
      const i3 = i * 3, i6 = i * 6;
      const dist = this.prm[i6];
      let trav = this.prm[i6 + 1] + this.prm[i6 + 2] * dt;
      let fade = 1;
      if (trav >= dist) {
        trav = dist;
        this.prm[i6 + 5] -= dt;
        fade = Math.max(0, this.prm[i6 + 5] / 0.03);
        if (this.prm[i6 + 5] <= 0) {
          this.alive[i] = 0;
          _m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, _m);
          continue;
        }
      }
      this.prm[i6 + 1] = trav;
      const len = Math.min(this.prm[i6 + 3], trav);
      _d.set(this.dir[i3], this.dir[i3 + 1], this.dir[i3 + 2]);
      _p.set(this.sx[i3], this.sx[i3 + 1], this.sx[i3 + 2]).addScaledVector(_d, trav);
      // geometria: cabeça na origem, corpo em -z local → +z local alinhado com dir deixa o corpo atrás da cabeça
      _q.setFromUnitVectors(_z, _d);
      const w = this.prm[i6 + 4];
      _s.set(w, w, len);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.col[i3] = this.baseCol[i3] * fade;
      this.col[i3 + 1] = this.baseCol[i3 + 1] * fade;
      this.col[i3 + 2] = this.baseCol[i3 + 2] * fade;
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }
}
