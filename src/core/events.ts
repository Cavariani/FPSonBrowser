import type { Vector3 } from 'three';
import type { WeaponId } from '../game/weaponDefs';
import type { BeamKind, ProjKind, SpecialId, StatusKind } from '../game/special/defs';

/**
 * Barramento de eventos do jogo. Gameplay emite, apresentação (som, efeitos, HUD, viewmodel) escuta.
 * Vetores enviados são cópias: quem escuta pode guardar, mas não deve mutar.
 * `local: true` = evento causado pelo jogador desta máquina (som 2D, kick de câmera etc).
 */
export interface GameEvents {
  'weapon:fire': { actorId: string; local: boolean; weapon: WeaponId; origin: Vector3; dirs: Vector3[]; ends: Vector3[] };
  'weapon:impact': { point: Vector3; normal: Vector3; surface: 'world' | 'flesh'; material?: string };
  'weapon:dryfire': { weapon: WeaponId };
  'weapon:reload': { weapon: WeaponId; duration: number };
  'weapon:reloaded': { weapon: WeaponId };
  'weapon:switch': { to: WeaponId; duration: number };
  'weapon:melee': { actorId: string; local: boolean; weapon: WeaponId; hit: boolean; heavy: boolean; origin: Vector3 };
  'weapon:zoom': { active: boolean; fov: number };
  /** O jogador local acertou alguém. */
  'hit:confirm': { damage: number; headshot: boolean; killed: boolean; point: Vector3 };
  /** Alguém morreu (qualquer actor). */
  kill: { killerId: string; killer: string; victimId: string; victim: string; weapon: WeaponId; headshot: boolean; localKiller: boolean; localVictim: boolean };
  /** Um actor (não-local) tomou dano: usado para som de dor/flash no modelo. */
  'actor:hurt': { actorId: string; pos: Vector3; damage: number; headshot: boolean };
  'actor:death': { actorId: string; pos: Vector3; dir: Vector3; headshot: boolean };
  'actor:spawn': { actorId: string; pos: Vector3 };
  'actor:footstep': { actorId: string; pos: Vector3 };
  'player:footstep': { speed: number };
  'player:jump': {};
  'player:land': { impact: number };
  'player:damage': { amount: number; fromDir: Vector3 | null; health: number };
  'player:death': { killer: string; weapon: WeaponId };
  'player:respawn': {};
  'gungame:level': { level: number; total: number; weapon: WeaponId; up: boolean };
  'match:end': { winner: string; winnerIsLocal: boolean };
  'match:start': {};

  // ---------------------------------------------------------------- armas malucas (pickups)
  // Obs.: `kill.weapon` e `damage` podem trazer um SpecialId (em runtime) quando a arma foi uma maluca.
  // `WEAPONS[id]` / `anyWeaponDef(id)` respondem pelos dois tipos de id.

  /** Um pickup apareceu no mapa (pos = centro flutuante). */
  'special:spawn': { id: number; kind: SpecialId; pos: Vector3 };
  /** Um pickup sumiu sem ninguém pegar (expirou). */
  'special:expire': { id: number; kind: SpecialId; pos: Vector3 };
  /** Alguém pegou uma arma maluca (e equipou na hora). */
  'special:pickup': { actorId: string; local: boolean; kind: SpecialId; pos: Vector3 };
  /** Acabou a munição / morreu / trocou: a arma maluca saiu da mão. */
  'special:end': { actorId: string; local: boolean; kind: SpecialId };
  /** Chinelo voltou pra mão de quem jogou. */
  'special:catch': { actorId: string; local: boolean };
  /** Uso discreto (arremesso, estilingada, rajada de coxinha, pombo solto, chinelo lançado). */
  'special:fire': { actorId: string; local: boolean; kind: SpecialId; origin: Vector3; dir: Vector3; charge?: number };
  /** Estilingue esticando (0..1), a cada frame enquanto segura. */
  'special:charge': { actorId: string; local: boolean; charge: number };
  /**
   * Raio/jato contínuo (lorenzetti, rexona, ventilador). Emitido todo frame no atirador e ~15 Hz nos remotos
   * enquanto `on`. `on:false` = parou. `end` = ponto final; `end2` = ponto do arco elétrico (só lorenzetti).
   */
  'special:beam': {
    actorId: string; local: boolean; kind: BeamKind; on: boolean;
    origin: Vector3; dir: Vector3; end: Vector3; end2: Vector3 | null; hit: boolean;
  };
  /** Projétil quicou (speed = velocidade de impacto em m/s). */
  'special:bounce': { kind: ProjKind; pos: Vector3; speed: number };
  /** Garrafa Dolly ou panela explodiu. */
  'special:explode': { kind: 'dolly' | 'panela'; pos: Vector3; radius: number };
  /** Projétil acertou alguém. */
  'special:hit': { kind: ProjKind; pos: Vector3; victimId: string; headshot: boolean; killed: boolean };
  /** Panela de pressão (ou garrafa Dolly chacoalhando) chiando, a cada ~0.1-0.3 s. progress 0..1 até explodir. */
  'special:hiss': { kind: 'panela' | 'bottle'; pos: Vector3; progress: number };
  /** Coxinha caiu no chão e ficou lá. */
  'special:stick': { pos: Vector3; normal: Vector3 };
  /** Efeito de status aplicado em alguém. `local` = é você. */
  'status:apply': { actorId: string; local: boolean; kind: StatusKind; dur: number };
  'status:end': { actorId: string; local: boolean; kind: StatusKind };
  /** Alguém levou knockback / vento. */
  impulse: { actorId: string; local: boolean; vel: Vector3 };
}

type Handler<T> = (payload: T) => void;

export class Bus<E> {
  private handlers = new Map<keyof E, Set<Handler<any>>>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[bus] handler de "${String(type)}" falhou`, err);
      }
    }
  }
}

export const bus = new Bus<GameEvents>();
