import * as THREE from 'three';
import { bus } from '../../core/events';
import { buildPickupModel, buildPowerModel, buildProjectileModel } from '../../fx/special/models';
import { SpecialFX } from '../../fx/special/SpecialFX';
import type { Actor } from '../Actor';
import type { Game } from '../Game';
import type { DamageRequest, MatchEvent, V3 } from '../Match';
import { aimDir } from '../Weapons';
import { POWERS, POWER_RADIUS, PowerupSystem, powerUseful } from './Powerups';
import { REGEN_FULL, SPECIALS, type BeamKind, type ProjKind, type SpecialId, type StatusKind } from './defs';
import { END_CODE, v3, type EndReason, type SpecialMsg } from './msgs';
import { PickupSystem, PICKUP_RADIUS } from './Pickups';
import { chestOf, ProjectileSim, type Proj, type ProjHost } from './Projectiles';
import { StatusManager } from './Status';

const V = THREE.Vector3;
const UP = new V(0, 1, 0);
const _a = new V(), _b = new V(), _c = new V(), _o = new V(), _d = new V(), _e = new V(), _f = new V();
const _eye = new V(), _aim = new V();
const _k1 = new V(), _k2 = new V(), _k3 = new V(), _k4 = new V();
const _sa = new V(), _sb = new V(), _sr = new V();

/** Projétil → arma que o dispara (para sons/eventos de quem só recebe a mensagem). */
const PROJ_SPECIAL: Record<ProjKind, SpecialId> = {
  stone: 'estilingue', bottle: 'dolly', brick: 'tijolo', panela: 'panela', bola: 'bola', pombo: 'pombo', chinelo: 'chinelo', rojao: 'rojao', galinha: 'galinha',
};
const BEAM_KINDS: SpecialId[] = ['lorenzetti', 'rexona', 'ventilador', 'cafe'];

const clamp = (n: number, a: number, b: number): number => (n < a ? a : n > b ? b : n);
const ok3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

/**
 * Dano inteiro por tick que, somado, dá exatamente dps*tick em média (ex.: 4.5/tick → 4, 5, 4, 5...).
 * `x` = dano por tick (dps * tick), `n` = nº do tick (1, 2, 3...).
 */
const tickDmg = (x: number, n: number): number => Math.floor(x * n + 1e-6) - Math.floor(x * (n - 1) + 1e-6);

/** Menor distância entre os segmentos p1-q1 e p2-q2; `c1`/`c2` recebem os pontos mais próximos. */
function segSeg(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, c1: THREE.Vector3, c2: THREE.Vector3): number {
  const d1 = _sa.subVectors(q1, p1), d2 = _sb.subVectors(q2, p2), r = _sr.subVectors(p1, p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s: number, t: number;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = d1.dot(d2);
      const den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

/** Pipa no ar (só em quem simula). */
interface KiteState {
  /** Direção atual (unitária) da mão para a pipa; segue a mira com atraso. */
  dir: THREE.Vector3;
  len: number;
  pos: THREE.Vector3;
  hand: THREE.Vector3;
  age: number;
  netT: number;
  hit: boolean;
}

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
  /** Pipa no ar. */
  kite: KiteState | null;
  /** Ventilador: a hélice está picotando alguém / alguém no cone no último tick de dano. */
  chop: boolean;
  lastHit: boolean;
  /** Loja: progresso (0..1) até a próxima unidade de munição voltar. */
  regen: number;
}

export interface Trigger {
  held: boolean;
  pressed: boolean;
}

export interface SpecialHud {
  special: {
    id: SpecialId; name: string; short: string; hint: string; ammo: number; maxAmmo: number; unit: 'sec' | 'shot'; color: number;
    /** Em uso agora (jato ligado, pipa no ar, golpe carregando). */
    active: boolean;
  } | null;
  charge: number;
  blind: number;
  /** Vapor do café na tela: 0..1. */
  steam: number;
  burning: boolean;
  stunned: boolean;
  shocked: boolean;
  pickups: { id: number; kind: string; x: number; z: number; color?: number }[];
}

/**
 * Armas malucas: pickups, uso (local e bots), projéteis, status e efeitos.
 * O Game só encaminha eventos e chama tick/frame; a regra toda mora aqui.
 */
export class SpecialSystem implements ProjHost {
  readonly status = new StatusManager();
  readonly pickups: PickupSystem;
  /** Powerups fixos do mapa (modo da loja). */
  readonly powers: PowerupSystem;
  readonly proj: ProjectileSim;
  readonly fx: SpecialFX;
  readonly states = new Map<string, SState>();
  private time = 0;
  private pickupReq = new Map<number, number>();
  private powerReq = new Map<number, number>();
  private puT = 0;
  private botAir = new Map<string, number>();

  constructor(private g: Game) {
    this.pickups = new PickupSystem(g.scene, buildPickupModel);
    this.powers = new PowerupSystem(g.scene, buildPowerModel);
    this.proj = new ProjectileSim(this, g.scene, buildProjectileModel);
    const down = new V(0, -1, 0), probe = new V();
    this.fx = new SpecialFX(g.scene, g.camera, g.vm.scene, {
      actors: () => g.actors.values(),
      local: () => g.local,
      statusLeft: (id, k) => this.status.left(id, k),
      localBlind: () => (g.local ? this.status.blind(g.local.id) : 0),
      localSteam: () => (g.local ? this.status.steam(g.local.id) : 0),
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
    this.powers.clear();
    this.powers.resetSpots();
    this.powerReq.clear();
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
    if (st?.kite) this.kiteOff(a, st);
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
      case 'power-spawn':
        this.powers.applySpawn(e.id, e.kind, e.pos);
        return true;
      case 'power-take': {
        const it = this.powers.applyTake(e.id);
        const a = g.actors.get(e.actor);
        if (it && a) bus.emit('power:take', { kind: it.kind, actorId: a.id, local: a.isLocal });
        return true;
      }
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
        this.status.apply(v.id, e.kind, e.dur, e.by, e.weapon ?? null);
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
    if (prev?.kite) this.kiteOff(a, prev);
    a.special = kind;
    a.specialAmmo = ammo;
    if (this.simulates(a)) {
      this.states.set(a.id, {
        id: kind, ammo, cd: 0.45, charge: 0, charging: false, beamOn: false, tickT: 0, tickN: 0,
        confirmAcc: 0, confirmT: 0, netT: 0, out: false, endT: 0, kite: null, chop: false, lastHit: false, regen: 0,
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
    if (e.fall && e.by && e.by !== v.id) {
      const w = e.weapon ?? 'ventilador';
      this.status.markPush(v.id, e.by, w, SPECIALS[w].p.fallT ?? 3.5);
    }
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
    const dmg = Math.min(130, Math.round((impact - 8) * 9));
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
        if (!BEAM_KINDS.includes(m.w) || !ok3(m.o) || !ok3(m.d) || !ok3(m.e)) return;
        bus.emit('special:beam', {
          actorId: a.id, local: false, kind: m.w, on: !!m.on, origin: new V(...m.o), dir: new V(...m.d), end: new V(...m.e),
          end2: m.e2 && ok3(m.e2) ? new V(...m.e2) : null, hit: !!m.h, chop: !!m.c,
        });
        break;
      case 'kt':
        if (!ok3(m.o) || !ok3(m.k)) return;
        bus.emit('special:kite', { actorId: a.id, local: false, on: !!m.on, origin: new V(...m.o), kite: new V(...m.k), hit: !!m.h });
        break;
      case 'fx': {
        if (!ok3(m.o) || !ok3(m.d) || !SPECIALS[m.w]) return;
        const dir = new V(...m.d);
        if (dir.lengthSq() < 1e-6) return;
        bus.emit('special:fire', { actorId: a.id, local: false, kind: m.w, origin: new V(...m.o), dir: dir.normalize(), charge: m.c });
        a.model?.onFire();
        break;
      }
      case 'gl': {
        if (!ok3(m.p) || !Number.isFinite(m.s)) return;
        const pos = new V(...m.p);
        bus.emit('special:hit', { kind: 'bola', pos: pos.clone(), victimId: m.v, headshot: true, killed: true });
        bus.emit('special:golaco', { actorId: a.id, local: false, victimId: m.v, pos, speed: m.s });
        break;
      }
    }
  }

  /** Host: um cliente pediu para pegar um pickup. */
  hostPickupRequest(actorId: string, pickupId: number): void {
    const a = this.g.actors.get(actorId);
    if (!a || !this.g.isHost || !this.g.match || this.g.match.ended) return;
    this.pickups.tryTake(pickupId, a, (e) => this.g.hostPublish(e));
  }

  /** Host: um cliente pediu para pegar um powerup. */
  hostPowerRequest(actorId: string, id: number): void {
    const a = this.g.actors.get(actorId);
    if (!a || !this.g.isHost || !this.g.match || this.g.match.ended) return;
    this.powers.tryTake(id, a, (e) => this.g.hostPublish(e));
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
        ? (id, by, w) => {
          const v = g.actors.get(id);
          const weapon: SpecialId = w ?? 'rexona';
          const dmg = Math.round((SPECIALS[weapon].p.burnDps ?? 14) * 0.5);
          if (v?.alive) g.match!.applyDamage({ attacker: by, victim: id, dmg, headshot: false, weapon, dir: [0, 0, 0] });
        }
        : null,
    );

    // pickups (só no Treino: na loja as malucas se compram)
    this.pickups.enabled = g.mode === 'treino';
    if (g.isHost && g.match && !g.match.ended) {
      const collectors: Actor[] = [];
      for (const a of g.actors.values()) if (a.isLocal || a.isBot) collectors.push(a);
      // powerups fixos (só na loja)
      if (g.mode === 'gungame') this.powers.hostUpdate(dt, { nodes: this.spots(), collectors, publish: (e) => g.hostPublish(e) });
      this.pickups.hostUpdate(dt, {
        spots: this.spots(),
        actors: g.actors.values(),
        collectors,
        publish: (e) => g.hostPublish(e),
      });
      this.hostBotFalls(dt);
    } else if (!g.isHost && g.local?.alive) {
      this.clientPickupCheck(g.local);
      if (g.mode === 'gungame') this.clientPowerCheck(g.local);
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

  private clientPowerCheck(me: Actor): void {
    for (const it of this.powers.items.values()) {
      if (Math.abs(me.pos.y + 0.9 - it.pos[1]) > 2 || !powerUseful(me, it.kind)) continue;
      if (Math.hypot(me.pos.x - it.pos[0], me.pos.z - it.pos[2]) > POWER_RADIUS) continue;
      const last = this.powerReq.get(it.id) ?? -9;
      if (this.time - last < 0.4) continue;
      this.powerReq.set(it.id, this.time);
      this.g.net?.requestPower(it.id);
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
    this.powers.visual(dt);
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
        ? {
          id: d.id, name: d.name, short: d.short, hint: d.hint, ammo: Math.max(0, Math.ceil(l.specialAmmo - 1e-3)), maxAmmo: d.ammo, unit: d.unit, color: d.color,
          active: !!st && (st.beamOn || !!st.kite),
        }
        : null,
      charge: st?.charging ? st.charge : 0,
      blind,
      steam: l ? this.status.steam(l.id) : 0,
      burning: !!l && this.status.has(l.id, 'burn'),
      stunned: !!l && this.status.has(l.id, 'stun'),
      shocked: !!l && this.status.has(l.id, 'shock'),
      pickups: [
        ...[...this.pickups.items.values()].map((i) => ({ id: i.id, kind: i.kind as string, x: i.pos[0], z: i.pos[2] })),
        ...[...this.powers.items.values()].map((i) => ({ id: 1e6 + i.id, kind: i.kind as string, x: i.pos[0], z: i.pos[2], color: POWERS[i.kind].color })),
      ],
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

  /** A arma maluca do actor está "ligada" (pipa no ar). Usado pelos bots para saber se o próximo clique recolhe. */
  isOn(a: Actor): boolean {
    return !!this.states.get(a.id)?.kite;
  }

  /** Jogador local largou a arma maluca (Treino: trocou de arma pelo teclado). */
  dropLocal(): void {
    const a = this.g.local;
    if (a?.special) this.finish(a);
  }

  private control(a: Actor, st: SState, dt: number, trig: Trigger, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const D = SPECIALS[st.id];
    st.cd -= dt;
    // pilha eterna: munição sempre cheia
    if (a.buffs.ammo > 0 && st.ammo < D.ammo) { st.ammo = D.ammo; a.specialAmmo = D.ammo; }
    this.regenAmmo(a, st, D, dt);
    if (st.endT > 0) {
      st.endT -= dt;
      if (st.endT <= 0) this.finish(a);
      return;
    }
    switch (D.style) {
      case 'beam':
      case 'flame':
      case 'wind':
      case 'jet':
        this.controlContinuous(a, st, dt, trig.held, eye, dir);
        break;
      case 'charge':
        this.controlCharge(a, st, dt, trig, eye, dir);
        break;
      case 'kite':
        this.controlKite(a, st, dt, trig, eye, dir);
        break;
      default: {
        const auto = st.id === 'pombo';
        if ((auto ? trig.held : trig.pressed) && st.cd <= 0 && st.ammo > 0 && !(st.id === 'chinelo' && st.out)) this.useDiscrete(a, st, eye, dir);
      }
    }
  }

  /** Loja: a munição volta sozinha, em blocos de 1 (tiro ou segundo), enquanto a arma não está em uso. */
  private regenAmmo(a: Actor, st: SState, D: (typeof SPECIALS)[SpecialId], dt: number): void {
    if (this.g.mode !== 'gungame' || st.ammo >= D.ammo) return;
    if (st.beamOn || st.charging || st.kite || st.out) return;
    st.regen += (dt * D.ammo) / (D.regen ?? REGEN_FULL);
    if (st.regen < 1) return;
    st.regen -= 1;
    st.ammo = Math.min(D.ammo, st.ammo + 1);
    a.specialAmmo = st.ammo;
  }

  /** Acabou a munição: no Treino volta pra arma comum. Na loja a arma fica (sem munição) e regenera. */
  private finish(a: Actor): void {
    const g = this.g;
    if (g.mode === 'gungame') return;
    const kindEnded = a.special as SpecialId;
    if (g.isHost) g.hostPublish({ t: 'special-end', actor: a.id });
    else {
      this.dropSpecial(a, true);
      g.net?.requestSpecialEnd(a.special ?? kindEnded);
    }
  }

  private afterUse(a: Actor, st: SState, cd: number, cost = 1): void {
    st.ammo = Math.max(0, st.ammo - cost);
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
      this.g.camfx.addTrauma(kind === 'bola' ? 0.22 : 0.12);
      this.g.camfx.punchFov(kind === 'bola' ? 2 : 1.2);
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
      case 'pombo':
      case 'rojao': {
        const v = ld.clone().multiplyScalar(P.speed);
        this.spawnProj(a, st.id, origin, [v]);
        break;
      }
      case 'galinha': {
        // sai correndo no chão na direção da mira (só o plano horizontal importa)
        const v = ld.clone().setY(0);
        if (v.lengthSq() < 1e-4) v.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
        v.normalize().multiplyScalar(P.speed);
        origin.y = a.pos.y + 0.3;
        this.spawnProj(a, 'galinha', origin, [v]);
        break;
      }
      case 'chinelo': {
        // ida reta na direção da mira (sem queda)
        const v = ld.clone().multiplyScalar(P.speed);
        this.spawnProj(a, 'chinelo', origin, [v]);
        st.out = true;
        break;
      }
      case 'bola': {
        // chute: a bola nasce baixa, na frente dos pés, e sai pra onde você olha
        origin.copy(eye).addScaledVector(dir, 0.85);
        origin.y -= 0.55;
        if (!this.g.world.visible(eye, origin)) origin.copy(eye).addScaledVector(dir, 0.2);
        const v = dir.clone();
        v.y += P.lift;
        v.normalize().multiplyScalar(P.speed);
        this.spawnProj(a, 'bola', origin, [v]);
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

  // ---- pipa com cerol

  private controlKite(a: Actor, st: SState, dt: number, trig: Trigger, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const P = SPECIALS.pipa.p;
    if (trig.pressed && st.cd <= 0) {
      st.cd = P.cd;
      if (st.kite) this.kiteOff(a, st);
      else if (st.ammo > 0) this.kiteOn(a, st, eye, dir);
    }
    const k = st.kite;
    if (!k) return;

    // a pipa gasta munição (segundos) enquanto está no ar
    st.ammo = Math.max(0, st.ammo - dt);
    a.specialAmmo = st.ammo;
    k.age += dt;

    // direção alvo = mira + viés pra cima (no começo, um empurrão extra: ela "sobe" pro céu); segue com atraso suave
    const hz = Math.hypot(dir.x, dir.z);
    let pitch = Math.asin(clamp(dir.y, -1, 1)) + P.bias + (k.age < P.launchT ? P.launchLift * (1 - k.age / P.launchT) : 0);
    pitch = clamp(pitch, -0.6, 1.45);
    const tgt = _k1;
    if (hz > 1e-3) tgt.set((dir.x / hz) * Math.cos(pitch), Math.sin(pitch), (dir.z / hz) * Math.cos(pitch));
    else tgt.set(k.dir.x, Math.sin(pitch), k.dir.z).normalize();
    k.dir.lerp(tgt, 1 - Math.exp(-P.follow * dt)).normalize();

    // a linha não atravessa parede: encurta se bater, estica devagar
    this.muzzle(eye, dir, k.hand);
    let want = P.len;
    const wh = this.g.world.raycast(k.hand, k.dir, P.len + 1);
    if (wh) want = Math.max(3, wh.dist - 0.7);
    k.len = want < k.len ? want : k.len + Math.min(want - k.len, 30 * dt);
    k.pos.copy(k.hand).addScaledVector(k.dir, k.len);
    // balanço de pipa
    _k2.crossVectors(k.dir, UP);
    if (_k2.lengthSq() < 1e-6) _k2.set(1, 0, 0);
    _k2.normalize();
    k.pos.addScaledVector(_k2, Math.sin(k.age * 2.3) * 0.45 * (k.len / P.len));
    k.pos.y += Math.sin(k.age * 1.7 + 1) * 0.35 * (k.len / P.len);

    // cerol: dano por segundo em quem encosta na linha (distância segmento–corpo)
    st.tickT -= dt;
    let hit = false;
    if (st.tickT <= 0) {
      st.tickT = Math.max(st.tickT + P.tick, 0);
      st.tickN++;
      const dmg = tickDmg(P.dps * P.tick, st.tickN);
      const world = this.g.world;
      for (const v of this.g.actors.values()) {
        if (v === a || !v.alive) continue;
        _k3.set(v.pos.x, v.pos.y + v.height, v.pos.z);
        const d = segSeg(k.hand, k.pos, v.pos, _k3, _k1, _k4);
        if (d > 0.3 + P.reach) continue;
        if (d > 0.05 && !world.visible(_k1, _k4)) continue;
        hit = true;
        const cut = _k4.clone();
        this.hurt(a, v, { dmg, weapon: 'pipa', point: cut, dir: _k2.subVectors(k.pos, k.hand).normalize(), confirm: false, impact: false });
        this.groupConfirm(a, st, dmg, v, cut);
      }
      k.hit = hit;
    }

    bus.emit('special:kite', { actorId: a.id, local: a.isLocal, on: true, origin: k.hand.clone(), kite: k.pos.clone(), hit: k.hit });
    k.netT -= dt;
    if (k.netT <= 0) {
      k.netT = 1 / 15;
      this.send({ t: 'kt', a: a.id, on: 1, o: v3(k.hand), k: v3(k.pos), h: k.hit ? 1 : 0 });
    }
    if (st.ammo <= 0) {
      this.kiteOff(a, st);
      this.finish(a);
    }
  }

  private kiteOn(a: Actor, st: SState, eye: THREE.Vector3, dir: THREE.Vector3): void {
    const hand = this.muzzle(eye, dir, new V());
    st.kite = { dir: dir.clone().normalize(), len: 3, pos: hand.clone().addScaledVector(dir, 3), hand, age: 0, netT: 0, hit: false };
    st.tickT = 0;
    bus.emit('special:fire', { actorId: a.id, local: a.isLocal, kind: 'pipa', origin: hand.clone(), dir: dir.clone(), charge: 0 });
    this.send({ t: 'fx', a: a.id, w: 'pipa', o: v3(hand), d: v3(dir), c: 0 });
    a.model?.onFire();
    if (a.isLocal) { this.g.camfx.addTrauma(0.12); this.fx.kickHeld(); }
  }

  private kiteOff(a: Actor, st: SState): void {
    if (!st.kite) return;
    const hand = st.kite.hand, pos = st.kite.pos;
    st.kite = null;
    bus.emit('special:kite', { actorId: a.id, local: a.isLocal, on: false, origin: hand.clone(), kite: pos.clone(), hit: false });
    this.send({ t: 'kt', a: a.id, on: 0, o: v3(hand), k: v3(pos) });
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
      bus.emit('special:beam', { actorId: a.id, local: a.isLocal, kind, on: true, origin, dir: dir.clone(), end: r.end, end2: r.end2, hit: r.hit, chop: st.chop });
      if (a.isLocal) this.fx.kickHeld(0.35);
      st.netT -= dt;
      if (st.netT <= 0) {
        st.netT = 1 / 15;
        this.send({ t: 'bm', a: a.id, w: kind, on: 1, o: v3(origin), d: v3(dir), e: v3(r.end), e2: r.end2 ? v3(r.end2) : undefined, h: r.hit ? 1 : 0, c: st.chop ? 1 : 0 });
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
          this.zap(a, st, target, tickDmg(P.dps * P.tick, st.tickN), tChest, shock);
          if (arc.v && arc.chest) this.zap(a, st, arc.v, tickDmg(P.arcDps * P.tick, st.tickN), arc.chest, shock);
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
        const dmg = tickDmg(P.dps * P.tick, st.tickN);
        const burning = this.status.left(v.id, 'burn') > 1.5;
        this.hurt(a, v, { dmg, weapon: 'rexona', point: chest, dir, st: burning ? undefined : 'burn', sd: P.burn, confirm: false, impact: false });
        this.groupConfirm(a, st, dmg, v, chest);
      });
      return { end, end2: null, hit };
    }

    if (st.id === 'cafe') {
      // jato de café fervendo: dano alto, escalda (burn) e embaça a tela (steam)
      const wh = world.raycast(eye, dir, P.range);
      end = wh ? wh.point.clone() : eye.clone().addScaledVector(dir, P.range);
      this.inCone(a, eye, dir, P.range, P.cone, (v, _d2, chest) => {
        hit = true;
        if (!doTick) return;
        const dmg = tickDmg(P.dps * P.tick, st.tickN);
        const burning = this.status.left(v.id, 'burn') > 1.2;
        const steamy = this.status.left(v.id, 'steam') > 0.9;
        this.hurt(a, v, {
          dmg, weapon: 'cafe', point: chest, dir, confirm: false, impact: false,
          st: burning ? undefined : 'burn', sd: P.burn, st2: steamy ? undefined : 'steam', sd2: P.steam,
        });
        this.groupConfirm(a, st, dmg, v, chest);
      });
      return { end, end2: null, hit };
    }

    // ventilador
    const wh = world.raycast(eye, dir, P.range);
    end = wh ? wh.point.clone() : eye.clone().addScaledVector(dir, P.range);
    if (doTick) {
      // vento forte no cone todo (dps) e, bem perto, a hélice picota (chopDps). Empurra e marca a vítima (queda = kill).
      const wind = tickDmg(P.dps * P.tick, st.tickN), chopD = tickDmg(P.chopDps * P.tick, st.tickN);
      let chopped = false;
      this.inCone(a, eye, dir, P.range, P.cone, (v, dist, chest) => {
        hit = true;
        const chop = dist < P.chopRange;
        if (chop) chopped = true;
        const f = 1 - 0.65 * (dist / P.range);
        _e.set(dir.x, 0, dir.z);
        _f.set(chest.x - eye.x, 0, chest.z - eye.z);
        if (_e.lengthSq() < 1e-4) _e.copy(_f);
        _e.normalize().multiplyScalar(0.6).addScaledVector(_f.normalize(), 0.4).normalize();
        const push = P.push * f * (chop ? P.chopPush : 1);
        const dmg = chop ? chopD : wind;
        this.hurt(a, v, {
          dmg, weapon: 'ventilador', point: chest, dir, confirm: false, impact: false,
          imp: { v: [r2(_e.x * push), 0, r2(_e.z * push)], cap: P.cap, minY: P.lift * (0.6 + 0.4 * f), fall: true },
        });
        this.groupConfirm(a, st, dmg, v, chest);
      });
      st.chop = chopped;
      st.lastHit = hit;
    } else {
      hit = st.lastHit;
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
    o: {
      dmg: number; head?: boolean; weapon: SpecialId; point?: THREE.Vector3; dir?: THREE.Vector3; imp?: DamageRequest['imp'];
      st?: StatusKind; sd?: number; st2?: StatusKind; sd2?: number; confirm?: boolean; impact?: boolean;
    },
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
    if (o.st2) { r.st2 = o.st2; r.sd2 = o.sd2; }
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
        // one shot em qualquer parte do corpo
        const P = SPECIALS.tijolo.p;
        this.hurt(shooter, victim, { dmg: P.dmg, head, weapon: 'tijolo', point, dir });
        killed = P.dmg >= hp0;
        break;
      }
      case 'bola': {
        // dano cresce com a velocidade; na cabeça, rápida, mata na hora: GOLAÇO. Atravessa e pode acertar vários.
        const P = SPECIALS.bola.p;
        const speed = p.vel.length();
        p.hitCool?.set(victim.id, p.age + P.hitCool);
        const golaco = head && speed >= P.headMinSpeed;
        const dmg = golaco ? 999 : clamp(speed * P.dmgPerSpeed, P.dmgMin, P.dmgMax);
        this.hurt(shooter, victim, { dmg, head, weapon: 'bola', point, dir });
        killed = dmg >= hp0;
        p.vel.multiplyScalar(P.carry);
        p.vel.y += golaco ? 4 : 1.5;
        if (golaco) {
          bus.emit('special:golaco', { actorId: shooter.id, local: shooter.isLocal, victimId: victim.id, pos: point.clone(), speed });
          this.send({ t: 'gl', a: shooter.id, v: victim.id, p: v3(point), s: r2(speed) });
          if (shooter.isLocal) { this.g.camfx.addTrauma(0.55); this.g.camfx.punchFov(-5); }
        }
        break;
      }
      case 'bottle':
      case 'rojao':
        break; // explodem no ended()
      case 'galinha': {
        const P = SPECIALS.galinha.p;
        this.hurt(shooter, victim, { dmg: P.dmg, head, weapon: 'galinha', point, dir });
        killed = P.dmg >= hp0;
        break;
      }
      case 'pombo': {
        const P = SPECIALS.pombo.p;
        this.hurt(shooter, victim, { dmg: P.dmg, weapon: 'pombo', point, dir, st: 'blind', sd: P.blind });
        killed = P.dmg >= hp0;
        break;
      }
      case 'chinelo': {
        const dmg = SPECIALS.chinelo.p.dmg; // metade da vida máxima: ida + volta matam
        this.hurt(shooter, victim, { dmg, head, weapon: 'chinelo', point, dir });
        killed = dmg >= hp0;
        break;
      }
      default:
        break;
    }
    if (p.kind !== 'bottle' && p.kind !== 'rojao') bus.emit('special:hit', { kind: p.kind, pos: point.clone(), victimId: victim.id, headshot: head, killed });
    return p.kind !== 'chinelo' && p.kind !== 'bola' && p.kind !== 'galinha';
  }

  ended(p: Proj, why: EndReason): void {
    const boom = p.kind === 'bottle' || p.kind === 'panela' || p.kind === 'rojao';
    if (p.auth) {
      this.send({ t: 'pe', a: p.owner, n: p.n, p: v3(p.pos), w: END_CODE[boom ? 'explode' : why] });
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

  /** Gêiser de Dolly / feijão da panela / estouro do rojão. Só quem atirou calcula dano e knockback. */
  private explode(p: Proj): void {
    const g = this.g;
    const weapon: SpecialId = p.kind === 'bottle' ? 'dolly' : p.kind === 'rojao' ? 'rojao' : 'panela';
    const P = SPECIALS[weapon].p;
    const center = p.pos.clone();
    bus.emit('special:explode', { kind: weapon as 'dolly' | 'panela' | 'rojao', pos: center, radius: P.radius });

    const l = g.local;
    if (l?.alive) {
      const d = l.pos.distanceTo(center);
      g.camfx.addTrauma(Math.max(0, 1 - d / 28) * 0.7);
    }
    if (!p.auth) return;
    const shooter = g.actors.get(p.owner);
    if (!shooter) return;
    const R = P.radius + 0.4;
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
