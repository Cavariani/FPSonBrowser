import type { Game } from '../game/Game';
import type { DamageRequest, MatchEvent } from '../game/Match';
import type { ShopItemId } from '../game/shop';
import type { SpecialId } from '../game/special/defs';
import type { SpecialMsg } from '../game/special/msgs';
import type { LobbyInfo } from '../ui/types';

/** Conexão de rede vista pelo Game. Implementada em net/Net.ts. */
export interface NetLink {
  readonly isHost: boolean;
  readonly localId: string;
  /** Modo da sala (no cliente: o do host). */
  readonly mode: 'gungame' | 'treino';
  /** Chamado por Game.startSession depois de criar o actor local. */
  attach(game: Game): void;
  /** Cliente → host: pedido de dano. */
  sendDamage(r: DamageRequest): void;
  /** Host → todos: evento de partida (o host já aplicou localmente). */
  broadcastMatch(e: MatchEvent): void;
  /** Armas malucas: efeito visual de quem atira (projétil, raio). Host → todos; cliente → host, que retransmite. */
  sendSpecial(m: SpecialMsg): void;
  /** Cliente → host: pedi para pegar o pickup `id` (o host valida a distância e decide). */
  requestPickup(id: number): void;
  /** Cliente → host: a munição da minha arma maluca acabou. */
  requestSpecialEnd(kind: SpecialId): void;
  /** Cliente → host: quero comprar `item` na loja (o host valida dinheiro e vida). */
  requestBuy(item: ShopItemId): void;
  /** Chamado todo frame: envia snapshots, pings etc. */
  update(dt: number): void;
  lobby(): LobbyInfo;
  close(): void;
}
