import { MAX_HP, type Actor } from './Actor';
import { isSpecialId, SPECIAL_IDS, SPECIALS, type AnyWeaponId, type SpecialId, type StatusKind } from './special/defs';
import { ARMOR_ABSORB, canBuy, isShopItem, KILL_REWARD, LADDER, ladderWeapon, PRICE, START_MONEY, type ShopItemId } from './shop';
import type { WeaponId } from './weaponDefs';

export type V3 = [number, number, number];

/**
 * Eventos de partida, serializáveis (vão pela rede do host para todos).
 * O host decide; todo mundo (inclusive o host) aplica via Game.applyMatchEvent.
 */
export type MatchEvent =
  | { t: 'damage'; attacker: string; victim: string; dmg: number; hp: number; headshot: boolean; weapon: AnyWeaponId; dir: V3 }
  | { t: 'kill'; killer: string; victim: string; weapon: AnyWeaponId; headshot: boolean }
  /** Dinheiro de `id` mudou (kill, entrada na partida). */
  | { t: 'money'; id: string; money: number }
  /** Nível de `id` na escada de malucas. */
  | { t: 'level'; id: string; level: number }
  /** Colete de `id` absorveu dano. */
  | { t: 'armor'; id: string; armor: number }
  /** `id` comprou `item` e ficou com `money`. Arma comum substitui a maluca; extras agem na hora. */
  | { t: 'buy'; id: string; item: ShopItemId; money: number }
  | { t: 'spawn'; id: string; pos: V3; yaw: number; weapon: WeaponId }
  | { t: 'end'; winner: string }
  | { t: 'start' }
  // ---- armas malucas (host decide spawn e coleta)
  | { t: 'pickup-spawn'; id: number; kind: SpecialId; pos: V3 }
  /** actor '' = o pickup expirou sem ninguém pegar. */
  | { t: 'pickup-take'; id: number; actor: string }
  /** `actor` equipou a arma maluca `kind` com `ammo` de munição. */
  | { t: 'special'; actor: string; kind: SpecialId; ammo: number }
  /** A arma maluca de `actor` acabou (munição) e ele volta pra arma do gun game. Morte/respawn limpam sozinhos. */
  | { t: 'special-end'; actor: string }
  /** Knockback/vento: `vel` é somado à velocidade da vítima NA MÁQUINA DELA (jogador) ou no host (bot). */
  | { t: 'impulse'; victim: string; vel: V3; cap?: number; minY?: number; by?: string; weapon?: SpecialId; fall?: boolean }
  /** `weapon`: arma que aplicou (queimadura de café/Rexona conta o kill para a arma certa). */
  | { t: 'status'; victim: string; kind: StatusKind; dur: number; by?: string; weapon?: SpecialId };

/** Pedido de dano (cliente → host). O cliente que atira decide o acerto (somos amigos, sem anti-cheat). */
export interface DamageRequest {
  attacker: string;
  victim: string;
  dmg: number;
  headshot: boolean;
  weapon: AnyWeaponId;
  dir: V3;
  /** Knockback (m/s somados), com teto de velocidade horizontal e velocidade vertical mínima opcionais. `fall`: marca "empurrado" (queda contará como kill de quem empurrou). */
  imp?: { v: V3; cap?: number; minY?: number; fall?: boolean };
  /** Status a aplicar e sua duração (s). */
  st?: StatusKind;
  sd?: number;
  /** Segundo status no mesmo acerto (café: queimadura + vapor). */
  st2?: StatusKind;
  sd2?: number;
}

export interface MatchHost {
  actors(): Iterable<Actor>;
  getActor(id: string): Actor | undefined;
  pickSpawn(forId: string): { pos: V3; yaw: number };
  /** 'gungame' = modo da loja (id antigo). */
  mode(): 'gungame' | 'treino';
  /** Aplica localmente e (se for host em rede) envia para todos. */
  publish(e: MatchEvent): void;
}

const STATUS_KINDS: StatusKind[] = ['burn', 'shock', 'blind', 'stun', 'steam'];

export const RESPAWN_TIME = 2.5;
const END_TIME = 7;
const TREINO_WEAPONS: WeaponId[] = ['smg', 'rifle', 'shotgun', 'sniper', 'pistol'];
/** Bots olham a loja de tempos em tempos. */
const BOT_SHOP_EVERY = 2;

/** Lógica autoritativa (só roda no host / offline). */
export class Match {
  private respawns = new Map<string, number>();
  private endTimer = 0;
  private botShopT = new Map<string, number>();
  ended = false;
  time = 0;

  constructor(private host: MatchHost) {}

  weaponFor(a: Actor): WeaponId {
    if (this.host.mode() === 'gungame') return 'knife'; // por baixo da maluca, que é a arma da mão
    return a.isBot ? TREINO_WEAPONS[Math.floor(Math.random() * TREINO_WEAPONS.length)] : a.weapon;
  }

  spawn(a: Actor): void {
    const s = this.host.pickSpawn(a.id);
    this.respawns.delete(a.id);
    this.host.publish({ t: 'spawn', id: a.id, pos: s.pos, yaw: s.yaw, weapon: this.weaponFor(a) });
    // Escada: nasce com a maluca do seu nível (a comum comprada ficou pra trás ao morrer).
    if (this.host.mode() === 'gungame') {
      const kind = ladderWeapon(a.level);
      this.host.publish({ t: 'special', actor: a.id, kind, ammo: SPECIALS[kind].ammo });
    } else if (a.isBot) {
      // Treino: bot também nasce com uma arma maluca (sorteada) em vez da comum
      const kind = SPECIAL_IDS[Math.floor(Math.random() * SPECIAL_IDS.length)];
      this.host.publish({ t: 'special', actor: a.id, kind, ammo: SPECIALS[kind].ammo });
    }
  }

  /** Novo participante entra já vivo. */
  join(a: Actor): void {
    if (this.host.mode() === 'gungame') {
      this.host.publish({ t: 'level', id: a.id, level: 0 });
      this.host.publish({ t: 'money', id: a.id, money: START_MONEY });
    }
    this.spawn(a);
  }

  leave(id: string): void {
    this.respawns.delete(id);
    this.botShopT.delete(id);
  }

  /** Host: `a` quer comprar `item`. Valida modo, vida, dinheiro e se faz sentido (já tem, vida cheia...). */
  buy(a: Actor, item: unknown): void {
    if (this.host.mode() !== 'gungame' || this.ended || !isShopItem(item) || canBuy(a, item) !== 'ok') return;
    this.host.publish({ t: 'buy', id: a.id, item, money: a.money - PRICE[item] });
  }

  /** Bot: só cura e colete. Fica sempre com a maluca da escada (nunca compra arma comum). */
  private botShop(a: Actor): void {
    if (a.hp < MAX_HP * 0.5) { this.buy(a, 'vida'); return; }
    if (a.armor <= 0) this.buyIf(a, 'colete');
  }

  private buyIf(a: Actor, item: ShopItemId): boolean {
    if (canBuy(a, item) !== 'ok') return false;
    this.buy(a, item);
    return true;
  }

  start(): void {
    this.ended = false;
    this.host.publish({ t: 'start' });
    // o evento 'start' já devolveu o dinheiro inicial a todos
    for (const a of this.host.actors()) this.spawn(a);
  }

  applyDamage(r: DamageRequest): void {
    if (this.ended) return;
    const v = this.host.getActor(r.victim);
    if (!v || !v.alive) return;
    const a = this.host.getActor(r.attacker);
    let dmg = Number.isFinite(r.dmg) ? Math.max(0, r.dmg) : 0;
    // colete absorve parte do dano até acabar
    if (v.armor > 0 && dmg > 0) {
      const ab = Math.min(v.armor, dmg * ARMOR_ABSORB);
      dmg -= ab;
      this.host.publish({ t: 'armor', id: v.id, armor: Math.round(v.armor - ab) });
    }
    const hp = Math.max(0, Math.round(v.hp - dmg));
    if (dmg > 0) {
      this.host.publish({ t: 'damage', attacker: r.attacker, victim: r.victim, dmg, hp, headshot: r.headshot, weapon: r.weapon, dir: r.dir });
    }
    if (hp > 0) {
      this.applyExtras(r, v);
      return;
    }

    this.host.publish({ t: 'kill', killer: r.attacker, victim: r.victim, weapon: r.weapon, headshot: r.headshot });
    this.respawns.set(v.id, this.time + RESPAWN_TIME);

    if (this.host.mode() !== 'gungame' || !a || a === v) return;
    this.host.publish({ t: 'money', id: a.id, money: a.money + KILL_REWARD });
    // cada kill sobe um nível na escada; matar no último nível vence
    const level = a.level + 1;
    if (level >= LADDER.length) {
      this.host.publish({ t: 'end', winner: a.id });
      this.ended = true;
      this.endTimer = END_TIME;
      return;
    }
    this.host.publish({ t: 'level', id: a.id, level });
  }

  /** Knockback e status que acompanham um acerto (valores saneados: o pedido pode vir de um cliente). */
  private applyExtras(r: DamageRequest, v: Actor): void {
    const sp = isSpecialId(r.weapon) ? r.weapon : undefined;
    if (r.imp && Array.isArray(r.imp.v)) {
      const [x, y, z] = r.imp.v.map((n) => (Number.isFinite(n) ? Math.max(-40, Math.min(40, n)) : 0));
      this.host.publish({
        t: 'impulse', victim: v.id, vel: [x, y, z], cap: r.imp.cap, minY: r.imp.minY, by: r.attacker, weapon: sp, fall: !!r.imp.fall,
      });
    }
    for (const [kind, sd] of [[r.st, r.sd], [r.st2, r.sd2]] as const) {
      if (!kind || !STATUS_KINDS.includes(kind)) continue;
      const dur = Math.max(0.1, Math.min(6, Number.isFinite(sd) ? sd! : 1));
      this.host.publish({ t: 'status', victim: v.id, kind, dur, by: r.attacker, weapon: sp });
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.start();
      return;
    }
    if (this.host.mode() === 'gungame') {
      for (const a of this.host.actors()) {
        if (!a.isBot || !a.alive) continue;
        const t = (this.botShopT.get(a.id) ?? BOT_SHOP_EVERY * Math.random()) - dt;
        this.botShopT.set(a.id, t <= 0 ? BOT_SHOP_EVERY : t);
        if (t <= 0) this.botShop(a);
      }
    }
    for (const [id, at] of this.respawns) {
      if (this.time < at) continue;
      const a = this.host.getActor(id);
      if (a) this.spawn(a);
      else this.respawns.delete(id);
    }
  }
}
