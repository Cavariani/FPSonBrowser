import * as THREE from 'three';
import { bus } from '../../core/events';
import { buildPickupModel, buildProjectileModel } from '../../fx/special/models';
import { SpecialFX } from '../../fx/special/SpecialFX';
import type { Actor } from '../Actor';
import type { Game } from '../Game';
import type { DamageRequest, MatchEvent, V3 } from '../Match';
import { aimDir } from '../Weapons';
import { SPECIALS, type BeamKind, type ProjKind, type SpecialId, type StatusKind } from './defs';
import { END_CODE, v3, type EndReason, type SpecialMsg } from './msgs';
import { PickupSystem, PICKUP_RADIUS } from './Pickups';
import { chestOf, ProjectileSim, type Proj, type ProjHost } from './Projectiles';
import { StatusManager } from './Status';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);
const _a = new V(), _b = new V(), _c = new V(), _o = new V(), _d = new V(), _e = new V(), _f = new V();
const _eye = new V(), _aim = new V();

/** Projétil → arma que o dispara (para sons/eventos de quem só recebe a mensagem). */
const PROJ_SPECIAL: Record<ProjKind, SpecialId> = {
  stone: 'estilingue', bottle: 'dolly', brick: 'tijolo', panela: 'panela', coxinha: 'coxinha', pombo: 'pombo', chinelo: 'chinelo',
};
const BEAM_KINDS: SpecialId[] = ['lorenzetti', 'rexona', 'ventilador'];

/** Estado de uso de uma arma maluca (só em quem simula: jogador local e bots no host). */
export interface SState {
  id: SpecialId;
  ammo: number;
  cd: number;
  charge: number;
  charging: boolean;
  beamOn: boolean;
  tickT: number;
  tickN: number;
  confirmAcc: number;
  confirmT: number;
  netT: number;
  /** Chinelo no ar. */
  out: boolean;
  /** >0: acabou a munição, encerra daqui a pouco (deixa a animação do último uso aparecer). */
  endT: number;
}

export interface Trigger {
  held: boolean;
  pressed: boolean;
}

export interface SpecialHud {
  special: { id: SpecialId; name: string; short: string; hint: string; ammo: number; maxAmmo: number; unit: 'sec' | 'shot'; color: number } | null;
  charge: number;
  blind: number;
  burning: boolean;
  stunned: boolean;
  shocked: boolean;
  pickups: { id: number; kind: SpecialId; x: number; z: number }[];
}

/**
 * Armas malucas: pickups, uso (local e bots), projéteis, status e efeitos.
 * O Game só encaminha eventos e chama tick/frame; a regra toda mora aqui.
 */
export class SpecialSystem implements ProjHost {
  readonly status = new StatusManager();
  readonly pickups: PickupSystem;
  readonly proj: ProjectileSim;
  readonly fx: SpecialFX;
  readonly states = new Map<string, SState>();
  private time = 0;
  private pickupReq = new Map<number, number>();
  private puT = 0;
  private botAir = new Map<string, number>();

  constructor(private g: Game) {
    this.pickups = new PickupSystem(g.scene, buildPickupModel);
    this.proj = new ProjectileSim(this, g.scene, buildProjectileModel);
    const down = new V(0, -1, 0), probe = new V();
    this.fx = new SpecialFX(g.scene, g.camera, g.vm.scene, {
      actors: () => g.actors.values(),
      local: () => g.local,
      statusLeft: (id, k) => this.status.left(id, k),
      localBlind: () => (g.local ? this.status.blind(g.local.id) : 0),
      groundY: (x, y, z) => {
        const h = g.world.raycast(probe.set(x, y + 0.4, z), down, 40);
        return h ? h.point.y : Math.max(0, y - 1);
      },
    });

    bus.on('player:land', (e) => {
      const a = g.local;
      if (!a || !a.alive) return;
      this.fallDamage(a, e.impact);
    });
    bus.on('kill', (e) => {
      // morte limpa tudo do morto (o evento de kill chega a todas as máquinas)
      const v = g.actors.get(e.victimId);
      if (v) this.clearActor(v, false);
    });
  }

  // ---------------------------------------------------------------- ProjHost

  get world() {
    return this.g.world;
  }
  actors() {
    return this.g.actors.values();
  }
  getActor(id: string) {
    return this.g.actors.get(id);
  }

  /** Quem simula o uso (e portanto decide o dano) nesta máquina. */
  simulates(a: Actor): boolean {
    return a.isLocal || (a.isBot && this.g.isHost);
  }

  // ---------------------------------------------------------------- ciclo de vida

  /** Zera tudo (começo/fim de sessão, nova partida). */
  reset(): void {
    this.pickups.clear();
    this.pickups.resetTimer();
    this.proj.clear();
    this.status.clearAll();
    this.states.clear();
    this.pickupReq.clear();
    this.botAir.clear();
    for (const a of this.g.actors.values()) {
      a.special = null;
      a.specialAmmo = 0;
    }
    this.fx.reset();
  }

  /** Actor saiu da sala. */
  removeActor(id: string): void {
    this.states.delete(id);
    this.status.clear(id);
    this.proj.removeOwner(id);
    this.botAir.delete(id);
    this.fx.clearActor(id);
  }

  /** Morreu / respawnou: perde a arma maluca e os status. `restore`: já equipa a arma do gun game. */
  clearActor(a: Actor, restore: boolean): void {
    this.dropSpecial(a, restore);
    this.status.clear(a.id);
    this.fx.clearActor(a.id);
  }

  private dropSpecial(a: Actor, restore: boolean): void {
    const kind = a.special;
    const st = this.states.get(a.id);
    if (st?.beamOn) this.beamOff(a, st);
    this.states.delete(a.id);
    if (!kind) return;
    a.special = null;
    a.specialAmmo = 0;
    if (a.isLocal) {
      this.fx.setHeld(null);
      if (restore && a.alive) this.g.weapons.equip(a.weapon, false, true);
    }
    bus.emit('special:end', { actorId: a.id, local: a.isLocal, kind });
  }

  // ---------------------------------------------------------------- eventos de partida

  /** Retorna true se o evento era das armas malucas. */
  onEvent(e: MatchEvent): boolean {
    const g = this.g;
    switch (e.t) {
      case 'pickup-spawn':
        this.pickups.applySpawn(e.id, e.kind, e.pos);
        return true;
      case 'pickup-take':
        this.pickups.applyTake(e.id, e.actor === '');
        return true;
      case 'special': {
        const a = g.actors.get(e.actor);
        if (a) this.give(a, e.kind, e.ammo);
        return true;
      }
      case 'special-end': {
        const a = g.actors.get(e.actor);
        if (a) this.dropSpecial(a, true);
        return true;
      }
      case 'impulse':
        this.onImpulse(e);
        return true;
      case 'status': {
        const v = g.actors.get(e.victim);
        if (!v || !v.alive) return true;
        this.status.apply(v.id, e.kind, e.dur, e.by);
        bus.emit('status:apply', { actorId: v.id, local: v.isLocal, kind: e.kind, dur: e.dur });
        if (v.isLocal && (e.kind === 'stun' || e.kind === 'blind')) g.camfx.addTrauma(0.3);
        return true;
      }
      case 'start':
        this.reset();
        return false; // o Game ainda trata o 'start'
      case 'spawn': {
        const a = g.actors.get(e.id);
        if (a) this.clearActor(a, false);
        return false;
      }
    }
    return false;
  }

  private give(a: Actor, kind: SpecialId, ammo: number): void {
    const prev = this.states.get(a.id);
    if (prev?.beamOn) this.beamOff(a, prev);
    a.special = kind;
    a.specialAmmo = ammo;
    if (this.simulates(a)) {
      this.states.set(a.id, {
        id: kind, ammo, cd: 0.45, charge: 0, charging: false, beamOn: false, tickT: 0, tickN: 0,
        confirmAcc: 0, confirmT: 0, netT: 0, out: false, endT: 0,
      });
    }
    if (a.isLocal) {
      this.g.weapons.holster();
      this.fx.setHeld(kind);
    }
    bus.emit('special:pickup', { actorId: a.id, local: a.isLocal, kind, pos: a.pos.clone() });
  }

  private onImpulse(e: Extract<MatchEvent, { t: 'impulse' }>): void {
    const g = this.g;
    const v = g.actors.get(e.victim);
    if (!v || !v.alive) return;
    if (e.fall && e.by && e.by !== v.id) this.status.markPush(v.id, e.by, e.weapon ?? 'ventilador', SPECIALS.ventilador.p.fallT);
    this.applyImpulse(v, e.vel[0], e.vel[1], e.vel[2], e.cap, e.minY);
  }

  /** Soma velocidade no corpo do actor, se esta máquina é quem o move (jogador local; bot no host). */
  applyImpulse(v: Actor, x: number, y: number, z: number, cap?: number, minY?: number): void {
    const g = this.g;
    let vel: THREE.Vector3 | null = null;
    let body: { grounded: boolean } | null = null;
    if (v.isLocal) { vel = g.player.body.vel; body = g.player.body; }
    else if (v.isBot && g.isHost && v.body) { vel = v.body.vel; body = v.body; }
    if (vel && body) {
      const before = Math.hypot(vel.x, vel.z);
      vel.x += x; vel.y += y; vel.z += z;
      if (minY !== undefined && vel.y < minY) vel.y = minY;
      if (cap !== undefined) {
        const lim = Math.max(cap, before);
        const hs = Math.hypot(vel.x, vel.z);
        if (hs > lim) { vel.x *= lim / hs; vel.z *= lim / hs; }
      }
      if (vel.y > 1) body.grounded = false;
      if (v.isLocal && (Math.abs(x) + Math.abs(z) > 4 || y > 4)) {
        g.camfx.punchFov(3);
        g.camfx.addTrauma(0.25);
      }
    }
    bus.emit('impulse', { actorId: v.id, local: v.isLocal, vel: new V(x, y, z) });
  }

  private fallDamage(a: Actor, impact: number): void {
    const push = this.status.pushOf(a.id);
    if (!push || impact < 9) return;
    this.status.clearPush(a.id);
    const dmg = Math.min(110, Math.round((impact - 8) * 9));
    this.g.requestDamage({ attacker: push.by, victim: a.id, dmg, headshot: false, weapon: push.weapon ?? 'ventilador', dir: [0, 0, 0] });
  }

  // ---------------------------------------------------------------- rede

  private send(m: SpecialMsg): void {
    this.g.net?.sendSpecial(m);
  }

  /** Mensagem recebida (cliente ← host, ou host ← cliente). */
  onMsg(m: SpecialMsg): void {
    try {
      this.handleMsg(m);
    } catch (err) {
      console.warn('[special] mensagem inválida ignorada', err);
    }
  }

  private handleMsg(m: SpecialMsg): void {
    const a = this.g.actors.get(m.a);
    if (!a || this.simulates(a)) return; // eco
    switch (m.t) {
      case 'ps': {
        if (!PROJ_SPECIAL[m.kd] || !Array.isArray(m.v) || m.v.length < 3 || m.v.length > 18 || !m.v.every(Number.isFinite)) return;
        this.proj.spawnRemote(m);
        const o = new V(m.o[0], m.o[1], m.o[2]);
        const dir = new V(m.v[0], m.v[1], m.v[2]).normalize();
        bus.emit('special:fire', { actorId: a.id, local: false, kind: PROJ_SPECIAL[m.kd], origin: o, dir, charge: m.c });
        a.model?.onFire();
        break;
      }
      case 'pu':
        if (Array.isArray(m.u) && m.u.length <= 70) this.proj.applyUpdate(m);
        break;
      case 'pe': this.proj.applyEnd(m); break;
      case 'bm':
        if (!BEAM_KINDS.includes(m.w)) return;
        bus.emit('special:beam', {
          actorId: a.id, local: false, kind: m.w, on: !!m.on, origin: new V(...m.o), dir: new V(...m.d), end: new V(...m.e),
          end2: m.e2 ? new V(...m.e2) : null, hit: !!m.h,
        });
        break;
    }
  }

  /** Host: um cliente pediu para pegar um pickup. */
  hostPickupRequest(actorId: string, pickupId: number): void {
    const a = this.g.actors.get(actorId);
    if (!a || !this.g.isHost || !this.g.match || this.g.match.ended) return;
    this.pickups.tryTake(pickupId, a, (e) => this.g.hostPublish(e));
  }

  /** Host: um cliente avisou que a munição acabou. */
  hostSpecialEnd(actorId: string, kind?: string): void {
    const a = this.g.actors.get(actorId);
    // só encerra se ainda é a mesma arma (o cliente pode ter pego outra nesse meio tempo)
    if (a?.special && (kind === undefined || kind === a.special)) this.g.hostPublish({ t: 'special-end', actor: a.id });
  }

  // ---------------------------------------------------------------- loop

  /** Tick fixo (60 Hz). */
  tick(dt: number): void {
    const g = this.g;
    this.time += dt;
    this.proj.tick(dt);

    this.status.update(
      dt,
      (id, kind) => {
        const a = g.actors.get(id);
        bus.emit('status:end', { actorId: id, local: !!a?.isLocal, kind });
      },
      g.isHost && g.match
        ? (id, by) => {
          const v = g.actors.get(id);
          if (v?.alive) g.match!.applyDamage({ attacker: by, victim: id, dmg: 7, headshot: false, weapon: 'rexona', dir: [0, 0, 0] });
        }
        : null,
    );

    // pickups
    if (g.isHost && g.match && !g.match.ended) {
      const collectors: Actor[] = [];
      for (const a of g.actors.values()) if (a.isLocal || a.isBot) collectors.push(a);
      this.pickups.hostUpdate(dt, {
        spots: this.spots(),
        actors: g.actors.values(),
        collectors,
        publish: (e) => g.hostPublish(e),
      });
      this.hostBotFalls(dt);
    } else if (!g.isHost && g.local?.alive) {
      this.clientPickupCheck(g.local);
    }

    // posições de teleguiados (pombo/chinelo) pros outros
    this.puT -= dt;
    if (this.puT <= 0 && g.net) {
      this.puT = 0.1;
      const byOwner = new Map<string, number[]>();
      for (const p of this.proj.guidedOf()) {
        let u = byOwner.get(p.owner);
        if (!u) byOwner.set(p.owner, (u = []));
        u.push(p.n, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z));
      }
      for (const [a, u] of byOwner) this.send({ t: 'pu', a, u });
    }
  }

  private spotCache: THREE.Vector3[] | null = null;
  private spots(): THREE.Vector3[] {
    return (this.spotCache ??= this.g.world.map.navNodes.map((n) => new V(n[0], n[1], n[2])));
  }

  private clientPickupCheck(me: Actor): void {
    for (const it of this.pickups.items.values()) {
      if (Math.abs(me.pos.y + 0.9 - it.pos[1]) > 2) continue;
      if (Math.hypot(me.pos.x - it.pos[0], me.pos.z - it.pos[2]) > PICKUP_RADIUS) continue;
      const last = this.pickupReq.get(it.id) ?? -9;
      if (this.time - last < 0.4) continue;
      this.pickupReq.set(it.id, this.time);
      this.g.net?.requestPickup(it.id);
      break;
    }
  }

  /** Bots empurrados que caem: o dano de queda é de quem empurrou (host). */
  private hostBotFalls(_dt: number): void {
    for (const a of this.g.actors.values()) {
      if (!a.isBot || !a.alive || !a.body) continue;
      const air = this.botAir.get(a.id);
      if (!a.body.grounded) {
        this.botAir.set(a.id, Math.min(air ?? 0, a.body.vel.y));
      } else if (air !== undefined) {
        this.botAir.delete(a.id);
        if (this.status.pushOf(a.id)) this.fallDamage(a, -air);
      }
    }
  }

  /** Por frame: visuais. */
  frame(dt: number, alpha: number): void {
    const g = this.g;
    this.pickups.visual(dt);
    this.proj.render(alpha, dt);
    const l = g.local;
    if (l && l.alive) {
      if (this.status.has(l.id, 'shock')) g.camfx.addTrauma(dt * 1.5);
      if (this.status.has(l.id, 'stun')) g.camfx.addTrauma(dt * 1.35);
    }
    this.fx.update(dt, {
      time: this.time,
      holding: !!l?.special && !!l.alive,
      speed: g.player.speed,
      grounded: g.player.grounded,
    });
  }

  /** Estado para o HUD. */
  hud(): SpecialHud {
    const g = this.g;
    const l = g.local;
    const st = l ? this.states.get(l.id) : undefined;
    const d = l?.special ? SPECIALS[l.special] : null;
    const blind = l ? this.status.blind(l.id) : 0;
    return {
      special: d && l
        ? { id: d.id, name: d.name, short: d.short, hint: d.hint, ammo: Math.max(0, Math.ceil(l.specialAmmo - 1e-3)), maxAmmo: d.ammo, unit: d.unit, color: d.color }
        : null,
      charge: st?.charging ? st.charge : 0,
      blind,
      burning: !!l && this.status.has(l.id, 'burn'),
      stunned: !!l && this.status.has(l.id, 'stun'),
      shocked: !!l && this.status.has(l.id, 'shock'),
      pickups: [...this.pickups.items.values()].map((i) => ({ id: i.id, kind: i.kind, x: i.pos[0], z: i.pos[2] })),
    };
  }

  // ---------------------------------------------------------------- uso (jogador local e bots)

  /** Jogador local: chamado todo frame enquanto segura uma arma maluca. */
  controlLocal(dt: number, trig: Trigger): void {
    const a = this.g.local;
    if (!a || !a.alive || !a.special) return;
    const st = this.states.get(a.id);
    if (!st) return;
    const p = this.g.player;
    const eye = _eye.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
    const dir = aimDir(p.yaw, p.pitch, _aim);
    this.control(a, st, dt, trig, eye, dir);
  }

  /** Bot (host): `dir` = para onde está mirando. */
  controlBot(a: Actor, dt: number, trig: Trigger, dir: THREE.Vector3): void {
    const st = this.states.get(a.id);
    if (!st || !a.alive) return;
    this.control(a, st, dt, trig, a.eyePos(_eye), _aim.copy(dir));
  }

  hasState(a: Actor): boolean {
    return this.states.has(a.id);
  }

  /** Jogador local largou a arma maluca (Treino: trocou de arma pelo teclado). */
  dropLocal(): void {
    const a = this.g.local;
    if (a?.special) this.finish(a);
  }

  private control(a: Actor, st: SState, dt: number, trig: Trigger, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const D = SPECIALS[st.id];
    st.cd -= dt;
    if (st.endT > 0) {
      st.endT -= dt;
      if (st.endT <= 0) this.finish(a);
      return;
    }
    switch (D.style) {
      case 'beam':
      case 'flame':
      case 'wind':
        this.controlContinuous(a, st, dt, trig.held, eye, dir);
        break;
      case 'charge':
        this.controlCharge(a, st, dt, trig, eye, dir);
        break;
      default: {
        const auto = st.id === 'pombo';
        if ((auto ? trig.held : trig.pressed) && st.cd <= 0 && st.ammo > 0 && !(st.id === 'chinelo' && st.out)) this.useDiscrete(a, st, eye, dir);
      }
    }
  }

  /** Acabou: volta pra arma do gun game. */
  private finish(a: Actor): void {
    const g = this.g;
    const kindEnded = a.special as SpecialId;
    if (g.isHost) g.hostPublish({ t: 'special-end', actor: a.id });
    else {
      this.dropSpecial(a, true);
      g.net?.requestSpecialEnd(a.special ?? kindEnded);
    }
  }

  private afterUse(a: Actor, st: SState, cd: number): void {
    st.ammo -= 1;
    a.specialAmmo = st.ammo;
    st.cd = cd;
    if (st.ammo <= 0 && st.id !== 'chinelo') st.endT = 0.5;
  }

  // ---- armas discretas

  /** Ponto de saída do projétil e direção ajustada pra acertar a mira do centro da tela. */
  private launch(eye: THREE.Vector3, dir: THREE.Vector3, outPos: THREE.Vector3, outDir: THREE.Vector3): void {
    _c.crossVectors(dir, UP);
    if (_c.lengthSq() < 1e-6) _c.set(1, 0, 0);
    _c.normalize();
    outPos.copy(eye).addScaledVector(dir, 0.55).addScaledVector(_c, 0.16);
    outPos.y -= 0.13;
    if (!this.g.world.visible(eye, outPos)) outPos.copy(eye).addScaledVector(dir, 0.12);
    const wh = this.g.world.raycast(eye, dir, 60);
    _d.copy(wh ? wh.point : _e.copy(eye).addScaledVector(dir, 60));
    outDir.subVectors(_d, outPos);
    if (outDir.lengthSq() < 0.01) outDir.copy(dir);
    outDir.normalize();
  }

  private spawnProj(a: Actor, kind: ProjKind, origin: THREE.Vector3, vels: THREE.Vector3[], charge?: number): void {
    const n = this.proj.nextN(a.id, vels.length);
    const flat: number[] = [];
    vels.forEach((v, i) => {
      this.proj.spawn(a.id, kind, origin, v, true, { n: n + i, charge });
      flat.push(r2(v.x), r2(v.y), r2(v.z));
    });
    this.send({ t: 'ps', a: a.id, n, kd: kind, o: v3(origin), v: flat, c: charge === undefined ? undefined : r2(charge) });
    const dir = vels[0].clone().normalize();
    bus.emit('special:fire', { actorId: a.id, local: a.isLocal, kind: PROJ_SPECIAL[kind], origin: origin.clone(), dir, charge });
    a.model?.onFire();
    if (a.isLocal) {
      this.g.camfx.addTrauma(kind === 'coxinha' ? 0.3 : 0.12);
      this.g.camfx.punchFov(kind === 'coxinha' ? 2.5 : 1.2);
      this.fx.kickHeld();
    }
  }

  private useDiscrete(a: Actor, st: SState, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const D = SPECIALS[st.id];
    const P = D.p;
    const origin = _o, ld = _f;
    this.launch(eye, dir, origin, ld);
    switch (st.id) {
      case 'dolly':
      case 'panela':
      case 'tijolo': {
        const kind: ProjKind = st.id === 'dolly' ? 'bottle' : st.id === 'panela' ? 'panela' : 'brick';
        const v = ld.clone();
        v.y += P.lift;
        v.normalize().multiplyScalar(P.speed);
        this.spawnProj(a, kind, origin, [v]);
        break;
      }
      case 'pombo': {
        const v = ld.clone().multiplyScalar(P.speed);
        this.spawnProj(a, 'pombo', origin, [v]);
        break;
      }
      case 'chinelo': {
        const v = ld.clone();
        v.y *= 0.4;
        v.normalize().multiplyScalar(P.speed);
        this.spawnProj(a, 'chinelo', origin, [v]);
        st.out = true;
        break;
      }
      case 'coxinha': {
        const vels: THREE.Vector3[] = [];
        for (let i = 0; i < P.pellets; i++) {
          // cone uniforme em volta da direção de saída
          _c.crossVectors(ld, UP);
          if (_c.lengthSq() < 1e-6) _c.set(1, 0, 0);
          _c.normalize();
          _e.crossVectors(_c, ld).normalize();
          const ang = Math.random() * Math.PI * 2, r = Math.tan(P.spread) * Math.sqrt(Math.random());
          vels.push(ld.clone().addScaledVector(_c, Math.cos(ang) * r).addScaledVector(_e, Math.sin(ang) * r).normalize().multiplyScalar(P.speed));
        }
        this.spawnProj(a, 'coxinha', origin, vels);
        break;
      }
      default:
        return;
    }
    this.afterUse(a, st, P.cd);
  }

  private controlCharge(a: Actor, st: SState, dt: number, trig: Trigger, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const P = SPECIALS.estilingue.p;
    if (!st.charging) {
      if (trig.held && st.cd <= 0 && st.ammo > 0) { st.charging = true; st.charge = 0; }
      return;
    }
    st.charge = Math.min(1, st.charge + dt / P.chargeTime);
    bus.emit('special:charge', { actorId: a.id, local: a.isLocal, charge: st.charge });
    if (trig.held) return;
    // soltou: estilingada
    const c = Math.max(P.minCharge, st.charge);
    st.charging = false;
    st.charge = 0;
    bus.emit('special:charge', { actorId: a.id, local: a.isLocal, charge: 0 });
    this.launch(eye, dir, _o, _f);
    const v = _f.clone();
    v.y += 0.02;
    v.normalize().multiplyScalar(P.vMin + (P.vMax - P.vMin) * c);
    this.spawnProj(a, 'stone', _o, [v], c);
    this.afterUse(a, st, P.cd);
  }

  // ---- armas contínuas (raio / jato / vento)

  private controlContinuous(a: Actor, st: SState, dt: number, held: boolean, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const P = SPECIALS[st.id].p;
    if (held && st.ammo > 0) {
      st.ammo = Math.max(0, st.ammo - dt);
      a.specialAmmo = st.ammo;
      st.tickT -= dt;
      let doTick = false;
      if (st.tickT <= 0) { doTick = true; st.tickT = Math.max(st.tickT + P.tick, 0); st.tickN++; }
      const r = this.beamTick(a, st, eye, dir, doTick);
      st.beamOn = true;

      // origem visual: perto do "cano"
      const origin = this.muzzle(eye, dir, new V());
      const kind = st.id as BeamKind;
      bus.emit('special:beam', { actorId: a.id, local: a.isLocal, kind, on: true, origin, dir: dir.clone(), end: r.end, end2: r.end2, hit: r.hit });
      if (a.isLocal) this.fx.kickHeld(0.35);
      st.netT -= dt;
      if (st.netT <= 0) {
        st.netT = 1 / 15;
        this.send({ t: 'bm', a: a.id, w: kind, on: 1, o: v3(origin), d: v3(dir), e: v3(r.end), e2: r.end2 ? v3(r.end2) : undefined, h: r.hit ? 1 : 0 });
      }
      if (st.ammo <= 0) {
        this.beamOff(a, st);
        this.finish(a);
      }
    } else if (st.beamOn) {
      this.beamOff(a, st);
      if (st.ammo <= 0) this.finish(a);
    }
  }

  private muzzle(eye: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    _c.crossVectors(dir, UP);
    if (_c.lengthSq() < 1e-6) _c.set(1, 0, 0);
    _c.normalize();
    out.copy(eye).addScaledVector(dir, 0.7).addScaledVector(_c, 0.15);
    out.y -= 0.12;
    return out;
  }

  private beamOff(a: Actor, st: SState): void {
    if (!st.beamOn) return;
    st.beamOn = false;
    const kind = st.id as BeamKind;
    const z = new V();
    bus.emit('special:beam', { actorId: a.id, local: a.isLocal, kind, on: false, origin: z, dir: z, end: z, end2: null, hit: false });
    this.send({ t: 'bm', a: a.id, w: kind, on: 0, o: [0, 0, 0], d: [0, 0, 0], e: [0, 0, 0] });
  }

  /** Inimigos vivos dentro de um cone, com linha de visão. */
  private inCone(a: Actor, eye: THREE.Vector3, dir: THREE.Vector3, range: number, half: number, cb: (v: Actor, dist: number, chest: THREE.Vector3, ang: number) => void): void {
    for (const v of this.g.actors.values()) {
      if (v === a || !v.alive) continue;
      const chest = chestOf(v, _c);
      const to = _d.subVectors(chest, eye);
      const dist = to.length();
      if (dist > range || dist < 0.2) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, to.dot(dir) / dist)));
      if (ang > half + 0.35 / dist) continue;
      if (!this.g.world.visible(eye, chest)) continue;
      cb(v, dist, chest.clone(), ang);
    }
  }

  private beamTick(a: Actor, st: SState, eye: THREE.Vector3, dir: THREE.Vector3, doTick: boolean): { end: THREE.Vector3; end2: THREE.Vector3 | null; hit: boolean } {
    const P = SPECIALS[st.id].p;
    const world = this.g.world;
    let end: THREE.Vector3, end2: THREE.Vector3 | null = null, hit = false;

    if (st.id === 'lorenzetti') {
      // mira automática leve: o inimigo mais perto da linha de mira dentro de um cone pequeno
      const found: { v: Actor | null; chest: THREE.Vector3 | null; ang: number } = { v: null, chest: null, ang: 9 };
      this.inCone(a, eye, dir, P.range, P.cone, (v, _dist, chest, ang) => {
        if (ang < found.ang) { found.ang = ang; found.v = v; found.chest = chest; }
      });
      if (found.v && found.chest) {
        const target = found.v, tChest = found.chest;
        end = tChest;
        hit = true;
        // arco: pula pro inimigo mais próximo do alvo
        const arc: { v: Actor | null; chest: THREE.Vector3 | null } = { v: null, chest: null };
        let sd = P.arcRange;
        for (const v of this.g.actors.values()) {
          if (v === a || v === target || !v.alive) continue;
          const c = chestOf(v, _e);
          const d = c.distanceTo(tChest);
          if (d < sd && world.visible(tChest, c)) { sd = d; arc.v = v; arc.chest = c.clone(); }
        }
        if (arc.chest) end2 = arc.chest;
        if (doTick) {
          const shock = st.tickN % 3 === 1;
          this.zap(a, st, target, Math.round(P.dps * P.tick), tChest, shock);
          if (arc.v && arc.chest) this.zap(a, st, arc.v, Math.round(P.arcDps * P.tick), arc.chest, shock);
        }
      } else {
        const wh = world.raycast(eye, dir, P.range);
        end = wh ? wh.point.clone() : eye.clone().addScaledVector(dir, P.range);
      }
      return { end, end2, hit };
    }

    if (st.id === 'rexona') {
      const wh = world.raycast(eye, dir, P.range);
      end = wh ? wh.point.clone() : eye.clone().addScaledVector(dir, P.range);
      this.inCone(a, eye, dir, P.range, P.cone, (v, _d2, chest) => {
        hit = true;
        if (!doTick) return;
        const dmg = Math.round(P.dps * P.tick);
        const burning = this.status.left(v.id, 'burn') > 1.5;
        this.hurt(a, v, { dmg, weapon: 'rexona', point: chest, dir, st: burning ? undefined : 'burn', sd: P.burn, confirm: false, impact: false });
        this.groupConfirm(a, st, dmg, v, chest);
      });
      return { end, end2: null, hit };
    }

    // ventilador
    const wh = world.raycast(eye, dir, P.range);
    end = wh ? wh.point.clone() : eye.clone().addScaledVector(dir, P.range);
    if (doTick) {
      this.inCone(a, eye, dir, P.range, P.cone, (v, dist, chest) => {
        hit = true;
        const f = 1 - 0.65 * (dist / P.range);
        _e.set(dir.x, 0, dir.z);
        _f.set(chest.x - eye.x, 0, chest.z - eye.z);
        if (_e.lengthSq() < 1e-4) _e.copy(_f);
        _e.normalize().multiplyScalar(0.6).addScaledVector(_f.normalize(), 0.4).normalize();
        const push = P.push * f;
        this.g.requestDamage({
          attacker: a.id, victim: v.id, dmg: 0, headshot: false, weapon: 'ventilador', dir: [dir.x, dir.y, dir.z],
          imp: { v: [r2(_e.x * push), 0, r2(_e.z * push)], cap: P.cap, minY: P.lift * (0.6 + 0.4 * f), fall: true },
        });
      });
    }
    return { end, end2: null, hit };
  }

  private zap(a: Actor, st: SState, v: Actor, dmg: number, point: THREE.Vector3, shock: boolean): void {
    this.hurt(a, v, { dmg, weapon: 'lorenzetti', point, dir: _aim, st: shock ? 'shock' : undefined, sd: SPECIALS.lorenzetti.p.shockDur, confirm: false, impact: false });
    this.groupConfirm(a, st, dmg, v, point);
  }

  /** Hit marker agrupado (a cada 2 ticks) nas armas de jato: não metralha o HUD nem o áudio. */
  private groupConfirm(a: Actor, st: SState, dmg: number, v: Actor, point: THREE.Vector3): void {
    if (!a.isLocal) return;
    st.confirmAcc += dmg;
    st.confirmT -= 1;
    if (st.confirmT <= 0) {
      st.confirmT = 2;
      bus.emit('hit:confirm', { damage: st.confirmAcc, headshot: false, killed: !v.alive, point: point.clone() });
      st.confirmAcc = 0;
    }
  }

  // ---------------------------------------------------------------- dano

  /** Pede dano ao host (ou aplica, se somos o host) + hit marker do jogador local. */
  private hurt(
    shooter: Actor, v: Actor,
    o: { dmg: number; head?: boolean; weapon: SpecialId; point?: THREE.Vector3; dir?: THREE.Vector3; imp?: DamageRequest['imp']; st?: StatusKind; sd?: number; confirm?: boolean; impact?: boolean },
  ): void {
    const dmg = Math.round(o.dmg);
    const dir = o.dir;
    if (shooter.isLocal && dmg > 0 && o.confirm !== false) {
      bus.emit('hit:confirm', { damage: dmg, headshot: !!o.head, killed: dmg >= v.hp, point: (o.point ?? chestOf(v, _c)).clone() });
    }
    if (dmg > 0 && o.point && o.impact !== false) bus.emit('weapon:impact', { point: o.point.clone(), normal: new V(0, 1, 0), surface: 'flesh' });
    const r: DamageRequest = {
      attacker: shooter.id, victim: v.id, dmg, headshot: !!o.head, weapon: o.weapon, dir: dir ? [r2(dir.x), r2(dir.y), r2(dir.z)] : [0, 0, 0],
    };
    if (o.imp) r.imp = o.imp;
    if (o.st) { r.st = o.st; r.sd = o.sd; }
    this.g.requestDamage(r);
  }

  // ---------------------------------------------------------------- ProjHost: acertos e fins

  hit(p: Proj, victim: Actor, head: boolean, point: THREE.Vector3): boolean {
    const shooter = this.g.actors.get(p.owner);
    if (!shooter) return true;
    const dir = _f.copy(p.vel).normalize();
    const hp0 = victim.hp; // antes do dano (o host aplica na hora)
    let killed = false;
    switch (p.kind) {
      case 'stone': {
        const P = SPECIALS.estilingue.p;
        let dmg = P.dmgMin + (P.dmgMax - P.dmgMin) * p.charge;
        if (head) dmg = p.charge >= P.killCharge ? 250 : dmg * P.headMult;
        this.hurt(shooter, victim, { dmg, head, weapon: 'estilingue', point, dir });
        killed = dmg >= hp0;
        break;
      }
      case 'brick': {
        const P = SPECIALS.tijolo.p;
        if (head) {
          if (victim.hp <= P.killHp) this.hurt(shooter, victim, { dmg: 250, head, weapon: 'tijolo', point, dir });
          else this.hurt(shooter, victim, { dmg: P.headDmg, head, weapon: 'tijolo', point, dir, st: 'stun', sd: P.stun });
        } else {
          this.hurt(shooter, victim, { dmg: P.dmg, weapon: 'tijolo', point, dir });
        }
        killed = hp0 <= (head ? (hp0 <= P.killHp ? 999 : P.headDmg) : P.dmg);
        break;
      }
      case 'coxinha': {
        const P = SPECIALS.coxinha.p;
        const fall = p.travel <= P.falloffStart ? 1 : Math.max(P.falloffMin, 1 - ((p.travel - P.falloffStart) / (P.falloffEnd - P.falloffStart)) * (1 - P.falloffMin));
        const dmg = P.dmg * fall * (head ? 1.5 : 1);
        this.hurt(shooter, victim, { dmg, head, weapon: 'coxinha', point, dir });
        killed = dmg >= hp0;
        break;
      }
      case 'bottle':
        break; // explode no ended()
      case 'pombo': {
        const P = SPECIALS.pombo.p;
        this.hurt(shooter, victim, { dmg: P.dmg, weapon: 'pombo', point, dir, st: 'blind', sd: P.blind });
        killed = P.dmg >= hp0;
        break;
      }
      case 'chinelo': {
        this.hurt(shooter, victim, { dmg: SPECIALS.chinelo.p.dmg, head, weapon: 'chinelo', point, dir });
        killed = true;
        break;
      }
      default:
        break;
    }
    if (p.kind !== 'bottle') bus.emit('special:hit', { kind: p.kind, pos: point.clone(), victimId: victim.id, headshot: head, killed });
    return p.kind !== 'chinelo';
  }

  ended(p: Proj, why: EndReason): void {
    const boom = p.kind === 'bottle' || p.kind === 'panela';
    if (p.auth) {
      if (!(p.kind === 'coxinha' && why === 'world')) {
        this.send({ t: 'pe', a: p.owner, n: p.n, p: v3(p.pos), w: END_CODE[boom ? 'explode' : why] });
      }
      if (p.kind === 'chinelo') {
        const st = this.states.get(p.owner);
        if (st) {
          st.out = false;
          const o = this.g.actors.get(p.owner);
          bus.emit('special:catch', { actorId: p.owner, local: !!o?.isLocal });
          if (o && st.ammo <= 0) this.finish(o);
        }
      }
    }
    if (boom && (p.auth || why === 'explode')) this.explode(p);
  }

  /** Gêiser de Dolly / feijão da panela. Só quem atirou calcula dano e knockback. */
  private explode(p: Proj): void {
    const g = this.g;
    const isBottle = p.kind === 'bottle';
    const P = (isBottle ? SPECIALS.dolly : SPECIALS.panela).p;
    const center = p.pos.clone();
    bus.emit('special:explode', { kind: isBottle ? 'dolly' : 'panela', pos: center, radius: P.radius });

    const l = g.local;
    if (l?.alive) {
      const d = l.pos.distanceTo(center);
      g.camfx.addTrauma(Math.max(0, 1 - d / 28) * 0.7);
    }
    if (!p.auth) return;
    const shooter = g.actors.get(p.owner);
    if (!shooter) return;
    const R = P.radius + 0.4;
    const weapon: SpecialId = isBottle ? 'dolly' : 'panela';
    for (const v of g.actors.values()) {
      if (!v.alive) continue;
      const c = chestOf(v, _c);
      const d = c.distanceTo(center);
      if (d > R) continue;
      if (d > 1.6 && !g.world.visible(_d.copy(center).setY(center.y + 0.3), c)) continue;
      const f = Math.max(0, 1 - d / R);
      let hx = c.x - center.x, hz = c.z - center.z;
      const hl = Math.hypot(hx, hz);
      if (hl < 0.25) { const ang = Math.random() * 6.28; hx = Math.cos(ang); hz = Math.sin(ang); } else { hx /= hl; hz /= hl; }
      const kn = P.knock * (0.35 + 0.65 * f);
      const up = P.up * (0.4 + 0.6 * f);
      if (v.id === shooter.id) {
        // rocket jump: knockback sem dano
        this.applyImpulse(v, hx * kn * 0.6, up * 0.7, hz * kn * 0.6);
        continue;
      }
      const dmg = P.dmgMin + (P.dmg - P.dmgMin) * f;
      this.hurt(shooter, v, { dmg, weapon, point: c, dir: _f.set(hx, 0, hz), imp: { v: [r2(hx * kn), r2(up), r2(hz * kn)] } });
    }
  }
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
