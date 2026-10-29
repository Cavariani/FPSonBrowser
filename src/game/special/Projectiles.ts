import * as THREE from 'three';
import { bus } from '../../core/events';
import type { Actor } from '../Actor';
import type { World } from '../World';
import { SPECIALS, type ProjKind } from './defs';
import { END_NAME, type EndReason, type SpecialMsg } from './msgs';

const V = THREE.Vector3;
const _a = new V(), _b = new V(), _c = new V(), _step = new V(), _dir = new V();

interface PhysDef {
  /** Raio de colisão. */
  r: number;
  g: number;
  /** Restituição no quique. */
  e: number;
  /** Quantos quiques antes de parar (pedra: 1). */
  maxBounce: number;
  life: number;
  /** Rotação "caindo de pau" (rad/s). */
  tumble: number;
}

const PH: Record<ProjKind, PhysDef> = {
  stone: { r: 0.09, g: SPECIALS.estilingue.p.g, e: SPECIALS.estilingue.p.e, maxBounce: 1, life: 5, tumble: 6 },
  bottle: { r: 0.16, g: SPECIALS.dolly.p.g, e: SPECIALS.dolly.p.e, maxBounce: 99, life: SPECIALS.dolly.p.fuse + 1.2, tumble: 9 },
  brick: { r: 0.15, g: SPECIALS.tijolo.p.g, e: SPECIALS.tijolo.p.e, maxBounce: 2, life: 6, tumble: 7 },
  panela: { r: 0.2, g: SPECIALS.panela.p.g, e: SPECIALS.panela.p.e, maxBounce: 99, life: SPECIALS.panela.p.fuse + 1.2, tumble: 5 },
  coxinha: { r: 0.07, g: SPECIALS.coxinha.p.g, e: 0, maxBounce: 0, life: SPECIALS.coxinha.p.life, tumble: 0 },
  pombo: { r: 0.3, g: 0, e: 0, maxBounce: 0, life: SPECIALS.pombo.p.life, tumble: 0 },
  chinelo: { r: SPECIALS.chinelo.p.radius, g: 0, e: 0, maxBounce: 0, life: 7, tumble: 0 },
};

const FUSE: Partial<Record<ProjKind, number>> = { bottle: SPECIALS.dolly.p.fuse, panela: SPECIALS.panela.p.fuse };
/** Projéteis balísticos que acertam actors (os outros têm lógica própria). */
const HITS_ACTORS: Partial<Record<ProjKind, boolean>> = { stone: true, brick: true, bottle: true, coxinha: true };
const MAX_RESTS = 48;

export interface Proj {
  /** `${dono}#${n}` */
  key: string;
  n: number;
  owner: string;
  kind: ProjKind;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  /** Esta máquina simula o dano deste projétil. */
  auth: boolean;
  bounces: number;
  model: THREE.Object3D;
  ended: boolean;
  charge: number;
  /** Distância percorrida (coxinha: queda do dano). */
  travel: number;
  fuse: number;
  hissT: number;
  // pombo
  target: string | null;
  acqT: number;
  // chinelo
  phase: 0 | 1;
  hitSet: Set<string>;
  backT: number;
  // remoto teleguiado
  rpos: THREE.Vector3 | null;
  rvel: THREE.Vector3;
  netT: number;
}

interface Rest {
  model: THREE.Object3D;
  t: number;
}

export interface ProjHost {
  world: World;
  actors(): Iterable<Actor>;
  getActor(id: string): Actor | undefined;
  /** (só auth) acertou `victim`. Retorna true para terminar o projétil. */
  hit(p: Proj, victim: Actor, head: boolean, point: THREE.Vector3): boolean;
  /** O projétil terminou (auth: decidimos; remoto: veio mensagem `pe`). */
  ended(p: Proj, why: EndReason): void;
}

/** 0 = nada, 1 = corpo, 2 = cabeça. Esfera de raio r contra o corpo do actor. */
export function contact(a: Actor, pt: THREE.Vector3, r: number): 0 | 1 | 2 {
  const h = a.height;
  const dx = pt.x - a.pos.x, dz = pt.z - a.pos.z;
  const hy = a.pos.y + h - 0.17;
  const hr = 0.21 + r;
  if (dx * dx + (pt.y - hy) * (pt.y - hy) + dz * dz <= hr * hr) return 2;
  const br = 0.32 + r * 0.8;
  if (dx * dx + dz * dz <= br * br && pt.y >= a.pos.y - r * 0.5 && pt.y <= a.pos.y + h - 0.3 + r * 0.5) return 1;
  return 0;
}

export const chestOf = (a: Actor, out: THREE.Vector3): THREE.Vector3 => out.set(a.pos.x, a.pos.y + a.height * 0.58, a.pos.z);

/** Gira `vel` (preservando |vel|) em direção a `desired` por no máximo `maxAng` rad. */
export function steer(vel: THREE.Vector3, desired: THREE.Vector3, maxAng: number): void {
  const sp = vel.length();
  if (sp < 1e-6 || desired.lengthSq() < 1e-10) return;
  const cur = _a.copy(vel).divideScalar(sp);
  const d = _b.copy(desired).normalize();
  const ang = Math.acos(Math.max(-1, Math.min(1, cur.dot(d))));
  if (ang < 1e-4) return;
  if (ang > Math.PI - 0.05) d.set(-cur.z, 0, cur.x).normalize(); // oposto exato: escolhe um lado
  const t = Math.min(1, maxAng / ang);
  cur.lerp(d, t);
  if (cur.lengthSq() < 1e-8) return;
  vel.copy(cur.normalize()).multiplyScalar(sp);
}

/**
 * Simulação dos projéteis das armas malucas.
 * `auth`: quem atirou simula o dano (igual ao hitscan). Nos outros clientes é só visual:
 * balísticos rodam a mesma física (determinística) e os teleguiados (pombo/chinelo) seguem as posições recebidas.
 */
export class ProjectileSim {
  readonly list: Proj[] = [];
  private byKey = new Map<string, Proj>();
  private rests: Rest[] = [];
  private counters = new Map<string, number>();
  private time = 0;

  constructor(private host: ProjHost, private scene: THREE.Scene, private build: (k: ProjKind) => THREE.Object3D) {}

  nextN(owner: string, count = 1): number {
    const n = this.counters.get(owner) ?? 1;
    this.counters.set(owner, n + count);
    return n;
  }

  spawn(owner: string, kind: ProjKind, pos: THREE.Vector3, vel: THREE.Vector3, auth: boolean, o: { n?: number; charge?: number } = {}): Proj {
    const n = o.n ?? this.nextN(owner);
    const model = this.build(kind);
    model.position.copy(pos);
    this.scene.add(model);
    const p: Proj = {
      key: `${owner}#${n}`, n, owner, kind, pos: pos.clone(), prev: pos.clone(), vel: vel.clone(),
      age: 0, life: PH[kind].life, auth, bounces: 0, model, ended: false, charge: o.charge ?? 1, travel: 0,
      fuse: FUSE[kind] ?? 0, hissT: 0.25, target: null, acqT: 0, phase: 0, hitSet: new Set(), backT: 0,
      rpos: null, rvel: new V(), netT: 0,
    };
    if (kind === 'bottle' || kind === 'stone' || kind === 'brick' || kind === 'panela') {
      model.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
    this.list.push(p);
    this.byKey.set(p.key, p);
    return p;
  }

  /** Mensagem `ps` de outra máquina: cria os projéteis só para desenhar. */
  spawnRemote(m: Extract<SpecialMsg, { t: 'ps' }>): void {
    const pos = new V(m.o[0], m.o[1], m.o[2]);
    for (let i = 0; i + 2 < m.v.length; i += 3) {
      this.spawn(m.a, m.kd, pos, new V(m.v[i], m.v[i + 1], m.v[i + 2]), false, { n: m.n + i / 3, charge: m.c });
    }
  }

  applyUpdate(m: Extract<SpecialMsg, { t: 'pu' }>): void {
    for (let i = 0; i + 6 < m.u.length; i += 7) {
      const p = this.byKey.get(`${m.a}#${m.u[i]}`);
      if (!p || p.auth) continue;
      (p.rpos ??= new V()).set(m.u[i + 1], m.u[i + 2], m.u[i + 3]);
      p.rvel.set(m.u[i + 4], m.u[i + 5], m.u[i + 6]);
    }
  }

  applyEnd(m: Extract<SpecialMsg, { t: 'pe' }>): void {
    const p = this.byKey.get(`${m.a}#${m.n}`);
    if (!p || p.auth) return;
    p.pos.set(m.p[0], m.p[1], m.p[2]);
    this.end(p, END_NAME[m.w] ?? 'expire');
  }

  removeOwner(id: string): void {
    for (const p of this.list) {
      if (p.owner !== id || p.ended) continue;
      p.ended = true;
      this.scene.remove(p.model);
      this.byKey.delete(p.key);
    }
    this.counters.delete(id);
  }

  clear(): void {
    for (const p of this.list) this.scene.remove(p.model);
    this.list.length = 0;
    this.byKey.clear();
    for (const r of this.rests) this.scene.remove(r.model);
    this.rests.length = 0;
  }

  /** Projéteis teleguiados do dono `id` simulados aqui (para mandar `pu`). */
  guidedOf(): Proj[] {
    return this.list.filter((p) => p.auth && !p.ended && (p.kind === 'pombo' || p.kind === 'chinelo'));
  }

  end(p: Proj, why: EndReason): void {
    if (p.ended) return;
    p.ended = true;
    this.byKey.delete(p.key);
    this.scene.remove(p.model);
    this.host.ended(p, why);
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number): void {
    this.time += dt;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.ended) { this.list.splice(i, 1); continue; }
      p.prev.copy(p.pos);
      p.age += dt;
      switch (p.kind) {
        case 'pombo': this.stepPombo(p, dt); break;
        case 'chinelo': this.stepChinelo(p, dt); break;
        default: this.stepBallistic(p, dt);
      }
      p.travel += p.pos.distanceTo(p.prev);
      if (!p.ended && p.age > p.life) this.end(p, 'expire');
      if (!p.ended && (p.pos.y < -30 || Math.abs(p.pos.x) > 150 || Math.abs(p.pos.z) > 150)) this.end(p, 'expire');
    }
    for (let i = this.rests.length - 1; i >= 0; i--) {
      const r = this.rests[i];
      r.t -= dt;
      if (r.t < 0.6) r.model.scale.setScalar(Math.max(0.01, r.t / 0.6));
      if (r.t <= 0) { this.scene.remove(r.model); this.rests.splice(i, 1); }
    }
  }

  /** Posição suave entre ticks + orientação. */
  render(alpha: number, dt: number): void {
    const rdt = Math.min(0.05, dt);
    for (const p of this.list) {
      if (p.ended) continue;
      const m = p.model;
      m.position.lerpVectors(p.prev, p.pos, alpha);
      switch (p.kind) {
        case 'coxinha':
        case 'pombo':
          if (p.vel.lengthSq() > 0.01) m.lookAt(_a.copy(m.position).add(p.vel));
          break;
        case 'chinelo':
          m.rotation.set(0, p.age * 22, 0);
          break;
        default:
          m.rotation.x += PH[p.kind].tumble * rdt;
          m.rotation.z += PH[p.kind].tumble * rdt * 0.7;
      }
      if (p.fuse > 0 && (p.kind === 'bottle' || p.kind === 'panela')) {
        const prog = 1 - p.fuse / (FUSE[p.kind] ?? 1);
        const amp = 0.02 + prog * 0.06;
        m.position.x += (Math.random() - 0.5) * amp;
        m.position.z += (Math.random() - 0.5) * amp;
        const s = 1 + Math.sin(this.time * (18 + prog * 30)) * 0.05 * (0.3 + prog);
        m.scale.setScalar(s);
      }
      (m.userData.anim as ((t: number) => void) | undefined)?.(this.time + p.n);
    }
  }

  // ---------------------------------------------------------------- física

  private sweep(p: Proj, from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number): { actor: Actor; head: boolean; point: THREE.Vector3; t: number } | null {
    let best: { actor: Actor; head: boolean; point: THREE.Vector3; t: number } | null = null;
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (const a of this.host.actors()) {
      if (a.id === p.owner || !a.alive) continue;
      if (p.kind === 'chinelo' && p.hitSet.has(a.id)) continue;
      for (let i = 0; i <= steps; i++) {
        const t = (len * i) / steps;
        _c.copy(from).addScaledVector(dir, t);
        const c = contact(a, _c, r);
        if (c) {
          if (!best || t < best.t) best = { actor: a, head: c === 2, point: _c.clone(), t };
          break;
        }
      }
    }
    return best;
  }

  private stepBallistic(p: Proj, dt: number): void {
    const d = PH[p.kind];
    const world = this.host.world;
    p.vel.y -= d.g * dt;

    if (p.kind === 'bottle' || p.kind === 'panela') {
      p.fuse -= dt;
      p.hissT -= dt;
      const total = FUSE[p.kind]!;
      const prog = Math.max(0, Math.min(1, 1 - p.fuse / total));
      if (p.hissT <= 0 && p.fuse > 0) {
        p.hissT = 0.3 - prog * 0.22;
        bus.emit('special:hiss', { kind: p.kind, pos: p.pos.clone(), progress: prog });
      }
      if (p.fuse <= 0) {
        if (p.auth) { this.end(p, 'explode'); return; }
        p.fuse = 0; // remoto: espera a mensagem `pe` (explode no mesmo ponto que o dono)
      }
    }

    const n = Math.max(1, Math.ceil((p.vel.length() * dt) / 0.45));
    const h = dt / n;
    for (let s = 0; s < n && !p.ended; s++) {
      _step.copy(p.vel).multiplyScalar(h);
      const len = _step.length();
      if (len < 1e-7) break;
      _dir.copy(_step).divideScalar(len);
      const wh = world.raycast(p.pos, _dir, len + d.r);

      if (p.auth && HITS_ACTORS[p.kind]) {
        const hit = this.sweep(p, p.pos, _dir, len, d.r);
        if (hit && (!wh || wh.dist - d.r > hit.t - 0.05)) {
          p.pos.copy(hit.point);
          if (this.host.hit(p, hit.actor, hit.head, hit.point)) { this.end(p, 'hit'); return; }
        }
      }

      if (!wh) { p.pos.add(_step); continue; }

      // colisão com o mundo
      const nrm = wh.normal;
      p.pos.addScaledVector(_dir, Math.max(0, wh.dist - d.r)).addScaledVector(nrm, 0.003);
      const vn = p.vel.dot(nrm);
      if (p.kind === 'coxinha') { this.stick(p, wh.point, nrm, wh.material); return; }
      if (vn >= 0) { p.pos.add(_step); continue; }
      const speed = -vn;
      const resting = speed < 2.2 && nrm.y > 0.7;

      if (!resting && (p.kind === 'stone' || p.kind === 'brick')) {
        if (p.bounces >= d.maxBounce) {
          bus.emit('weapon:impact', { point: wh.point.clone(), normal: nrm.clone(), surface: 'world', material: wh.material });
          this.end(p, 'world');
          return;
        }
      }
      if (resting && (p.kind === 'stone' || p.kind === 'brick')) { this.end(p, 'world'); return; }

      if (resting) {
        p.vel.addScaledVector(nrm, -vn); // para de afundar
        const k = Math.exp(-1.8 * h);
        p.vel.x *= k; p.vel.z *= k; // rola e vai parando
      } else {
        p.vel.addScaledVector(nrm, -(1 + d.e) * vn);
        // atrito tangencial no quique
        const vn2 = p.vel.dot(nrm);
        _a.copy(nrm).multiplyScalar(vn2);
        _b.subVectors(p.vel, _a).multiplyScalar(0.86);
        p.vel.copy(_a).add(_b);
        p.bounces++;
        if (speed > 1.5) {
          bus.emit('special:bounce', { kind: p.kind, pos: p.pos.clone(), speed });
          if (p.kind === 'stone' || p.kind === 'brick') {
            bus.emit('weapon:impact', { point: wh.point.clone(), normal: nrm.clone(), surface: 'world', material: wh.material });
          }
        }
        // vira o modelo ao quicar
        p.model.rotation.x += Math.random() * 2;
        p.model.rotation.z += Math.random() * 2;
      }
    }
  }

  /** Coxinha chegou no chão/parede: fica lá um tempo (visual, com limite). */
  private stick(p: Proj, point: THREE.Vector3, normal: THREE.Vector3, material: string): void {
    p.ended = true;
    this.byKey.delete(p.key);
    const m = p.model;
    m.position.copy(point).addScaledVector(normal, 0.05);
    m.scale.setScalar(1);
    if (normal.y > 0.6) { m.rotation.set(0, Math.atan2(p.vel.x, p.vel.z), 0); } else { m.lookAt(_a.copy(m.position).add(normal)); }
    if (this.rests.length >= MAX_RESTS) {
      const old = this.rests.shift()!;
      this.scene.remove(old.model);
    }
    this.rests.push({ model: m, t: SPECIALS.coxinha.p.rest * (0.85 + Math.random() * 0.3) });
    bus.emit('special:stick', { pos: point.clone(), normal: normal.clone() });
    bus.emit('weapon:impact', { point: point.clone(), normal: normal.clone(), surface: 'world', material });
    this.host.ended(p, 'world');
  }

  /** Remoto teleguiado: segue a última posição/velocidade recebida. */
  private stepGuided(p: Proj, dt: number): void {
    if (p.rpos) {
      p.rpos.addScaledVector(p.rvel, dt);
      p.pos.lerp(p.rpos, 1 - Math.exp(-14 * dt));
      p.vel.copy(p.rvel);
    } else {
      p.pos.addScaledVector(p.vel, dt);
    }
  }

  private stepPombo(p: Proj, dt: number): void {
    if (!p.auth) { this.stepGuided(p, dt); return; }
    const P = SPECIALS.pombo.p;
    const world = this.host.world;

    let tgt = p.target ? this.host.getActor(p.target) : undefined;
    if (tgt && !tgt.alive) { tgt = undefined; p.target = null; }
    p.acqT -= dt;
    if (!tgt && p.acqT <= 0) {
      p.acqT = 0.3;
      tgt = this.acquire(p);
      p.target = tgt ? tgt.id : null;
    }
    if (tgt) {
      chestOf(tgt, _a);
      _b.subVectors(_a, p.pos);
      steer(p.vel, _b, P.turn * dt);
    }
    // desvia de parede/chão pra cima
    _dir.copy(p.vel).normalize();
    const ahead = world.raycast(p.pos, _dir, 2.6);
    if (ahead) {
      _b.copy(_dir).addScaledVector(ahead.normal, 1.1);
      _b.y += 0.6;
      steer(p.vel, _b, P.turn * 1.8 * dt);
    }
    p.vel.setLength(P.speed);

    _dir.copy(p.vel).normalize();
    const len = P.speed * dt;
    const wh = world.raycast(p.pos, _dir, len + 0.2);
    const hit = this.sweep(p, p.pos, _dir, len, 0.3);
    if (hit && (!wh || wh.dist - 0.2 > hit.t - 0.05)) {
      p.pos.copy(hit.point);
      if (this.host.hit(p, hit.actor, hit.head, hit.point)) { this.end(p, 'hit'); return; }
    }
    if (wh) {
      p.pos.addScaledVector(_dir, Math.max(0, wh.dist - 0.2));
      bus.emit('weapon:impact', { point: wh.point.clone(), normal: wh.normal.clone(), surface: 'world', material: wh.material });
      this.end(p, 'world');
      return;
    }
    p.pos.addScaledVector(_dir, len);
  }

  private acquire(p: Proj): Actor | undefined {
    const P = SPECIALS.pombo.p;
    const fwd = _c.copy(p.vel).normalize();
    let best: Actor | undefined, bs = Infinity;
    for (const a of this.host.actors()) {
      if (a.id === p.owner || !a.alive) continue;
      chestOf(a, _a);
      _b.subVectors(_a, p.pos);
      const dist = _b.length();
      if (dist > P.acquire || dist < 0.5) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, fwd.dot(_b.divideScalar(dist)))));
      if (ang > P.acquireCone) continue;
      const vis = this.host.world.visible(p.pos, chestOf(a, _a));
      const score = dist * (1 + ang * 1.2) + (vis ? 0 : 20);
      if (score < bs) { bs = score; best = a; }
    }
    return best;
  }

  private stepChinelo(p: Proj, dt: number): void {
    if (!p.auth) { this.stepGuided(p, dt); return; }
    const P = SPECIALS.chinelo.p;
    const world = this.host.world;

    if (p.phase === 0) {
      if (p.age > P.straight) rotateY(p.vel, P.turnOut * dt);
      const len = p.vel.length() * dt;
      _dir.copy(p.vel).normalize();
      const wh = world.raycast(p.pos, _dir, len + 0.2);
      const hit = this.sweep(p, p.pos, _dir, len, P.radius);
      if (hit && (!wh || wh.dist - 0.2 > hit.t - 0.05)) {
        p.hitSet.add(hit.actor.id);
        this.host.hit(p, hit.actor, hit.head, hit.point);
      }
      if (wh) {
        p.pos.addScaledVector(_dir, Math.max(0, wh.dist - 0.2));
        bus.emit('weapon:impact', { point: wh.point.clone(), normal: wh.normal.clone(), surface: 'world', material: wh.material });
        this.switchBack(p);
      } else {
        p.pos.addScaledVector(_dir, len);
        if (p.age >= P.outTime) this.switchBack(p);
      }
      return;
    }

    // volta pra mão (atravessa o cenário, mas só acerta quem ela enxerga)
    const owner = this.host.getActor(p.owner);
    if (!owner || !owner.alive) { this.end(p, 'caught'); return; }
    owner.eyePos(_a);
    _b.subVectors(_a, p.pos);
    const dist = _b.length();
    if (dist < 1.3) { this.end(p, 'caught'); return; }
    p.backT += dt;
    steer(p.vel, _b, P.backTurn * dt);
    p.vel.setLength(Math.min(P.backSpeed, 14 + p.backT * 45));
    const len = p.vel.length() * dt;
    _dir.copy(p.vel).normalize();
    const hit = this.sweep(p, p.pos, _dir, len, P.radius);
    if (hit && this.host.world.visible(p.pos, chestOf(hit.actor, _a))) {
      p.hitSet.add(hit.actor.id);
      this.host.hit(p, hit.actor, hit.head, hit.point);
    }
    p.pos.addScaledVector(_dir, len);
    if (p.age > 6.5) this.end(p, 'caught');
  }

  private switchBack(p: Proj): void {
    p.phase = 1;
    p.hitSet.clear();
    p.backT = 0;
    bus.emit('special:bounce', { kind: 'chinelo', pos: p.pos.clone(), speed: 8 });
  }
}

function rotateY(v: THREE.Vector3, ang: number): void {
  const c = Math.cos(ang), s = Math.sin(ang);
  const x = v.x * c + v.z * s, z = -v.x * s + v.z * c;
  v.x = x; v.z = z;
}
