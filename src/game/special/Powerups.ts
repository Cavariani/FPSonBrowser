import * as THREE from 'three';
import { bus } from '../../core/events';
import { MAX_HP, type Actor } from '../Actor';
import type { MatchEvent, V3 } from '../Match';
import { ARMOR_MAX } from '../shop';

/**
 * Powerups fixos no mapa, estilo Doom/Quake: ficam sempre nos mesmos pontos e voltam um tempo depois de pegos.
 * Só no modo da loja. Tudo é número de jogo: mexa à vontade.
 */
export type PowerId = 'marmita' | 'capacete' | 'energetico' | 'pilha' | 'pix' | 'cachaca';
/** Buffs com tempo (segundos restantes em `Actor.buffs`). */
export type BuffKind = 'speed' | 'ammo' | 'dmg';

export interface PowerDef {
  id: PowerId;
  name: string;
  /** Texto curto no HUD ao pegar. */
  msg: string;
  /** Cor 0xRRGGBB (feixe, minimapa, HUD). */
  color: number;
  /** Segundos até voltar ao mapa depois de pego. */
  respawn: number;
  /** Buff de tempo que concede (e por quantos segundos). */
  buff?: { kind: BuffKind; dur: number };
}

export const POWERS: Record<PowerId, PowerDef> = {
  marmita: { id: 'marmita', name: 'Marmita', msg: '+50 VIDA', color: 0xff4d4d, respawn: 20 },
  capacete: { id: 'capacete', name: 'Capacete de Obra', msg: '+50 COLETE', color: 0x6ec1ff, respawn: 25 },
  energetico: { id: 'energetico', name: 'Energético', msg: 'VELOCIDADE!', color: 0xfff23a, respawn: 40, buff: { kind: 'speed', dur: 10 } },
  pilha: { id: 'pilha', name: 'Pilha Eterna', msg: 'MUNIÇÃO INFINITA!', color: 0x3fd23f, respawn: 40, buff: { kind: 'ammo', dur: 10 } },
  pix: { id: 'pix', name: 'PIX', msg: '+$300 NO PIX', color: 0x28ffa8, respawn: 25 },
  cachaca: { id: 'cachaca', name: 'Cachaça', msg: 'DANO DOBRADO!', color: 0xd9a441, respawn: 60, buff: { kind: 'dmg', dur: 12 } },
};

export const HEAL_AMOUNT = 50;
export const ARMOR_AMOUNT = 50;
export const PIX_AMOUNT = 300;
export const SPEED_MULT = 1.4;
export const DMG_MULT = 2;
/** Nome do buff no HUD. */
export const BUFF_NAME: Record<BuffKind, string> = { speed: 'ENERGÉTICO', ammo: 'MUNIÇÃO INFINITA', dmg: 'DANO x2' };
export const BUFF_COLOR: Record<BuffKind, number> = { speed: POWERS.energetico.color, ammo: POWERS.pilha.color, dmg: POWERS.cachaca.color };

/** Quantos itens e quais (a ordem espalha os raros pelo mapa). */
const LAYOUT: PowerId[] = ['marmita', 'pix', 'capacete', 'marmita', 'energetico', 'pix', 'marmita', 'pilha', 'capacete', 'pix', 'cachaca', 'marmita'];

/** Raio de coleta (horizontal) para quem simula localmente; o host aceita pedidos de clientes até `POWER_VALIDATE`. */
export const POWER_RADIUS = 1.5;
export const POWER_VALIDATE = 3.6;

export interface PowerInfo {
  id: number;
  kind: PowerId;
  pos: V3;
}

interface Item extends PowerInfo {
  model: THREE.Object3D;
  seed: number;
}

interface Spot {
  pos: V3;
  kind: PowerId;
  /** Id do item no mapa agora, ou null se está esperando voltar. */
  id: number | null;
  /** Relógio do host em que volta. */
  at: number;
}

export interface PowerHostCtx {
  /** Pontos candidatos (nós de navegação do mapa). */
  nodes: THREE.Vector3[];
  /** Actors simulados nesta máquina que coletam sozinhos (jogador local e bots). */
  collectors: Iterable<Actor>;
  publish(e: MatchEvent): void;
}

/** O item serve pra `a` agora? (marmita com vida cheia fica no mapa pra quem precisa.) */
export function powerUseful(a: Actor, kind: PowerId): boolean {
  if (kind === 'marmita') return a.hp < MAX_HP;
  if (kind === 'capacete') return a.armor < ARMOR_MAX;
  return true;
}

/**
 * Host: decide pontos, respawn e quem pegou. Todos: desenham os itens.
 */
export class PowerupSystem {
  readonly items = new Map<number, Item>();
  private spots: Spot[] = [];
  private nextId = 1;
  private t = 0;
  private visT = 0;
  enabled = true;

  constructor(private scene: THREE.Scene, private build: (k: PowerId) => THREE.Object3D) {}

  list(): PowerInfo[] {
    return [...this.items.values()].map((i) => ({ id: i.id, kind: i.kind, pos: i.pos }));
  }

  // ---------------------------------------------------------------- estado (todos)

  applySpawn(id: number, kind: PowerId, pos: V3): void {
    if (this.items.has(id) || !POWERS[kind]) return;
    const model = this.build(kind);
    model.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(model);
    this.items.set(id, { id, kind, pos, model, seed: Math.random() * 6.28 });
    if (id >= this.nextId) this.nextId = id + 1;
  }

  /** Remove o item e devolve o que era (para o chamador saber o efeito). */
  applyTake(id: number): PowerInfo | null {
    const it = this.items.get(id);
    if (!it) return null;
    this.scene.remove(it.model);
    this.items.delete(id);
    return { id: it.id, kind: it.kind, pos: it.pos };
  }

  applyList(list: PowerInfo[]): void {
    this.clear();
    for (const p of list) this.applySpawn(p.id, p.kind, p.pos);
  }

  clear(): void {
    for (const it of this.items.values()) this.scene.remove(it.model);
    this.items.clear();
  }

  // ---------------------------------------------------------------- host

  /** Nova partida: todos os itens voltam já. */
  resetSpots(): void {
    for (const s of this.spots) { s.id = null; s.at = 0; }
  }

  /** Espalha os pontos pelo mapa: cada novo é o mais longe dos já escolhidos (amostragem do mais distante). */
  private plan(nodes: THREE.Vector3[]): void {
    if (!nodes.length) return;
    const chosen: THREE.Vector3[] = [nodes[0]];
    while (chosen.length < Math.min(LAYOUT.length, nodes.length)) {
      let best = nodes[0], bd = -1;
      for (const n of nodes) {
        let d = Infinity;
        for (const c of chosen) d = Math.min(d, Math.hypot(n.x - c.x, n.z - c.z));
        if (d > bd) { bd = d; best = n; }
      }
      chosen.push(best);
    }
    this.spots = chosen.map((c, i) => ({ pos: [round(c.x), round(c.y + 0.95), round(c.z)] as V3, kind: LAYOUT[i], id: null, at: 0 }));
  }

  hostUpdate(dt: number, ctx: PowerHostCtx): void {
    this.t += dt;
    if (!this.spots.length) this.plan(ctx.nodes);
    for (const s of this.spots) {
      if (s.id === null && this.t >= s.at) {
        s.id = this.nextId++;
        ctx.publish({ t: 'power-spawn', id: s.id, kind: s.kind, pos: s.pos });
      }
    }
    for (const a of ctx.collectors) {
      if (!a.alive) continue;
      for (const it of this.items.values()) {
        if (Math.abs(a.pos.y + 0.9 - it.pos[1]) > 2 || !powerUseful(a, it.kind)) continue;
        if (Math.hypot(a.pos.x - it.pos[0], a.pos.z - it.pos[2]) <= POWER_RADIUS) {
          this.take(it.id, a, ctx.publish);
          break;
        }
      }
    }
  }

  /** Host: `actor` quer pegar o item `id`. Valida distância, vida e se ainda existe. */
  tryTake(id: number, actor: Actor, publish: (e: MatchEvent) => void, maxDist = POWER_VALIDATE): boolean {
    const it = this.items.get(id);
    if (!it || !actor.alive || !powerUseful(actor, it.kind)) return false;
    if (Math.abs(actor.pos.y + 0.9 - it.pos[1]) > 3) return false;
    if (Math.hypot(actor.pos.x - it.pos[0], actor.pos.z - it.pos[2]) > maxDist) return false;
    this.take(id, actor, publish);
    return true;
  }

  private take(id: number, a: Actor, publish: (e: MatchEvent) => void): void {
    const it = this.items.get(id);
    if (!it) return;
    const spot = this.spots.find((s) => s.id === id);
    if (spot) { spot.id = null; spot.at = this.t + POWERS[it.kind].respawn; }
    publish({ t: 'power-take', id, actor: a.id });
    const def = POWERS[it.kind];
    if (it.kind === 'marmita') publish({ t: 'heal', id: a.id, hp: Math.min(MAX_HP, a.hp + HEAL_AMOUNT) });
    else if (it.kind === 'capacete') publish({ t: 'armor', id: a.id, armor: Math.min(ARMOR_MAX, a.armor + ARMOR_AMOUNT) });
    else if (it.kind === 'pix') publish({ t: 'money', id: a.id, money: a.money + PIX_AMOUNT });
    if (def.buff) publish({ t: 'buff', id: a.id, kind: def.buff.kind, dur: def.buff.dur });
  }

  /** Item mais próximo de (x,z) — usado pelos bots. */
  nearest(x: number, z: number, maxDist: number, wants?: (k: PowerId) => boolean): PowerInfo | null {
    let best: Item | null = null, bd = maxDist;
    for (const it of this.items.values()) {
      if (wants && !wants(it.kind)) continue;
      const d = Math.hypot(it.pos[0] - x, it.pos[2] - z);
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { id: best.id, kind: best.kind, pos: best.pos } : null;
  }

  // ---------------------------------------------------------------- visual

  visual(dt: number): void {
    this.visT += dt;
    for (const it of this.items.values()) {
      const m = it.model;
      m.position.y = it.pos[1] + Math.sin(this.visT * 2.2 + it.seed) * 0.12;
      const spin = m.userData.spin as THREE.Object3D | undefined;
      (spin ?? m).rotation.y += dt * 1.8;
      (m.userData.update as ((t: number, dt: number) => void) | undefined)?.(this.visT + it.seed, dt);
    }
  }
}

/** Efeito/feedback local de pegar um item (HUD e som escutam). */
export function emitTake(kind: PowerId, actorId: string, local: boolean): void {
  bus.emit('power:take', { kind, actorId, local });
}

const round = (n: number) => Math.round(n * 100) / 100;
