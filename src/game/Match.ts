import type { Actor } from './Actor';
import { isSpecialId, type AnyWeaponId, type SpecialId, type StatusKind } from './special/defs';
import { GUNGAME_LADDER, killsNeeded, type WeaponId } from './weaponDefs';

export type V3 = [number, number, number];

/**
 * Eventos de partida, serializáveis (vão pela rede do host para todos).
 * O host decide; todo mundo (inclusive o host) aplica via Game.applyMatchEvent.
 */
export type MatchEvent =
  | { t: 'damage'; attacker: string; victim: string; dmg: number; hp: number; headshot: boolean; weapon: AnyWeaponId; dir: V3 }
  | { t: 'kill'; killer: string; victim: string; weapon: AnyWeaponId; headshot: boolean }
  | { t: 'level'; id: string; level: number; levelKills: number }
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
  | { t: 'status'; victim: string; kind: StatusKind; dur: number; by?: string };

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
}

export interface MatchHost {
  actors(): Iterable<Actor>;
  getActor(id: string): Actor | undefined;
  pickSpawn(forId: string): { pos: V3; yaw: number };
  mode(): 'gungame' | 'treino';
  /** Aplica localmente e (se for host em rede) envia para todos. */
  publish(e: MatchEvent): void;
}

const STATUS_KINDS: StatusKind[] = ['burn', 'shock', 'blind', 'stun'];

export const RESPAWN_TIME = 2.5;
const END_TIME = 7;
const TREINO_WEAPONS: WeaponId[] = ['smg', 'rifle', 'shotgun', 'sniper', 'pistol'];

/** Lógica autoritativa (só roda no host / offline). */
export class Match {
  private respawns = new Map<string, number>();
  private endTimer = 0;
  ended = false;
  time = 0;

  constructor(private host: MatchHost) {}

  weaponFor(a: Actor): WeaponId {
    if (this.host.mode() === 'gungame') return GUNGAME_LADDER[Math.min(a.level, GUNGAME_LADDER.length - 1)];
    return a.isBot ? TREINO_WEAPONS[Math.floor(Math.random() * TREINO_WEAPONS.length)] : a.weapon;
  }

  spawn(a: Actor): void {
    const s = this.host.pickSpawn(a.id);
    this.respawns.delete(a.id);
    this.host.publish({ t: 'spawn', id: a.id, pos: s.pos, yaw: s.yaw, weapon: this.weaponFor(a) });
  }

  /** Novo participante entra já vivo. */
  join(a: Actor): void {
    if (this.host.mode() === 'gungame') this.host.publish({ t: 'level', id: a.id, level: 0, levelKills: 0 });
    this.spawn(a);
  }

  leave(id: string): void {
    this.respawns.delete(id);
  }

  start(): void {
    this.ended = false;
    this.host.publish({ t: 'start' });
    for (const a of this.host.actors()) {
      this.host.publish({ t: 'level', id: a.id, level: 0, levelKills: 0 });
      this.spawn(a);
    }
  }

  applyDamage(r: DamageRequest): void {
    if (this.ended) return;
    const v = this.host.getActor(r.victim);
    if (!v || !v.alive) return;
    const a = this.host.getActor(r.attacker);
    const dmg = Number.isFinite(r.dmg) ? Math.max(0, r.dmg) : 0;
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

    if (this.host.mode() !== 'gungame') return;
    // Kill com arma maluca não sobe nível: só as armas da escada contam no gun game.
    if (a && a !== v && !isSpecialId(r.weapon)) {
      let level = a.level, lk = a.levelKills + 1;
      if (lk >= killsNeeded(level)) { level++; lk = 0; }
      if (level >= GUNGAME_LADDER.length) {
        this.host.publish({ t: 'end', winner: a.id });
        this.ended = true;
        this.endTimer = END_TIME;
        return;
      }
      this.host.publish({ t: 'level', id: a.id, level, levelKills: lk });
      // Troca a arma na hora (gun game): o spawn não muda posição, só arma, via evento 'level'.
    }
    // Morreu pra faca: perde um nível.
    if (r.weapon === 'knife' && v.level > 0) this.host.publish({ t: 'level', id: v.id, level: v.level - 1, levelKills: 0 });
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
    if (r.st && STATUS_KINDS.includes(r.st)) {
      const dur = Math.max(0.1, Math.min(6, Number.isFinite(r.sd) ? r.sd! : 1));
      this.host.publish({ t: 'status', victim: v.id, kind: r.st, dur, by: r.attacker });
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (this.ended) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.start();
      return;
    }
    for (const [id, at] of this.respawns) {
      if (this.time < at) continue;
      const a = this.host.getActor(id);
      if (a) this.spawn(a);
      else this.respawns.delete(id);
    }
  }
}
