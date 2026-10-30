import * as THREE from 'three';
import { bus } from '../../core/events';
import type { SpecialId } from '../../game/special/defs';
import { buildHeldModel, updateBands, type HeldParts } from '../special/models';
import { softTexture } from '../special/pools';
import { applyPose, buildArm, pose, type Pose } from './arms';
import { Builder, vmMaterial } from './build';
import { clamp01, pulse, seg, smooth } from './spring';

/**
 * Armas malucas em 1ª pessoa: item + braços de luva/manga, poses e animações cômicas por evento.
 * O ViewModel aplica bob/sway/corrida/pouso por cima (no `holder`) e soma os offsets que `update` devolve.
 */

interface RigDef {
  hipPos: [number, number, number];
  hipRot: [number, number, number];
  right: Pose;
  left: Pose | null;
  leftGrip: boolean;
  /** Arremesso: item some e volta. */
  thrown?: boolean;
}

const R = pose(0.028, -0.012, 0.01, 0.45, 0.32, -1.45);

const DEFS: Record<SpecialId, RigDef> = {
  lorenzetti: {
    hipPos: [0.17, -0.17, -0.4], hipRot: [0.12, 0.35, 0], right: R,
    left: pose(-0.03, -0.022, 0.02, 0.55, -0.55, 1.2), leftGrip: true,
  },
  estilingue: {
    hipPos: [0.1, -0.12, -0.5], hipRot: [0.04, 0.06, 0], right: R,
    left: pose(-0.012, 0.02, 0.085, 1.2, -0.3, 1.6), leftGrip: true,
  },
  dolly: {
    hipPos: [0.23, -0.25, -0.55], hipRot: [0.12, 0.2, 0.18], right: pose(0.07, -0.0, 0.0, 0.45, 0.3, -1.45),
    left: null, leftGrip: true, thrown: true,
  },
  rexona: {
    hipPos: [0.17, -0.2, -0.42], hipRot: [0.05, 0.35, 0.05], right: pose(0.045, -0.0, 0.012, 0.45, 0.3, -1.45),
    left: null, leftGrip: true,
  },
  pombo: {
    hipPos: [0.03, -0.2, -0.52], hipRot: [0.15, 0.9, 0.0], right: pose(0.085, -0.025, 0.02, 0.55, 0.3, -1.7),
    left: pose(-0.085, -0.025, 0.02, 0.55, -0.3, 1.7), leftGrip: false, thrown: true,
  },
  chinelo: {
    hipPos: [0.17, -0.2, -0.42], hipRot: [1.0, 0.3, -0.25], right: pose(0.0, -0.022, 0.03, 0.4, 0.2, -0.1),
    left: null, leftGrip: true, thrown: true,
  },
  panela: {
    hipPos: [0.13, -0.17, -0.38], hipRot: [0.12, 0.18, 0.0], right: pose(0.026, -0.006, 0.01, 0.45, 0.32, -1.45),
    left: pose(-0.04, -0.13, -0.2, 0.6, -0.4, Math.PI), leftGrip: false, thrown: true,
  },
  ventilador: {
    hipPos: [0.15, -0.21, -0.46], hipRot: [0.06, 0.25, 0], right: R,
    left: null, leftGrip: false,
  },
  tijolo: {
    hipPos: [0.18, -0.2, -0.5], hipRot: [0.2, 0.35, 0.1], right: pose(0.014, -0.0, 0.0, 0.45, 0.32, -1.45),
    left: null, leftGrip: true, thrown: true,
  },
  bola: {
    hipPos: [0.13, -0.15, -0.45], hipRot: [0.1, 0.3, 0], right: pose(0.01, -0.1, -0.08, 0.3, 0.1, Math.PI),
    left: null, leftGrip: false, thrown: true,
  },
  pipa: {
    // lata na direita, a esquerda segura a linha na frente (dá linha / puxa)
    hipPos: [0.19, -0.21, -0.5], hipRot: [0.1, 0.3, 0], right: pose(0.03, 0.03, -0.04, 0.45, 0.32, -1.45),
    left: pose(-0.03, 0.08, -0.2, 0.9, -0.5, 1.5), leftGrip: true,
  },
  cafe: {
    hipPos: [0.2, -0.22, -0.5], hipRot: [0.06, 0.4, 0.04], right: R,
    left: null, leftGrip: false,
  },
  rojao: {
    // vara na mão direita, foguete apontando pra frente e um pouco pra cima, pavio aceso perto dos dedos
    hipPos: [0.17, -0.2, -0.44], hipRot: [0.28, 0.32, 0.02], right: pose(0.0, -0.004, 0.0, 0.45, 0.32, -1.45),
    left: null, leftGrip: false, thrown: true,
  },
  galinha: {
    // duas mãos segurando a galinha pelo corpo, como o pombo
    hipPos: [0.03, -0.2, -0.5], hipRot: [0.12, 0.7, 0.0], right: pose(0.09, -0.025, 0.02, 0.55, 0.3, -1.65),
    left: pose(-0.09, -0.025, 0.02, 0.55, -0.3, 1.65), leftGrip: false, thrown: true,
  },
};

const BACK_FEEL: Partial<Record<SpecialId, [number, number]>> = {
  estilingue: [0.02, 0.06], dolly: [0.0, 0.0], tijolo: [0.0, 0.0], rojao: [0.05, 0.03], galinha: [0.01, 0.02],
};

// ------------------------------------------------------------------ partículas no viewmodel

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

/** Quads aditivos na cena do viewmodel (câmera fixa olhando -Z: não precisa girar para a câmera). */
class VmFx {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private P: Float32Array;
  private Pr: Float32Array; // vx vy vz life max s0 s1 g rot
  private C0: Float32Array;
  private C1: Float32Array;
  private col: Float32Array;

  constructor(private cap = 96) {
    const mat = new THREE.MeshBasicMaterial({ map: softTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0, 0, 0));
    this.col = this.mesh.instanceColor!.array as Float32Array;
    this.P = new Float32Array(cap * 3);
    this.Pr = new Float32Array(cap * 9);
    this.C0 = new Float32Array(cap * 3);
    this.C1 = new Float32Array(cap * 3);
  }

  spawn(p: THREE.Vector3, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, c0: number, c1: number, g = 0): void {
    let i = this.n;
    if (i >= this.cap) i = (Math.random() * this.cap) | 0;
    else this.n++;
    this.P[i * 3] = p.x; this.P[i * 3 + 1] = p.y; this.P[i * 3 + 2] = p.z;
    const o = i * 9;
    this.Pr[o] = vx; this.Pr[o + 1] = vy; this.Pr[o + 2] = vz;
    this.Pr[o + 3] = life; this.Pr[o + 4] = life; this.Pr[o + 5] = s0; this.Pr[o + 6] = s1; this.Pr[o + 7] = g; this.Pr[o + 8] = Math.random() * 6.28;
    _c.setHex(c0); _c2.setHex(c1);
    this.C0[i * 3] = _c.r; this.C0[i * 3 + 1] = _c.g; this.C0[i * 3 + 2] = _c.b;
    this.C1[i * 3] = _c2.r; this.C1[i * 3 + 1] = _c2.g; this.C1[i * 3 + 2] = _c2.b;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    for (let i = this.n - 1; i >= 0; i--) {
      const o = i * 9;
      this.Pr[o + 3] -= dt;
      if (this.Pr[o + 3] <= 0) {
        const l = --this.n;
        if (i !== l) {
          this.P.copyWithin(i * 3, l * 3, l * 3 + 3);
          this.Pr.copyWithin(o, l * 9, l * 9 + 9);
          this.C0.copyWithin(i * 3, l * 3, l * 3 + 3);
          this.C1.copyWithin(i * 3, l * 3, l * 3 + 3);
        }
      }
    }
    for (let i = 0; i < this.n; i++) {
      const o = i * 9, i3 = i * 3;
      this.Pr[o + 1] -= this.Pr[o + 7] * dt;
      this.P[i3] += this.Pr[o] * dt; this.P[i3 + 1] += this.Pr[o + 1] * dt; this.P[i3 + 2] += this.Pr[o + 2] * dt;
      const t = 1 - this.Pr[o + 3] / this.Pr[o + 4];
      const s = this.Pr[o + 5] + (this.Pr[o + 6] - this.Pr[o + 5]) * t;
      _p.set(this.P[i3], this.P[i3 + 1], this.P[i3 + 2]);
      _q.setFromAxisAngle(_zAxis, this.Pr[o + 8]);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      const a = 1 - t;
      this.col[i3] = (this.C0[i3] + (this.C1[i3] - this.C0[i3]) * t) * a;
      this.col[i3 + 1] = (this.C0[i3 + 1] + (this.C1[i3 + 1] - this.C0[i3 + 1]) * t) * a;
      this.col[i3 + 2] = (this.C0[i3 + 2] + (this.C1[i3 + 2] - this.C0[i3 + 2]) * t) * a;
    }
    this.mesh.count = this.n;
    if (this.n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
    }
  }
}
const _zAxis = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------ rig

interface Rig {
  id: SpecialId;
  def: RigDef;
  root: THREE.Group;
  item: THREE.Object3D;
  parts: HeldParts;
  tick: (dt: number, t: number, active?: number) => void;
  right: THREE.Mesh;
  left: THREE.Mesh | null;
  line2?: THREE.Mesh;
  hipPos: THREE.Vector3;
  hipRot: THREE.Euler;
}

let armGeo: { r: THREE.BufferGeometry; l: THREE.BufferGeometry; lo: THREE.BufferGeometry } | null = null;
function arms() {
  armGeo ??= { r: buildArm('right', true).geometry, l: buildArm('left', true).geometry, lo: buildArm('left', false).geometry };
  return armGeo;
}

function buildRig(id: SpecialId): Rig {
  const def = DEFS[id];
  const root = new THREE.Group();
  const item = buildHeldModel(id);
  root.add(item);
  const A = arms();
  const right = new THREE.Mesh(A.r, vmMaterial);
  right.rotation.order = 'YXZ';
  right.frustumCulled = false;
  root.add(right);
  let left: THREE.Mesh | null = null;
  if (def.left) {
    left = new THREE.Mesh(def.leftGrip ? A.l : A.lo, vmMaterial);
    left.rotation.order = 'YXZ';
    left.frustumCulled = false;
    root.add(left);
  }
  root.visible = false;
  // pipa: segundo trecho de linha (da mão esquerda até o céu)
  let line2: THREE.Mesh | undefined;
  if (id === 'pipa') {
    line2 = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 1).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0xfff4d0 }));
    line2.frustumCulled = false;
    root.add(line2);
  }
  return {
    id, def, root, item, parts: item.userData.parts as HeldParts, tick: item.userData.tick,
    right, left, line2,
    hipPos: new THREE.Vector3(...def.hipPos),
    hipRot: new THREE.Euler(def.hipRot[0], def.hipRot[1], def.hipRot[2], 'YXZ'),
  };
}

/**
 * Perna do chute (bola): chuteira preta com listras brancas e travas, meião amarelo com faixa verde, caneleira.
 * Origem = tornozelo; bico do pé em -Z; canela sobe em +Y (até o joelho, fora da tela).
 */
function buildLeg(): THREE.Group {
  const g = new THREE.Group();
  const b = new Builder();
  // chuteira
  b.box(PALK.boot, 0.1, 0.07, 0.24, 0, -0.03, -0.07);
  b.box(PALK.boot, 0.09, 0.05, 0.06, 0, -0.035, -0.2, 0.25);
  for (const x of [-0.03, 0.0, 0.03]) b.box(0xffffff, 0.102, 0.012, 0.016, 0, -0.01, -0.08 + x, 0, 0, 0);
  b.box(0xffffff, 0.012, 0.05, 0.1, 0.051, -0.025, -0.05, 0, 0, 0);
  b.box(0xffffff, 0.012, 0.05, 0.1, -0.051, -0.025, -0.05, 0, 0, 0);
  for (const z of [-0.17, -0.11, -0.04, 0.03]) for (const x of [-0.03, 0.03]) b.box(PALK.stud, 0.018, 0.016, 0.018, x, -0.072, z);
  b.box(PALK.boot, 0.1, 0.04, 0.06, 0, -0.02, 0.04); // calcanhar
  // meião + caneleira
  b.box(PALK.sock, 0.095, 0.4, 0.1, 0, 0.2, 0.0);
  b.box(PALK.sockBand, 0.097, 0.03, 0.102, 0, 0.36, 0.0);
  b.box(PALK.sockBand, 0.097, 0.03, 0.102, 0, 0.31, 0.0);
  b.box(PALK.guard, 0.07, 0.2, 0.02, 0, 0.18, -0.055);
  // joelho/short
  b.box(PALK.skin, 0.1, 0.12, 0.11, 0, 0.45, 0.0);
  b.box(PALK.shorts, 0.15, 0.2, 0.15, 0, 0.6, 0.0);
  const m = b.mesh(vmMaterial);
  g.add(m);
  g.visible = false;
  return g;
}
const PALK = { boot: 0x16171a, stud: 0xd8dde3, sock: 0xffd200, sockBand: 0x2f9e4a, guard: 0x2a4fa8, skin: 0xd8a47e, shorts: 0x2a4fa8 };

export interface Offs {
  px: number; py: number; pz: number; rx: number; ry: number; rz: number;
}

const rnd = (a: number) => (Math.random() * 2 - 1) * a;
/** Cores de festa junina (faíscas do rojão). */
const FESTA = [0xffe080, 0x28ffa8, 0xff4a3a, 0xffd200, 0x2a9bff, 0xff5ad0];
const pick = <T,>(a: readonly T[]): T => a[(Math.random() * a.length) | 0];

export class SpecialHands {
  /** Filho do holder do ViewModel. */
  readonly root = new THREE.Group();
  private rigs = new Map<SpecialId, Rig>();
  private rig: Rig | null = null;
  private fx = new VmFx();
  private t = 0;
  private raise = 1;
  private fireT = 99;
  /** Chinelo: instante (em fireT) em que ele voltou pra mão. */
  private catchT = 99;
  private charge = 0;
  private charging = false;
  private pouchZ = 0;
  private pouchV = 0;
  private beamT = 99;
  private active = 0;
  private emitAcc = 0;
  private struggle = 0;
  private readonly offs: Offs = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };

  /** `kick(back, up, side)` → molas de recuo do ViewModel. */
  /** Perna do chute (cena do viewmodel, espaço da câmera: não segue o bob da mão). */
  private leg = buildLeg();
  private tug = 0;

  constructor(scene: THREE.Scene, private kick: (back: number, up: number, side: number) => void) {
    scene.add(this.fx.mesh);
    scene.add(this.leg);
    bus.on('special:fire', (e) => {
      if (!e.local || !this.rig || e.kind !== this.rig.id) return;
      this.fireT = 0;
      this.catchT = 99;
      const f = BACK_FEEL[e.kind];
      if (f) this.kick(f[0], f[1], 0.02);
      if (e.kind === 'estilingue') {
        this.pouchV = -2.2;
        this.charging = false;
        this.charge = 0;
      }
    });
    bus.on('special:catch', (e) => {
      if (e.local && this.rig?.id === 'chinelo') this.catchT = this.fireT;
    });
    bus.on('special:charge', (e) => {
      if (!e.local) return;
      this.charge = e.charge;
      this.charging = e.charge > 0;
    });
    bus.on('special:beam', (e) => {
      if (!e.local) return;
      this.beamT = e.on ? 0 : 99;
    });
    bus.on('special:kite', (e) => {
      if (!e.local) return;
      this.beamT = e.on ? 0 : 99;
    });
    bus.on('special:pickup', (e) => {
      if (e.local) this.raise = 0;
    });
  }

  get current(): SpecialId | null {
    return this.rig?.id ?? null;
  }

  get hipPos(): THREE.Vector3 {
    return this.rig!.hipPos;
  }

  get hipRot(): THREE.Euler {
    return this.rig!.hipRot;
  }

  set(id: SpecialId | null): void {
    if ((this.rig?.id ?? null) === id) return;
    if (this.rig) {
      this.rig.root.visible = false;
      this.rig.root.removeFromParent();
    }
    this.rig = null;
    this.fx.clear();
    this.leg.visible = false;
    if (!id) return;
    let r = this.rigs.get(id);
    if (!r) this.rigs.set(id, (r = buildRig(id)));
    this.rig = r;
    this.root.add(r.root);
    r.root.visible = true;
    this.raise = 0;
    this.fireT = 99;
    this.charge = 0;
    this.charging = false;
    this.pouchZ = 0;
    this.pouchV = 0;
    this.beamT = 99;
    this.active = 0;
  }

  private world(o: THREE.Object3D): THREE.Vector3 {
    return o.getWorldPosition(_v);
  }

  /** Ponto no espaço do pai de `o` → mundo (para lookAt). */
  private toWorldOf(o: THREE.Object3D, p: THREE.Vector3): THREE.Vector3 {
    return _v4.copy(p).applyMatrix4(o.parent!.matrixWorld);
  }

  /** Avança animações; devolve offsets para somar no holder. */
  update(dt: number, dtReal: number): Offs {
    const o = this.offs;
    o.px = o.py = o.pz = o.rx = o.ry = o.rz = 0;
    this.fx.update(dtReal);
    const r = this.rig;
    if (!r) return o;
    this.t += dt;
    this.fireT += dt;
    this.beamT += dtReal;
    const t = this.t, ft = this.fireT;
    const beamOn = this.beamT < 0.15;
    this.active += ((beamOn ? 1 : 0) - this.active) * Math.min(1, dt * (beamOn ? 14 : 4));
    const P = r.parts;
    const item = r.item;
    item.position.set(0, 0, 0);
    item.rotation.set(0, 0, 0);
    item.visible = true;
    this.leg.visible = false;
    applyPose(r.right, r.def.right, r.def.right, 0);
    if (r.left && r.def.left) applyPose(r.left, r.def.left, r.def.left, 0);

    // levantar ao pegar
    if (this.raise < 1) {
      this.raise = Math.min(1, this.raise + dt / 0.45);
      const d = 1 - smooth(this.raise);
      o.py -= d * 0.25;
      o.rx -= d * 0.8;
      o.rz += d * 0.3;
    }

    // arremesso genérico: joga, some, volta um novo por baixo
    // Chinelo fica fora da mão até o evento de "pegou de volta" (ou 8 s, por segurança)
    const back = r.id === 'chinelo' ? Math.min(this.catchT, 8) : 0.32;
    if (r.def.thrown && ft < back + 1) {
      const fling = seg(ft, 0, 0.06) * (1 - seg(ft, 0.06, 0.3));
      const follow = seg(ft, 0.04, 0.16) * (1 - seg(ft, back, back + 0.3));
      if (r.id === 'bola') {
        // a mão solta a bola e sai da frente do pé
        o.py -= 0.05 * fling;
        o.px += 0.1 * follow;
        o.py -= 0.12 * follow;
        o.rz -= 0.4 * follow;
      } else if (r.id === 'pombo') {
        o.pz -= 0.14 * fling;
        o.py += 0.1 * fling;
        o.rx += 0.4 * fling;
        o.py -= 0.2 * follow;
      } else if (r.id === 'galinha') {
        // arremesso por baixo, com a galinha esperneando pra frente
        o.pz -= 0.18 * fling;
        o.py += 0.04 * fling;
        o.rx += 0.5 * fling;
        o.py -= 0.22 * follow;
      } else if (r.id === 'chinelo') {
        // chicotada lateral (frisbee)
        o.px -= 0.18 * fling;
        o.ry += 1.0 * fling;
        o.rz += 0.8 * fling;
        o.py -= 0.2 * follow;
        o.rx -= 0.5 * follow;
      } else {
        o.pz -= 0.2 * fling;
        o.py += 0.08 * fling;
        o.rx -= 0.9 * fling;
        o.px -= 0.06 * follow;
        o.py -= 0.24 * follow;
        o.rx -= 0.7 * follow;
      }
      item.visible = ft < 0.05 || ft > back + 0.05;
    }

    switch (r.id) {
      case 'lorenzetti': {
        if (this.active > 0.05) {
          const a = this.active;
          o.px += rnd(0.004) * a; o.py += rnd(0.004) * a; o.pz += 0.01 * a;
          o.rx += rnd(0.04) * a; o.rz += rnd(0.05) * a;
          this.emit(dtReal, 70 * a, () => {
            const p = this.world(P.muzzle);
            this.fx.spawn(p, rnd(0.8), rnd(0.8), -Math.random() * 0.8, 0.12, 0.04, 0.005, 0xffffff, 0x3a8cff, 2);
            if (Math.random() < 0.3) {
              // choque na própria mão (é chuveiro, né)
              const h = this.world(r.right);
              this.fx.spawn(h, rnd(0.5), rnd(0.5) + 0.2, rnd(0.3), 0.1, 0.03, 0.005, 0xe0f4ff, 0x4aa8ff, 1);
            }
          });
        } else if (Math.sin(t * 0.7) > 0.97) {
          // pinga
          this.emit(dtReal, 6, () => this.fx.spawn(this.world(P.muzzle), 0, -0.3, 0, 0.5, 0.012, 0.01, 0x7cd0ff, 0x2a6aa0, 1.5));
        }
        break;
      }

      case 'estilingue': {
        // carga: puxa a bolsinha para trás; solta: estala para frente e balança
        const tgt = this.charging ? this.charge : 0;
        if (this.charging) {
          this.pouchZ += (tgt - this.pouchZ) * Math.min(1, dt * 20);
          this.pouchV = 0;
        } else {
          this.pouchV += (-260 * this.pouchZ - 9 * this.pouchV) * dt;
          this.pouchZ += this.pouchV * dt;
        }
        const c = this.pouchZ;
        P.pouch!.position.set(0, 0.045 - Math.max(0, c) * 0.03, 0.06 + c * 0.22);
        P.stone!.visible = ft > 0.35 || this.charging;
        if (r.left && r.def.left) {
          r.left.position.copy(r.def.left.p);
          r.left.position.z += c * 0.22;
          r.left.position.y -= Math.max(0, c) * 0.03;
        }
        const ch = this.charging ? this.charge : 0;
        o.px -= ch * 0.03;
        o.py += ch * 0.02;
        o.pz += ch * 0.03;
        if (ch > 0.75) {
          const k = (ch - 0.75) * 4;
          o.px += rnd(0.003) * k; o.py += rnd(0.003) * k; o.rz += rnd(0.03) * k;
        }
        updateBands(P);
        break;
      }

      case 'dolly': {
        // chacoalha de tempos em tempos (vai explodir de gás)
        const cyc = (t % 2.8) / 2.8;
        const sh = pulse(cyc, 0, 0.22, 0.2);
        if (sh > 0 && item.visible) {
          o.rz += Math.sin(t * 48) * 0.35 * sh;
          o.py += Math.sin(t * 48 + 1) * 0.014 * sh;
          o.rx += Math.cos(t * 41) * 0.12 * sh;
          this.emit(dtReal, 30 * sh, () => {
            const p = this.world(P.muzzle);
            this.fx.spawn(p, rnd(0.15), 0.3 + Math.random() * 0.3, rnd(0.1), 0.35, 0.015, 0.03, 0xffe8d0, 0x806040, 0.5);
          });
        }
        break;
      }

      case 'rexona': {
        const a = this.active;
        P.nozzle!.position.y = 0.124 - a * 0.006;
        const f = 0.85 + Math.random() * 0.3;
        P.flame!.scale.set(0.028 * f * (1 + a * 1.5), 0.05 * f * (1 + a * 2), 1);
        if (a > 0.05) {
          o.px += rnd(0.002) * a; o.py += rnd(0.002) * a; o.pz += 0.008 * a;
          o.rz += rnd(0.02) * a;
          this.emit(dtReal, 90 * a, () => {
            const p = this.world(P.muzzle);
            const sp = 1.2 + Math.random() * 0.6;
            this.fx.spawn(p, rnd(0.12), rnd(0.12) + 0.05, -sp, 0.22, 0.02, 0.14, 0xfff0a0, 0xff3010, -0.4);
          });
        }
        break;
      }

      case 'pombo': {
        // o pombo não para quieto: debate às vezes, as mãos apertam
        const burst = Math.max(0, Math.sin(t * 1.7) * Math.sin(t * 4.3));
        this.struggle += ((burst > 0.4 ? 1 : 0) - this.struggle) * Math.min(1, dt * 10);
        const s = this.struggle;
        item.rotation.z = Math.sin(t * 31) * 0.12 * s;
        item.rotation.x = Math.sin(t * 23) * 0.06 * s;
        item.position.y = Math.abs(Math.sin(t * 27)) * 0.012 * s;
        o.px += Math.sin(t * 29) * 0.004 * s;
        r.right.position.x -= 0.006 * s;
        r.left!.position.x += 0.006 * s;
        if (s > 0.6) {
          this.emit(dtReal, 4 * s, () => {
            const p = this.world(P.wingR!);
            this.fx.spawn(p, rnd(0.3), 0.2, rnd(0.2), 0.5, 0.02, 0.02, 0x9aa0aa, 0x30343a, 0.6);
          });
        }
        r.tick(dt, t, s);
        break;
      }

      case 'chinelo': {
        // "ameaça" de mãe: dá umas batidinhas no ar
        if (item.visible && ft > 1.8) {
          const cyc = (t % 2.4) / 2.4;
          const tap = pulse(cyc, 0, 0.1, 0.3) + pulse(cyc, 0.12, 0.22, 0.3);
          o.rx -= tap * 0.35;
          o.py += tap * 0.015;
        }
        break;
      }

      case 'panela': {
        // pino girando e chiando
        P.valve!.rotation.set(Math.sin(t * 37) * 0.25, t * 14, Math.cos(t * 33) * 0.25);
        P.valve!.position.y = 0.052 + Math.abs(Math.sin(t * 41)) * 0.004;
        o.rx += rnd(0.004);
        o.rz += rnd(0.004);
        if (item.visible) {
          this.emit(dtReal, 26, () => {
            const p = this.world(P.muzzle);
            this.fx.spawn(p, rnd(0.08), 0.35 + Math.random() * 0.3, rnd(0.08), 0.45, 0.02, 0.09, 0x9aa0a8, 0x202428, -0.2);
          });
        }
        break;
      }

      case 'bola': {
        // embaixadinha na mão enquanto espera
        if (item.visible && ft > 0.6) {
          const cyc = (t % 1.3) / 1.3;
          item.position.y = Math.abs(Math.sin(cyc * Math.PI)) * 0.06 - 0.01;
          item.rotation.x = -cyc * Math.PI * 2;
        }
        // chute: a perna entra por baixo, encontra a bola e segue pra cima
        if (ft < 0.55) {
          const L = this.leg;
          L.visible = true;
          const a1 = seg(ft, 0, 0.07), a2 = seg(ft, 0.07, 0.2), a3 = seg(ft, 0.24, 0.55);
          // início (fora, embaixo) → impacto → follow-through alto → cai
          const x = 0.22 + (0.12 - 0.22) * a1 + (0.04 - 0.12) * a2 + (0.16 - 0.04) * a3;
          const y = -0.72 + (-0.2 + 0.72) * a1 + (-0.02 + 0.2) * a2 + (-0.95 + 0.02) * a3;
          const z = -0.35 + (-0.56 + 0.35) * a1 + (-0.72 + 0.56) * a2 + (-0.4 + 0.72) * a3;
          L.position.set(x, y, z);
          // canela desce pra trás (o joelho fica fora da tela, embaixo); bico pra cima: chutão de bico
          L.rotation.set(1.6 + 0.5 * a1 + 0.35 * a2 - 0.9 * a3, -0.25 + 0.3 * a2, 0.1, 'YXZ');
          if (ft < 0.09 && ft + dt >= 0.07) this.kick(0, 0.05, 0.03);
        }
        break;
      }

      case 'pipa': {
        // lata gira (rápido com a pipa no ar), a mão esquerda dá puxões na linha
        const a = this.active;
        P.reel!.rotation.z += (0.4 + a * 16) * dt;
        const cyc = (t % 0.55) / 0.55;
        const pull = a * pulse(cyc, 0, 0.5, 0.25);
        this.tug += (pull - this.tug) * Math.min(1, dt * 30);
        if (r.left && r.def.left) {
          r.left.position.z += this.tug * 0.09;
          r.left.position.y -= this.tug * 0.03;
          r.left.rotation.x += this.tug * 0.3;
        }
        o.rx -= 0.08 * a + this.tug * 0.03;
        o.px += rnd(0.0015) * a; o.py += rnd(0.0015) * a;
        // linha: lata → mão esquerda → céu
        if (r.left && r.line2) {
          const hand = _v2.copy(r.left.position);
          hand.y += 0.015;
          const ln = P.line!;
          ln.position.set(0, 0.105, -0.06);
          ln.lookAt(this.toWorldOf(ln, hand));
          ln.scale.set(1, 1, Math.max(0.01, ln.position.distanceTo(hand)));
          // o box da linha cresce para -z: vira 180° pra apontar pra mão
          ln.rotateY(Math.PI);
          r.line2.visible = a > 0.05;
          r.line2.position.copy(hand);
          _v.set(-0.15, 0.45, -2).add(hand);
          r.line2.lookAt(this.toWorldOf(r.line2, _v));
          r.line2.scale.set(1, 1, 3);
          // cerol brilhando
          if (a > 0.3) this.emit(dtReal, 12 * a, () => {
            const p = r.line2!.getWorldPosition(_v3);
            this.fx.spawn(p.add(_v.set(-0.04, 0.16, -0.27).multiplyScalar(Math.random() * 2)), 0, 0, 0, 0.08, 0.025, 0.004, 0xffffff, 0xff60ff);
          });
        }
        break;
      }

      case 'rojao': {
        // a faísca do pavio chia na mão; no disparo, o foguete sai deixando fumaça e faíscas de festa
        const ig = item.visible ? 1 : 0;
        P.flame!.visible = item.visible;
        o.rx += rnd(0.003) * ig;
        o.rz += rnd(0.003) * ig;
        if (item.visible) {
          this.emit(dtReal, 34, () => {
            const p = this.world(P.flame!);
            this.fx.spawn(p, rnd(0.25), 0.15 + Math.random() * 0.3, rnd(0.25), 0.28, 0.018, 0.004, pick(FESTA), 0xff4010, 1.2);
          });
        }
        if (ft < 0.3) {
          this.emit(dtReal, 120 * (1 - ft / 0.3), () => {
            const p = this.world(P.muzzle);
            this.fx.spawn(p, rnd(0.2), rnd(0.2), -0.6 - Math.random() * 0.8, 0.3, 0.05, 0.2, pick(FESTA), 0x303030);
          });
        }
        break;
      }

      case 'galinha': {
        // a galinha não para quieta: esperneia, as mãos apertam e solta pena
        const burst = Math.max(0, Math.sin(t * 1.9) * Math.sin(t * 4.1));
        this.struggle += ((burst > 0.35 ? 1 : 0) - this.struggle) * Math.min(1, dt * 10);
        const s = this.struggle;
        item.rotation.z = Math.sin(t * 29) * 0.14 * s;
        item.rotation.x = Math.sin(t * 21) * 0.08 * s;
        item.position.y = Math.abs(Math.sin(t * 25)) * 0.014 * s;
        o.px += Math.sin(t * 27) * 0.004 * s;
        r.right.position.x -= 0.006 * s;
        r.left!.position.x += 0.006 * s;
        if (s > 0.6) {
          this.emit(dtReal, 5 * s, () => {
            const p = this.world(P.wingR!);
            this.fx.spawn(p, rnd(0.35), 0.2, rnd(0.2), 0.55, 0.022, 0.018, 0xe0b070, 0x6a4a28, 0.7);
          });
        }
        r.tick(dt, t, s);
        break;
      }

      case 'cafe': {
        const a = this.active;
        // mão esquerda aperta o botão de pressão
        // o polegar aperta o botão de pressão e a garrafa inclina "servindo"
        P.nozzle!.position.y = 0.188 - a * 0.009;
        if (a > 0.05) {
          o.px += rnd(0.003) * a; o.py += rnd(0.003) * a; o.pz += 0.012 * a;
          o.rx -= 0.3 * a;
          o.rz += 0.1 * a;
          this.emit(dtReal, 80 * a, () => {
            const p = this.world(P.muzzle);
            if (Math.random() < 0.7) this.fx.spawn(p, rnd(0.12), rnd(0.1) + 0.05, -1.5 - Math.random() * 0.6, 0.25, 0.025, 0.08, 0x9a5a22, 0x3a1a08, 1.5);
            else this.fx.spawn(p, rnd(0.2), 0.3 + Math.random() * 0.3, -0.8, 0.5, 0.04, 0.2, 0x8a8a8a, 0x202020, -0.3);
          });
        } else if (item.visible && Math.random() < dtReal * 8) {
          // fumacinha de café quente saindo do bico
          this.fx.spawn(this.world(P.muzzle), rnd(0.04), 0.25, rnd(0.04), 0.7, 0.012, 0.06, 0x9a9a9a, 0x202020, -0.15);
        }
        break;
      }

      case 'ventilador': {
        const a = this.active;
        r.tick(dt, t, a);
        if (a > 0.05) {
          o.pz += 0.02 * a;
          o.px += rnd(0.003) * a; o.py += rnd(0.003) * a;
          o.rx += rnd(0.012) * a - 0.04 * a;
          this.emit(dtReal, 25 * a, () => {
            const p = this.world(P.muzzle);
            this.fx.spawn(p, rnd(0.25), rnd(0.25), -1.8, 0.2, 0.05, 0.25, 0x406070, 0x101820);
          });
        }
        return o;
      }

      case 'tijolo': {
        // joga pra cima e pega (malandragem)
        if (item.visible && ft > 0.7) {
          const cyc = (t % 3.2) / 3.2;
          const k = clamp01(cyc / 0.22);
          if (cyc < 0.22) {
            item.position.y = Math.sin(k * Math.PI) * 0.09;
            item.rotation.x = -k * Math.PI * 2;
            if (cyc > 0.19) o.py -= 0.01;
          }
        }
        break;
      }
    }
    if (r.id !== 'pombo' && r.id !== 'galinha') r.tick(dt, t, this.active);
    return o;
  }

  private emit(dt: number, rate: number, f: () => void): void {
    this.emitAcc += dt * rate;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      f();
    }
  }
}

export { DEFS as SPECIAL_RIGS };
