import * as THREE from 'three';
import { bus } from '../../core/events';
import type { Actor } from '../../game/Actor';
import { SPECIALS, type BeamKind, type SpecialId, type StatusKind } from '../../game/special/defs';
import { buildKiteModel } from './models';
import { Overlay } from './overlay';
import { ChunkPool, QuadPool, Ribbon, ringTexture, softTexture, starTexture } from './pools';

/**
 * Efeitos das armas malucas: raio elétrico, lança-chamas, vento, gêiser de Dolly, feijão, penas, status nos bonecos,
 * arma na mão (1ª e 3ª pessoa) e overlays de tela. Tudo reage a eventos do `bus` (ver core/events.ts):
 * o artista pode trocar o desenho aqui sem tocar na lógica (game/special/*).
 */

const V = THREE.Vector3;
const _a = new V(), _b = new V(), _c = new V(), _u = new V(), _w = new V();
const UP = new V(0, 1, 0);
const rnd = (a: number) => (Math.random() * 2 - 1) * a;
const rr = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]): T => a[(Math.random() * a.length) | 0];

export interface FxHost {
  actors(): Iterable<Actor>;
  local(): Actor | null;
  statusLeft(id: string, kind: StatusKind): number;
  localBlind(): number;
  /** Vapor do café na tela do jogador local, 0..1. */
  localSteam(): number;
  groundY(x: number, y: number, z: number): number;
}

interface Beam {
  kind: BeamKind;
  actorId: string;
  ttl: number;
  origin: THREE.Vector3;
  end: THREE.Vector3;
  end2: THREE.Vector3 | null;
  dir: THREE.Vector3;
  hit: boolean;
  chop: boolean;
  local: boolean;
  acc: number;
  core: Ribbon | null;
  glow: Ribbon | null;
  arc: Ribbon | null;
  arcGlow: Ribbon | null;
}

/** Pipa no ar (placeholder visual): modelo + linha de cerol da mão até ela. */
interface KiteFx {
  model: THREE.Object3D;
  line: Ribbon;
  ttl: number;
  origin: THREE.Vector3;
  kite: THREE.Vector3;
  shownOrigin: THREE.Vector3;
  shownKite: THREE.Vector3;
  hit: boolean;
  fresh: boolean;
}

interface StarSet {
  sprites: THREE.Sprite[];
}

const FEATHER = [0xffffff, 0xe8ecf4, 0xc9d0dc, 0xa8b0c0];
const DROP = [0xd8802c, 0xe89a44, 0xff6a96, 0xf2c27a];
const BEAN = [0x2b160c, 0x3f2212, 0x5a3418, 0x1c0e08, 0x6b4020];
const CONFETTI = [0x2fe05a, 0xffd200, 0xffffff, 0x2a9bff, 0x2fe05a, 0xffd200];
const RED_BITS = [0xd8342c, 0xb8241e, 0x8e1a16];
const CLOTH = [0x3a5a8a, 0x5a6a3a, 0xe8e0d0, 0x2a2a2e];
const COFFEE = [0x4a2a12, 0x5a3418, 0x3a1e0c];
const RICE = [0xf6f2e4, 0xffffff, 0xece4cc];
const LEAF = [0x6a8a3a, 0x8aa040, 0xa08040, 0xc8b070, 0x5a6a30];
/** Penas da galinha da vovó. */
const HEN_FEATHER = [0xe0b070, 0xc58a4a, 0xf2d8a0, 0x8c5a2a];
/** Fogos de festa junina (rojão): verde-bandeira, vermelho, amarelo, azul e rosa. */
const FESTA = [0x28ffa8, 0xff4a3a, 0xffd200, 0x2a9bff, 0xff5ad0];
const FESTA_BITS = [0x28ffa8, 0xff4a3a, 0xffd200, 0x2a9bff, 0xff5ad0, 0xffffff, 0xffd200];

let _net: THREE.BufferGeometry | null = null;
/** Rede do gol (grade de linhas abaulada, 2x1.3, normal +Z). */
function netGeo(): THREE.BufferGeometry {
  if (_net) return _net;
  const v: number[] = [];
  const W = 1, H = 0.66, n = 12, m = 8;
  const bulge = (x: number, y: number) => -0.25 * (1 - (x / W) ** 2) * (1 - (y / H) ** 2);
  for (let i = 0; i <= n; i++) {
    const x = -W + (2 * W * i) / n;
    for (let j = 0; j < m; j++) {
      const y0 = -H + (2 * H * j) / m, y1 = -H + (2 * H * (j + 1)) / m;
      v.push(x, y0, bulge(x, y0), x, y1, bulge(x, y1));
    }
  }
  for (let j = 0; j <= m; j++) {
    const y = -H + (2 * H * j) / m;
    for (let i = 0; i < n; i++) {
      const x0 = -W + (2 * W * i) / n, x1 = -W + (2 * W * (i + 1)) / n;
      v.push(x0, y, bulge(x0, y), x1, y, bulge(x1, y));
    }
  }
  // travessão e traves
  v.push(-W, H, 0, W, H, 0, -W, H, 0, -W, -H, 0, W, H, 0, W, -H, 0);
  _net = new THREE.BufferGeometry();
  _net.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  _net.userData.lines = true;
  return _net;
}

export class SpecialFX {
  private additive: QuadPool;
  private soft: QuadPool;
  private chunks: ChunkPool;
  private overlay = new Overlay();
  private beams = new Map<string, Beam>();
  private kites = new Map<string, KiteFx>();
  private kitePts: THREE.Vector3[] = [];
  private stars = new Map<string, StarSet>();
  private thirdHeld = new Map<string, { kind: SpecialId; obj: THREE.Object3D }>();
  private columns: { mesh: THREE.Mesh; t: number; kind: 'dolly' | 'panela' | 'ring' }[] = [];
  private colGeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  private ringGeo = new THREE.RingGeometry(0.6, 1, 28).rotateX(-Math.PI / 2);
  /** Decalques temporários (rede do golaço) que encaram a câmera na hora em que nascem. */
  private stamps: { mesh: THREE.Object3D; mat: THREE.Material & { opacity: number }; t: number; life: number; pop: number; base: number }[] = [];

  // arma na mão (1ª pessoa)
  private heldRoot = new THREE.Group();
  private heldKind: SpecialId | null = null;
  private heldObj: THREE.Object3D | null = null;
  private heldKick = 0;
  private heldPull = 0;
  private bob = 0;
  private time = 0;
  private flameAcc = 0;
  private ringT = 0;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, vmScene: THREE.Scene, private host: FxHost) {
    this.additive = new QuadPool(scene, 900, softTexture(), true);
    this.soft = new QuadPool(scene, 400, softTexture(), false);
    this.chunks = new ChunkPool(scene, 500);
    this.heldRoot.visible = false;
    vmScene.add(this.heldRoot);
    this.wire();
  }

  /** Desliga os overlays de tela daqui (se o HUD for desenhar os dele a partir do HudState). */
  set overlayEnabled(v: boolean) {
    this.overlay.enabled = v;
  }

  // ---------------------------------------------------------------- API

  reset(): void {
    this.additive.clear();
    this.soft.clear();
    this.chunks.clear();
    for (const id of [...this.beams.keys()]) this.dropBeam(id);
    for (const id of [...this.kites.keys()]) this.dropKite(id);
    for (const s of this.stars.values()) for (const sp of s.sprites) this.scene.remove(sp);
    this.stars.clear();
    for (const t of this.thirdHeld.values()) t.obj.removeFromParent();
    this.thirdHeld.clear();
    for (const c of this.columns) this.scene.remove(c.mesh);
    this.columns.length = 0;
    for (const st of this.stamps) { this.scene.remove(st.mesh); st.mat.dispose(); }
    this.stamps.length = 0;
    this.setHeld(null);
  }

  clearActor(id: string): void {
    for (const k of [...this.beams.keys()]) if (k.startsWith(id + ':')) this.dropBeam(k);
    this.dropKite(id);
    const s = this.stars.get(id);
    if (s) { for (const sp of s.sprites) this.scene.remove(sp); this.stars.delete(id); }
    const t = this.thirdHeld.get(id);
    if (t) { t.obj.removeFromParent(); this.thirdHeld.delete(id); }
  }

  /** Arma maluca na mão do jogador local (null = guardou). */
  setHeld(kind: SpecialId | null): void {
    if (kind === this.heldKind) return;
    this.heldKind = kind;
    this.heldObj?.removeFromParent();
    this.heldObj = null;
    this.heldKick = 0;
    this.heldPull = 0;
    // A arma na mão (1ª pessoa) agora é desenhada pelo ViewModel (fx/vm/specialRig.ts), com braços e animação.
    this.heldRoot.visible = false;
  }

  /** Coice visual da arma na mão. */
  kickHeld(amount = 1): void {
    this.heldKick = Math.min(1.5, this.heldKick + amount);
  }

  // ---------------------------------------------------------------- eventos

  private wire(): void {
    bus.on('special:spawn', (e) => {
      this.sparkle(e.pos, SPECIALS[e.kind].color, 26, 4);
      this.ring(e.pos, SPECIALS[e.kind].color, 3.2, 0.7);
    });
    bus.on('special:pickup', (e) => {
      const c = SPECIALS[e.kind].color;
      if (!e.local) this.sparkle(_a.copy(e.pos).setY(e.pos.y + 1), c, 30, 6); // em 1ª pessoa o brilho tapa a tela
      this.ring(e.pos, c, 3, 0.5);
    });

    bus.on('special:beam', (e) => {
      const key = `${e.actorId}:${e.kind}`;
      if (!e.on) { this.beamOff(key); return; }
      let b = this.beams.get(key);
      if (!b) {
        b = {
          kind: e.kind, actorId: e.actorId, ttl: 0, origin: new V(), end: new V(), end2: null, dir: new V(), hit: false, chop: false, local: e.local, acc: 0,
          core: null, glow: null, arc: null, arcGlow: null,
        };
        if (e.kind === 'lorenzetti') {
          b.core = new Ribbon(this.scene, 16, 0xffffff, 1);
          b.glow = new Ribbon(this.scene, 16, 0x4aa8ff, 0.55);
          b.arc = new Ribbon(this.scene, 12, 0xeaf6ff, 1);
          b.arcGlow = new Ribbon(this.scene, 12, 0x4aa8ff, 0.5);
        }
        this.beams.set(key, b);
      }
      b.ttl = e.local ? 0.1 : 0.2;
      b.origin.copy(e.origin);
      b.end.copy(e.end);
      b.dir.copy(e.dir);
      b.hit = e.hit;
      b.chop = !!e.chop;
      if (e.end2) (b.end2 ??= new V()).copy(e.end2); else b.end2 = null;
    });

    bus.on('special:kite', (e) => {
      if (!e.on) { this.dropKite(e.actorId); return; }
      let k = this.kites.get(e.actorId);
      if (!k) {
        const model = buildKiteModel();
        model.scale.setScalar(2.4);
        this.scene.add(model);
        const line = new Ribbon(this.scene, 6, 0xfff4d0, 0.85);
        k = {
          model, line, ttl: 0, origin: new V(), kite: new V(), shownOrigin: e.origin.clone(), shownKite: e.origin.clone(), hit: false, fresh: true,
        };
        this.kites.set(e.actorId, k);
      }
      k.ttl = e.local ? 0.15 : 0.35;
      k.origin.copy(e.origin);
      k.kite.copy(e.kite);
      k.hit = e.hit;
    });

    bus.on('special:golaco', (e) => {
      // GOLAÇO: clarão, rede balançando atrás da vítima, chuva de confete verde-amarelo
      this.flashAt(e.pos, 0xffffff, 3.6);
      this.flashAt(e.pos, 0xffe14a, 2.2);
      this.ring(e.pos, 0xa6ee2f, 6, 0.7);
      this.stamp(e.pos, netGeo(), 0xffffff, 1.6, 1.6, 2.2, 0.9);
      const gy = this.host.groundY(e.pos.x, e.pos.y, e.pos.z);
      for (let i = 0; i < 90; i++) {
        this.chunks.spawn(e.pos.x, e.pos.y + 0.3, e.pos.z, rnd(7), rr(4, 12), rnd(7), pick(CONFETTI), {
          life: rr(1.6, 2.8), sx: 0.07, sy: 0.012, sz: 0.1, gravity: 9, floor: gy + 0.02, flutter: true, spin: 10, shrink: 0.3,
        });
      }
      for (let i = 0; i < 26; i++) {
        this.additive.spawn(e.pos.x, e.pos.y + 0.3, e.pos.z, rnd(6), rr(2, 9), rnd(6), {
          life: rr(0.5, 1), size0: rr(0.15, 0.3), size1: 0.03, c0: 0xffffff, c1: pick(CONFETTI), alpha: 1, gravity: 8, drag: 1,
        });
      }
    });

    bus.on('special:fire', (e) => {
      if (e.kind === 'bola') {
        this.puff(e.origin, 0xd8d0c0, 0.4, 0.5);
        this.sparkle(e.origin, 0xffffff, 6, 3);
      } else if (e.kind === 'rojao') {
        // largada do foguete: fumaça cinza e faíscas de festa no pavio
        for (let i = 0; i < 4; i++) this.puff(e.origin, 0xb8b8b8, 0.45, 0.7);
        for (let i = 0; i < 10; i++) this.additive.spawn(e.origin.x, e.origin.y, e.origin.z, e.dir.x * 3 + rnd(2), e.dir.y * 3 + rnd(2), e.dir.z * 3 + rnd(2), {
          life: rr(0.25, 0.5), size0: rr(0.1, 0.18), size1: 0.02, c0: pick(FESTA), c1: 0xff4010, alpha: 1, drag: 1.5,
        });
      } else if (e.kind === 'galinha') {
        // "cocóóó!": a galinha sai voando da mão deixando penas
        for (let i = 0; i < 6; i++) this.feather(e.origin, 2, HEN_FEATHER);
      } else if (e.kind === 'pipa') {
        this.sparkle(e.origin, 0xe040f0, 10, 3);
      } else if (e.kind === 'pombo') {
        for (let i = 0; i < 5; i++) this.feather(e.origin, 1.5);
      } else if (e.kind === 'estilingue') {
        this.puff(e.origin, 0xffffff, 0.2, 0.3);
      }
    });

    bus.on('special:charge', (e) => {
      if (e.local) this.heldPull = e.charge;
    });

    bus.on('special:hit', (e) => {
      if (e.kind === 'pombo') for (let i = 0; i < 16; i++) this.feather(e.pos, 3);
      else if (e.kind === 'galinha') {
        // bicada: nuvem de penas e uma faiscadinha amarela
        for (let i = 0; i < 12; i++) this.feather(e.pos, 3.5, HEN_FEATHER);
        this.sparkle(e.pos, 0xf2a020, 6, 3);
      } else if (e.kind === 'chinelo') this.sparkle(e.pos, 0xffd200, 14, 5);
      else if (e.kind === 'bola') this.sparkle(e.pos, 0xa6ee2f, 10, 4);
      else if (e.kind === 'brick' && e.headshot) {
        // BONK: estrelinhas
        this.flashAt(e.pos, 0xffe14a, 1.6);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          this.additive.spawn(e.pos.x, e.pos.y + 0.1, e.pos.z, Math.cos(a) * 3, rr(1, 3), Math.sin(a) * 3, {
            life: rr(0.5, 0.8), size0: 0.22, size1: 0.05, c0: 0xffffff, c1: 0xffd200, alpha: 1, gravity: 4, drag: 2,
          });
        }
      }
      if (e.killed) this.flashAt(e.pos, 0xffffff, 1);
    });

    bus.on('special:bounce', (e) => {
      if (e.speed > 3 && (e.kind === 'bottle' || e.kind === 'panela')) this.puff(e.pos, 0xe8dcc8, 0.3, 0.5);
      else if (e.speed > 4 && e.kind === 'bola') this.puff(e.pos, 0xd8d0c0, 0.35, 0.4);
    });

    bus.on('special:hiss', (e) => {
      const n = 1 + Math.floor(e.progress * 3);
      for (let i = 0; i < n; i++) {
        if (e.kind === 'panela') {
          this.soft.spawn(e.pos.x + rnd(0.1), e.pos.y + 0.2, e.pos.z + rnd(0.1), rnd(0.8), rr(1.6, 3.2), rnd(0.8), {
            life: rr(0.45, 0.8), size0: 0.15, size1: 0.6 + e.progress * 0.5, c0: 0xffffff, c1: 0xdde4ea, alpha: 0.55, drag: 1.2,
          });
        } else {
          // espuma da Dolly chacoalhada
          this.soft.spawn(e.pos.x + rnd(0.1), e.pos.y + 0.3, e.pos.z + rnd(0.1), rnd(1.2), rr(2.2, 4.4), rnd(1.2), {
            life: rr(0.35, 0.6), size0: 0.1, size1: 0.35 + e.progress * 0.3, c0: 0xfff0e0, c1: 0xffb8c8, alpha: 0.7, drag: 1.0, gravity: 4,
          });
        }
      }
    });

    bus.on('special:explode', (e) => (e.kind === 'dolly' ? this.geyser(e.pos, e.radius) : e.kind === 'rojao' ? this.fireworks(e.pos, e.radius) : this.beans(e.pos, e.radius)));

    bus.on('status:apply', (e) => {
      if (e.local && e.kind === 'blind') this.overlay.newSplat();
      if (e.kind === 'steam') {
        const a = this.actorById(e.actorId);
        if (a && !a.isLocal) for (let i = 0; i < 4; i++) this.puff(_a.set(a.pos.x, a.pos.y + 1.4, a.pos.z), 0xffffff, 0.6, 0.9);
      }
      if (e.kind === 'burn' || e.kind === 'shock') {
        const a = this.actorById(e.actorId);
        if (a && !a.isLocal) this.flashAt(_a.set(a.pos.x, a.pos.y + 1.1, a.pos.z), e.kind === 'burn' ? 0xffa040 : 0xaadcff, 0.9);
      }
    });
  }

  private actorById(id: string): Actor | null {
    for (const a of this.host.actors()) if (a.id === id) return a;
    return null;
  }

  // ---------------------------------------------------------------- primitivas

  private flashAt(p: THREE.Vector3, color: number, size: number): void {
    this.additive.spawn(p.x, p.y, p.z, 0, 0, 0, { life: 0.14, size0: size * 1.4, size1: size * 0.6, c0: color, alpha: 1, hold: 0.3 });
  }

  private sparkle(p: THREE.Vector3, color: number, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      this.additive.spawn(p.x, p.y, p.z, rnd(speed), rr(0.3, 1) * speed * 0.8, rnd(speed), {
        life: rr(0.35, 0.8), size0: rr(0.1, 0.22), size1: 0.02, c0: 0xffffff, c1: color, gravity: speed * 0.9, drag: 1.2, alpha: 1,
      });
    }
  }

  private puff(p: THREE.Vector3, color: number, size: number, life: number): void {
    this.soft.spawn(p.x + rnd(0.08), p.y + rnd(0.05), p.z + rnd(0.08), rnd(0.5), rr(0.2, 0.9), rnd(0.5), {
      life: rr(life * 0.6, life), size0: size * 0.5, size1: size * 1.6, c0: color, c1: color, alpha: 0.5, drag: 1.5,
    });
  }

  private feather(p: THREE.Vector3, speed: number, palette: readonly number[] = FEATHER): void {
    const gy = this.host.groundY(p.x, p.y, p.z);
    this.chunks.spawn(p.x, p.y, p.z, rnd(speed), rr(0.5, 2.2), rnd(speed), pick(palette), {
      life: rr(1.6, 2.8), sx: 0.07, sy: 0.012, sz: 0.13, gravity: 8, floor: gy + 0.02, flutter: true, spin: 6, shrink: 0.35,
    });
  }

  /** Decalque que encara a câmera ao nascer (rede/rachadura). pop = escala extra no começo; wobble = balanço. */
  private stamp(p: THREE.Vector3, geo: THREE.BufferGeometry, color: number, size: number, pop: number, life: number, wobble: number): void {
    const line = !!geo.userData.lines;
    const mat = line
      ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, fog: false })
      : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const m: THREE.Object3D = line ? new THREE.LineSegments(geo, mat) : new THREE.Mesh(geo, mat);
    m.position.copy(p);
    _c.copy(this.camera.position);
    _c.y = p.y;
    m.lookAt(_c);
    m.scale.setScalar(size);
    m.userData.wobble = wobble;
    this.scene.add(m);
    this.stamps.push({ mesh: m, mat: mat as THREE.Material & { opacity: number }, t: 0, life, pop, base: size });
    if (this.stamps.length > 10) {
      const old = this.stamps.shift()!;
      this.scene.remove(old.mesh);
      old.mat.dispose();
    }
  }

  private updateStamps(dt: number): void {
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const st = this.stamps[i];
      st.t += dt;
      const k = st.t / st.life;
      const grow = st.pop > 0 ? Math.min(1, st.t * 8) * (1 + Math.exp(-st.t * 6) * Math.sin(st.t * 30) * 0.12) : 1;
      st.mesh.scale.setScalar(st.base * grow);
      const w = st.mesh.userData.wobble as number;
      if (w) st.mesh.scale.z = st.base * (1 + Math.sin(st.t * 16) * Math.exp(-st.t * 3) * w * 2);
      st.mat.opacity = (st.pop > 0 ? 1 : 0.85) * Math.min(1, (1 - k) * 3);
      if (k >= 1) {
        this.scene.remove(st.mesh);
        st.mat.dispose();
        this.stamps.splice(i, 1);
      }
    }
  }

  private ring(p: THREE.Vector3, color: number, radius: number, life: number): void {
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    m.position.copy(p);
    m.position.y = this.host.groundY(p.x, p.y, p.z) + 0.05;
    m.scale.setScalar(0.3);
    m.userData.r = radius;
    m.userData.life = life;
    this.scene.add(m);
    this.columns.push({ mesh: m, t: 0, kind: 'ring' });
  }

  // ---------------------------------------------------------------- explosões

  /** Gêiser de refrigerante. */
  private geyser(p: THREE.Vector3, radius: number): void {
    const gy = this.host.groundY(p.x, p.y, p.z);
    // coluna
    const col = new THREE.Mesh(this.colGeo, new THREE.MeshBasicMaterial({
      color: 0xe0a064, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    col.position.set(p.x, gy, p.z);
    col.userData.maxH = 5.5;
    col.userData.gy = gy;
    col.userData.r = radius * 0.12;
    col.scale.set(0.2, 0.1, 0.2);
    this.scene.add(col);
    this.columns.push({ mesh: col, t: 0, kind: 'dolly' });
    this.ring(p, 0xff7aa0, radius, 0.6);
    this.flashAt(_a.set(p.x, gy + 0.6, p.z), 0xffd0e0, 3);
    // gotas
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * 6.28, sp = rr(0.5, 4.5);
      this.chunks.spawn(p.x, gy + 0.2, p.z, Math.cos(a) * sp, rr(7, 17), Math.sin(a) * sp, pick(DROP), {
        life: rr(0.9, 1.7), sx: rr(0.07, 0.16), sy: rr(0.07, 0.16), sz: rr(0.07, 0.16), gravity: 20, floor: gy + 0.03, shrink: 0.4,
      });
    }
    // a tampinha vermelha vai pro espaço
    this.chunks.spawn(p.x, gy + 0.4, p.z, rnd(1), 22, rnd(1), 0xd8241c, { life: 2.2, sx: 0.09, sy: 0.05, sz: 0.09, gravity: 16, floor: gy + 0.03, spin: 30 });
    // espuma
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, sp = rr(0, 2.2);
      this.soft.spawn(p.x, gy + 0.3, p.z, Math.cos(a) * sp, rr(4, 12), Math.sin(a) * sp, {
        life: rr(0.7, 1.4), size0: 0.4, size1: rr(1.0, 1.9), c0: 0xfff2e6, c1: 0xffc0cc, alpha: 0.75, drag: 0.8, gravity: 6, hold: 0.4,
      });
    }
  }

  /** Feijão da panela de pressão. */
  private beans(p: THREE.Vector3, radius: number): void {
    const gy = this.host.groundY(p.x, p.y, p.z);
    this.flashAt(_a.set(p.x, p.y + 0.3, p.z), 0xffd890, 4.5);
    this.ring(p, 0xffb060, radius, 0.45);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * 6.28, sp = rr(2, 15);
      this.chunks.spawn(p.x, p.y + 0.2, p.z, Math.cos(a) * sp, rr(4, 14), Math.sin(a) * sp, pick(BEAN), {
        life: rr(3.5, 6), sx: 0.07, sy: 0.05, sz: 0.1, gravity: 20, floor: gy + 0.04, shrink: 0.12, spin: 14,
      });
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, sp = rr(1.5, 11);
      this.chunks.spawn(p.x, p.y + 0.2, p.z, Math.cos(a) * sp, rr(4, 12), Math.sin(a) * sp, pick(RICE), {
        life: rr(3, 5), sx: 0.03, sy: 0.02, sz: 0.06, gravity: 20, floor: gy + 0.03, shrink: 0.12, spin: 16,
      });
    }
    // a tampa sai voando girando
    this.chunks.spawn(p.x, p.y + 0.3, p.z, rnd(2), rr(14, 18), rnd(2), 0x9a9ea8, { life: 3.5, sx: 0.36, sy: 0.04, sz: 0.36, gravity: 18, floor: gy + 0.03, spin: 18, shrink: 0.1 });
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.28, sp = rr(0, 5);
      this.soft.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * sp, rr(1, 5), Math.sin(a) * sp, {
        life: rr(0.8, 1.6), size0: 0.5, size1: rr(1.6, 3), c0: 0xffffff, c1: 0xcfd6dc, alpha: 0.6, drag: 1.4, hold: 0.3,
      });
    }
  }

  /** Estouro do rojão: bola de fogos colorida, chuva de confete e fumaça de pólvora (sem clarão branco na tela). */
  private fireworks(p: THREE.Vector3, radius: number): void {
    const gy = this.host.groundY(p.x, p.y, p.z);
    this.flashAt(_a.set(p.x, p.y + 0.2, p.z), 0xffd890, 3.2);
    this.ring(p, 0x28ffa8, radius, 0.5);
    // bola de fogos: faíscas em todas as direções, cada uma de uma cor, caindo devagar
    for (let i = 0; i < 80; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.28, r = Math.sqrt(1 - u * u), sp = rr(5, 11) * (0.55 + radius / 12);
      const c = pick(FESTA);
      this.additive.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * r * sp, u * sp + 2, Math.sin(a) * r * sp, {
        life: rr(0.7, 1.4), size0: rr(0.2, 0.34), size1: 0.03, c0: c, c1: c, alpha: 1, gravity: 5, drag: 1.4,
      });
    }
    // brilho de prata caindo (efeito de "chuva de prata")
    for (let i = 0; i < 28; i++) {
      this.additive.spawn(p.x + rnd(1.2), p.y + rr(0.5, 2.2), p.z + rnd(1.2), rnd(1.5), rr(0.5, 3), rnd(1.5), {
        life: rr(1, 1.8), size0: 0.12, size1: 0.02, c0: 0xfff0b0, c1: 0xffa030, alpha: 1, gravity: 2.5, drag: 1,
      });
    }
    // confete e papelão do tubo
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * 6.28, sp = rr(2, 9);
      this.chunks.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * sp, rr(3, 11), Math.sin(a) * sp, pick(FESTA_BITS), {
        life: rr(1.8, 3), sx: 0.07, sy: 0.012, sz: 0.1, gravity: 9, floor: gy + 0.02, flutter: true, spin: 10, shrink: 0.3,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28, sp = rr(2, 8);
      this.chunks.spawn(p.x, p.y + 0.2, p.z, Math.cos(a) * sp, rr(4, 10), Math.sin(a) * sp, i % 2 ? 0xd8342c : 0xc9a46c, {
        life: rr(1.2, 2.2), sx: 0.06, sy: 0.04, sz: 0.1, gravity: 18, floor: gy + 0.03, spin: 14, shrink: 0.3,
      });
    }
    // fumaça de pólvora
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * 6.28, sp = rr(0, 4);
      this.soft.spawn(p.x, p.y + 0.3, p.z, Math.cos(a) * sp, rr(0.6, 3), Math.sin(a) * sp, {
        life: rr(0.8, 1.6), size0: 0.5, size1: rr(1.6, 2.6), c0: 0x8a8a8a, c1: 0x3a3a3a, alpha: 0.45, drag: 1.4, hold: 0.3,
      });
    }
  }

  // ---------------------------------------------------------------- beams

  private beamOff(key: string): void {
    const b = this.beams.get(key);
    if (!b) return;
    b.ttl = 0;
    b.core?.hide(); b.glow?.hide(); b.arc?.hide(); b.arcGlow?.hide();
  }

  private dropKite(id: string): void {
    const k = this.kites.get(id);
    if (!k) return;
    this.scene.remove(k.model);
    this.scene.remove(k.line.mesh);
    this.kites.delete(id);
  }

  private updateKites(dt: number): void {
    const cam = this.camera.position;
    for (const [id, k] of this.kites) {
      k.ttl -= dt;
      if (k.ttl <= 0) { this.dropKite(id); continue; }
      const f = k.fresh ? 1 : 1 - Math.exp(-18 * dt);
      k.fresh = false;
      k.shownOrigin.lerp(k.origin, f);
      k.shownKite.lerp(k.kite, f);
      const m = k.model;
      m.position.copy(k.shownKite);
      m.lookAt(k.shownOrigin);
      m.rotateX(-0.45);
      m.rotateZ(Math.sin(this.time * 3 + k.kite.x) * 0.25);
      const tail = m.userData.tail as THREE.Object3D | undefined;
      if (tail) tail.rotation.x = Math.sin(this.time * 4) * 0.25;
      const pts = this.kitePts;
      for (let i = 0; i < 6; i++) {
        const p = pts[i] ?? (pts[i] = new V());
        p.lerpVectors(k.shownOrigin, k.shownKite, i / 5);
      }
      // cerol: a linha cintila (vidro moído); cortando, pisca vermelho e solta faísca
      const glint = Math.random() < 0.25;
      k.line.set(pts, k.hit ? 0.045 + Math.random() * 0.03 : glint ? 0.032 : 0.022, cam);
      (k.line.mesh.material as THREE.MeshBasicMaterial).color.setHex(k.hit ? (Math.random() < 0.5 ? 0xff3030 : 0xffffff) : glint ? 0xffffff : 0xffe8b8);
      if (Math.random() < dt * 14) {
        const t = Math.random();
        this.additive.spawn(
          k.shownOrigin.x + (k.shownKite.x - k.shownOrigin.x) * t, k.shownOrigin.y + (k.shownKite.y - k.shownOrigin.y) * t, k.shownOrigin.z + (k.shownKite.z - k.shownOrigin.z) * t,
          0, 0, 0, { life: 0.12, size0: 0.12, size1: 0.02, c0: 0xffffff, c1: 0xb8e8ff, alpha: 1 },
        );
      }
      if (k.hit && Math.random() < 0.5) {
        const t = Math.random();
        this.additive.spawn(
          k.shownOrigin.x + (k.shownKite.x - k.shownOrigin.x) * t, k.shownOrigin.y + (k.shownKite.y - k.shownOrigin.y) * t, k.shownOrigin.z + (k.shownKite.z - k.shownOrigin.z) * t,
          rnd(3), rnd(3), rnd(3), { life: 0.25, size0: 0.2, size1: 0.02, c0: 0xffffff, c1: 0xff3030, alpha: 1, gravity: 6 },
        );
        if (Math.random() < 0.3) this.flashAt(k.shownKite, 0xff8080, 0.5);
      }
    }
  }

  private dropBeam(key: string): void {
    const b = this.beams.get(key);
    if (!b) return;
    for (const r of [b.core, b.glow, b.arc, b.arcGlow]) if (r) this.scene.remove(r.mesh);
    this.beams.delete(key);
  }

  private zig(a: THREE.Vector3, b: THREE.Vector3, n: number, amp: number, out: THREE.Vector3[]): void {
    _c.subVectors(b, a);
    const len = _c.length() || 1;
    _c.divideScalar(len);
    _u.crossVectors(_c, UP);
    if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0);
    _u.normalize();
    _w.crossVectors(_c, _u).normalize();
    const A = amp * (0.15 + Math.min(len, 30) * 0.02);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const p = out[i] ?? (out[i] = new V());
      p.lerpVectors(a, b, t);
      if (i > 0 && i < n - 1) {
        const k = A * (0.4 + 0.6 * Math.sin(Math.PI * t));
        p.addScaledVector(_u, rnd(k)).addScaledVector(_w, rnd(k));
      }
    }
  }

  private pts: THREE.Vector3[] = [];
  private pts2: THREE.Vector3[] = [];

  private updateBeam(key: string, b: Beam, dt: number): void {
    const cam = this.camera.position;
    switch (b.kind) {
      case 'lorenzetti': {
        this.zig(b.origin, b.end, 16, 1, this.pts);
        const fl = 0.7 + Math.random() * 0.6;
        b.glow!.set(this.pts, 0.22 * fl, cam);
        b.core!.set(this.pts, 0.05 + Math.random() * 0.04, cam);
        // galhinhos: faíscas que escapam dos "joelhos" do raio
        if (Math.random() < 0.6) {
          const k = this.pts[2 + ((Math.random() * 12) | 0)];
          this.additive.spawn(k.x, k.y, k.z, rnd(2), rnd(2), rnd(2), { life: 0.08, size0: 0.25, size1: 0.05, c0: 0xeaf6ff, c1: 0x4aa8ff, alpha: 0.9 });
        }
        if (b.end2) {
          this.zig(b.end, b.end2, 12, 0.8, this.pts2);
          b.arcGlow!.set(this.pts2, 0.15, cam);
          b.arc!.set(this.pts2, 0.045, cam);
          this.sparkBurst(b.end2, 2);
        } else { b.arc!.hide(); b.arcGlow!.hide(); }
        // faíscas no fim e flash no começo
        this.sparkBurst(b.end, b.hit ? 4 : 2);
        const fs = b.local ? 0.22 : 0.5;
        this.additive.spawn(b.origin.x, b.origin.y, b.origin.z, 0, 0, 0, { life: 0.08, size0: fs + Math.random() * fs * 0.6, size1: fs * 0.4, c0: 0xcfeaff, alpha: 0.9, hold: 0.5 });
        if (b.hit) this.additive.spawn(b.end.x, b.end.y, b.end.z, 0, 0, 0, { life: 0.08, size0: 0.9 + Math.random() * 0.5, size1: 0.4, c0: 0xdff2ff, alpha: 0.8, hold: 0.5 });
        break;
      }
      case 'rexona': {
        this.flameAcc += dt * 170;
        const n = Math.floor(this.flameAcc);
        this.flameAcc -= n;
        for (let i = 0; i < n; i++) {
          const sp = rr(12, 16);
          _a.set(rnd(1), rnd(1), rnd(1)).multiplyScalar(0.17 * sp);
          this.additive.spawn(b.origin.x, b.origin.y, b.origin.z, b.dir.x * sp + _a.x, b.dir.y * sp + _a.y + 0.6, b.dir.z * sp + _a.z, {
            life: rr(0.32, 0.5), size0: rr(0.15, 0.25), size1: rr(0.8, 1.1), c0: 0xfff0a0, c1: 0xff3810, alpha: 0.9, drag: 1.4, hold: 0.15, spin: 3,
          });
          if (Math.random() < 0.18) {
            this.soft.spawn(b.origin.x + b.dir.x * 1.5, b.origin.y + b.dir.y * 1.5, b.origin.z + b.dir.z * 1.5, b.dir.x * 5 + rnd(1), b.dir.y * 5 + rr(0.5, 2), b.dir.z * 5 + rnd(1), {
              life: rr(0.6, 1.0), size0: 0.3, size1: 1.2, c0: 0x2a2220, c1: 0x6a625c, alpha: 0.35, drag: 1.2,
            });
          }
        }
        if (b.hit) this.additive.spawn(b.end.x + rnd(0.4), b.end.y + rnd(0.3), b.end.z + rnd(0.4), 0, 1.5, 0, { life: 0.3, size0: 0.4, size1: 0.9, c0: 0xffb040, c1: 0xff2008, alpha: 0.8 });
        // brasinhas subindo
        if (Math.random() < dt * 25) {
          const d = rr(1, 6);
          this.additive.spawn(b.origin.x + b.dir.x * d, b.origin.y + b.dir.y * d, b.origin.z + b.dir.z * d, rnd(0.8), rr(1.5, 3), rnd(0.8), {
            life: rr(0.6, 1.1), size0: 0.07, size1: 0.02, c0: 0xffe080, c1: 0xff4010, alpha: 1, gravity: -1, drag: 1,
          });
        }
        break;
      }
      case 'ventilador': {
        this.flameAcc += dt * 80;
        const n = Math.floor(this.flameAcc);
        this.flameAcc -= n;
        for (let i = 0; i < n; i++) {
          const sp = rr(17, 25);
          _a.set(rnd(1), rnd(1), rnd(1)).multiplyScalar(0.3 * sp);
          this.soft.spawn(b.origin.x, b.origin.y, b.origin.z, b.dir.x * sp + _a.x, b.dir.y * sp + _a.y, b.dir.z * sp + _a.z, {
            life: rr(0.4, 0.6), size0: 0.1, size1: rr(0.35, 0.6), c0: 0xcdeeff, c1: 0xffffff, alpha: 0.4, hold: 0.2,
          });
        }
        if (Math.random() < dt * 14) {
          const d = rr(1.5, 9);
          const px = b.origin.x + b.dir.x * d + rnd(0.8), pz = b.origin.z + b.dir.z * d + rnd(0.8);
          const gy = this.host.groundY(px, b.origin.y, pz);
          this.chunks.spawn(px, gy + 0.05, pz, b.dir.x * rr(8, 14), rr(1.5, 4), b.dir.z * rr(8, 14), pick(LEAF), {
            life: rr(0.8, 1.4), sx: 0.06, sy: 0.008, sz: 0.05, gravity: 5, floor: gy + 0.02, flutter: true, spin: 14, shrink: 0.3,
          });
        }
        this.ringT -= dt;
        if (this.ringT <= 0) {
          this.ringT = 0.1;
          this.soft.spawn(b.origin.x, b.origin.y, b.origin.z, b.dir.x * 18, b.dir.y * 18, b.dir.z * 18, {
            life: 0.55, size0: 0.3, size1: 3.4, c0: 0xe6f6ff, c1: 0xffffff, alpha: 0.28, hold: 0.1, spin: 0.5,
          });
        }
        // hélice picotando (perto): fagulhas vermelhas na frente do ventilador
        if (b.chop && Math.random() < dt * 60) {
          const d = rr(0.6, 3.2);
          const x = b.origin.x + b.dir.x * d + rnd(0.4), y = b.origin.y + b.dir.y * d + rnd(0.4), z = b.origin.z + b.dir.z * d + rnd(0.4);
          this.additive.spawn(x, y, z, rnd(3), rnd(3), rnd(3), {
            life: rr(0.12, 0.25), size0: rr(0.08, 0.18), size1: 0.02, c0: 0xffe0d0, c1: 0xff2a20, alpha: 1, gravity: 4,
          });
          // picadinho: penas, retalhos de roupa e cubinhos vermelhos voando pros lados
          if (Math.random() < 0.5) {
            const gy = this.host.groundY(x, y, z);
            const r = Math.random();
            if (r < 0.4) this.feather(_a.set(x, y, z), 3);
            else this.chunks.spawn(x, y, z, rnd(4) + b.dir.x * 3, rr(1, 4), rnd(4) + b.dir.z * 3, r < 0.75 ? pick(RED_BITS) : pick(CLOTH), {
              life: rr(0.6, 1.2), sx: rr(0.03, 0.07), sy: rr(0.03, 0.06), sz: rr(0.03, 0.07), gravity: 14, floor: gy + 0.02, spin: 16, shrink: 0.3,
            });
          }
        }
        break;
      }
      case 'cafe': {
        this.flameAcc += dt * 140;
        const n = Math.floor(this.flameAcc);
        this.flameAcc -= n;
        for (let i = 0; i < n; i++) {
          const sp = rr(12, 16);
          _a.set(rnd(1), rnd(1), rnd(1)).multiplyScalar(0.14 * sp);
          this.soft.spawn(b.origin.x, b.origin.y, b.origin.z, b.dir.x * sp + _a.x, b.dir.y * sp + _a.y + 0.6, b.dir.z * sp + _a.z, {
            life: rr(0.3, 0.5), size0: rr(0.08, 0.14), size1: rr(0.3, 0.5), c0: 0x7a4a1a, c1: 0xb88850, alpha: 0.8, drag: 1.2, gravity: 5,
          });
          if (Math.random() < 0.25) {
            this.soft.spawn(b.origin.x + b.dir.x * rr(0.5, 4), b.origin.y + b.dir.y * rr(0.5, 4), b.origin.z + b.dir.z * rr(0.5, 4), rnd(0.5), rr(0.8, 2), rnd(0.5), {
              life: rr(0.5, 0.9), size0: 0.2, size1: 0.9, c0: 0xffffff, c1: 0xdddddd, alpha: 0.3, drag: 1.2,
            });
          }
        }
        if (b.hit) this.additive.spawn(b.end.x + rnd(0.3), b.end.y + rnd(0.3), b.end.z + rnd(0.3), 0, 1.2, 0, { life: 0.3, size0: 0.3, size1: 0.7, c0: 0xffc880, c1: 0x884400, alpha: 0.7 });
        // gotas de café caindo em arco e vapor no ponto de impacto
        if (Math.random() < dt * 40) {
          const sp = rr(9, 13);
          const gy = this.host.groundY(b.origin.x, b.origin.y, b.origin.z);
          this.chunks.spawn(b.origin.x, b.origin.y, b.origin.z, b.dir.x * sp + rnd(0.8), b.dir.y * sp + rr(0.5, 2), b.dir.z * sp + rnd(0.8), pick(COFFEE), {
            life: rr(0.6, 1.1), sx: 0.04, sy: 0.04, sz: 0.06, gravity: 14, floor: gy + 0.02, spin: 4, shrink: 0.5,
          });
        }
        if (Math.random() < dt * 20) {
          this.soft.spawn(b.end.x + rnd(0.3), b.end.y, b.end.z + rnd(0.3), rnd(0.4), rr(0.8, 1.8), rnd(0.4), {
            life: rr(0.6, 1.1), size0: 0.3, size1: 1.1, c0: 0xffffff, c1: 0xd8d8d8, alpha: 0.35, drag: 1,
          });
        }
        break;
      }
    }
    void key;
  }

  private sparkBurst(p: THREE.Vector3, n: number): void {
    for (let i = 0; i < n; i++) {
      this.additive.spawn(p.x, p.y, p.z, rnd(3.5), rnd(3.5) + 1, rnd(3.5), {
        life: rr(0.1, 0.25), size0: rr(0.07, 0.16), size1: 0.02, c0: 0xffffff, c1: 0x5ab4ff, alpha: 1, gravity: 6,
      });
    }
  }

  // ---------------------------------------------------------------- update

  update(dt: number, ctx: { time: number; holding: boolean; speed: number; grounded: boolean }): void {
    this.time += dt;
    const q = this.camera.quaternion;

    for (const [key, b] of this.beams) {
      if (b.ttl > 0) {
        b.ttl -= dt;
        if (b.ttl <= 0) this.beamOff(key);
        else this.updateBeam(key, b, dt);
      }
    }

    this.updateKites(dt);
    this.updateColumns(dt);
    this.updateStamps(dt);
    this.updateActors(dt);
    this.updateHeld(dt, ctx);

    this.additive.update(dt, q);
    this.soft.update(dt, q);
    this.chunks.update(dt, this.time);

    const l = this.host.local();
    this.overlay.update(dt, {
      blind: this.host.localBlind(),
      steam: this.host.localSteam(),
      burning: !!l && this.host.statusLeft(l.id, 'burn') > 0,
      stunned: !!l && this.host.statusLeft(l.id, 'stun') > 0,
      shocked: !!l && this.host.statusLeft(l.id, 'shock') > 0,
    });
  }

  private updateColumns(dt: number): void {
    for (let i = this.columns.length - 1; i >= 0; i--) {
      const c = this.columns[i];
      c.t += dt;
      const m = c.mesh;
      const mat = m.material as THREE.MeshBasicMaterial;
      if (c.kind === 'ring') {
        const life = m.userData.life as number;
        const k = c.t / life;
        m.scale.setScalar(0.3 + (m.userData.r as number) * Math.min(1, k * 1.4));
        mat.opacity = 0.7 * (1 - k);
        if (k >= 1) { this.scene.remove(m); mat.dispose(); this.columns.splice(i, 1); }
      } else {
        // coluna de gêiser: sobe rápido e desaba
        const up = Math.min(1, c.t / 0.22);
        const H = (m.userData.maxH as number) * (1 - Math.max(0, (c.t - 0.55) / 0.5) * 0.9);
        const r = (m.userData.r as number) * (1 + c.t * 0.6);
        m.scale.set(r, Math.max(0.01, H * up), r);
        mat.opacity = 0.6 * Math.max(0, 1 - Math.max(0, c.t - 0.45) / 0.6);
        m.rotation.y += dt * 4;
        // a malha tem altura 1 centrada: sobe metade da altura
        m.position.y = (m.userData.gy as number) + (H * up) / 2;
        if (c.t > 1.1) { this.scene.remove(m); mat.dispose(); this.columns.splice(i, 1); }
      }
    }
  }

  /** Status e arma em 3ª pessoa nos bonecos. */
  private updateActors(dt: number): void {
    for (const a of this.host.actors()) {
      const model = a.model;
      const burn = this.host.statusLeft(a.id, 'burn');
      const shock = this.host.statusLeft(a.id, 'shock');
      const stun = this.host.statusLeft(a.id, 'stun');

      if (a.alive && !a.isLocal) {
        const h = a.height;
        if (burn > 0) {
          const n = Math.random() < dt * 60 ? 1 : 0;
          for (let i = 0; i < n + 1; i++) {
            this.additive.spawn(a.pos.x + rnd(0.25), a.pos.y + Math.random() * h, a.pos.z + rnd(0.25), rnd(0.4), rr(1.2, 2.4), rnd(0.4), {
              life: rr(0.35, 0.6), size0: rr(0.3, 0.45), size1: 0.06, c0: 0xffd060, c1: 0xff3010, alpha: 0.9,
            });
          }
        }
        if (shock > 0) {
          this.sparkBurst(_a.set(a.pos.x + rnd(0.3), a.pos.y + Math.random() * h, a.pos.z + rnd(0.3)), 2);
          if (model) {
            model.root.position.x += rnd(0.06);
            model.root.position.z += rnd(0.06);
            model.root.position.y += Math.random() * 0.04;
          }
        }
        // arma maluca na mão em 3ª pessoa: CharacterModel (pose.special)
      } else {
        const th = this.thirdHeld.get(a.id);
        if (th) { th.obj.removeFromParent(); this.thirdHeld.delete(a.id); }
      }

      // estrelinhas do atordoado
      if (a.alive && !a.isLocal && stun > 0) {
        let s = this.stars.get(a.id);
        if (!s) {
          s = { sprites: [] };
          for (let i = 0; i < 4; i++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), transparent: true, depthWrite: false, fog: false }));
            sp.scale.setScalar(0.28);
            this.scene.add(sp);
            s.sprites.push(sp);
          }
          this.stars.set(a.id, s);
        }
        s.sprites.forEach((sp, i) => {
          const ang = this.time * 5 + (i / s!.sprites.length) * Math.PI * 2;
          sp.visible = true;
          sp.position.set(a.pos.x + Math.cos(ang) * 0.34, a.pos.y + a.height + 0.22 + Math.sin(ang * 2) * 0.04, a.pos.z + Math.sin(ang) * 0.34);
        });
      } else {
        const s = this.stars.get(a.id);
        if (s) for (const sp of s.sprites) sp.visible = false;
      }
    }
  }

  private updateHeld(dt: number, ctx: { holding: boolean; speed: number; grounded: boolean }): void {
    this.heldRoot.visible = false;
    if (!this.heldObj) return;
    this.heldKick *= Math.exp(-dt * 12);
    this.bob += dt * Math.min(ctx.speed, 9) * 1.5;
    const mv = ctx.grounded ? Math.min(1, ctx.speed / 6) : 0;
    const bx = Math.sin(this.bob) * 0.012 * mv;
    const by = (Math.cos(this.bob * 2) - 1) * 0.005 * mv + Math.sin(this.time * 1.6) * 0.0016;
    this.heldRoot.position.set(0.17 + bx, -0.17 + by + this.heldPull * 0.01, -0.5 + this.heldKick * 0.07 + this.heldPull * 0.14);
    this.heldRoot.rotation.set(this.heldKick * 0.18 - this.heldPull * 0.05, -0.08, 0);
    if (this.heldPull > 0.01) {
      this.heldRoot.position.x += rnd(0.002) * this.heldPull;
      this.heldRoot.position.y += rnd(0.002) * this.heldPull;
    }
  }
}
