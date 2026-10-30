import { MAX_HP, type Actor } from './Actor';
import type { SpecialId } from './special/defs';
import type { WeaponId } from './weaponDefs';

/**
 * Modo 'gungame' (id antigo; hoje é o modo da loja):
 * - ESCADA: 13 armas malucas, da mais fraca à mais forte. 1 kill sobe um nível; quem mata no último nível vence.
 * - LOJA (tecla B): armas comuns e extras, pagos com o dinheiro das kills. Comum comprada substitui a maluca
 *   até morrer. Tudo é número de jogo: mexa à vontade.
 */
export type ExtraId = 'colete' | 'vida' | 'municao';
export type ShopItemId = WeaponId | ExtraId;

export const START_MONEY = 500;
export const KILL_REWARD = 300;
export const ARMOR_MAX = 100;
/** Fração do dano que o colete absorve enquanto tiver pontos. */
export const ARMOR_ABSORB = 0.5;

/**
 * Escada, da mais fraca à mais forte (estimativa pelos números, ainda sem playtest).
 * Mexa na ordem aqui para rebalancear.
 */
export const LADDER: SpecialId[] = [
  'ventilador', 'chinelo', 'galinha', 'pombo', 'cafe', 'rexona', 'bola', 'pipa', 'rojao', 'panela', 'dolly', 'estilingue', 'lorenzetti', 'tijolo',
];
export const ladderWeapon = (level: number): SpecialId => LADDER[Math.max(0, Math.min(level, LADDER.length - 1))];

export const PRICE: Record<ShopItemId, number> = {
  knife: 0, pistol: 200, smg: 1000, shotgun: 1200, rifle: 2000, sniper: 3000,
  colete: 650, vida: 400, municao: 250,
};

export interface ShopTier {
  name: string;
  items: ShopItemId[];
}

/** Categorias do menu (teclas 1-2). */
export const SHOP_TIERS: ShopTier[] = [
  { name: 'ARMAS', items: ['knife', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper'] },
  { name: 'EXTRAS', items: ['colete', 'vida', 'municao'] },
];

export const isShopItem = (id: unknown): id is ShopItemId =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(PRICE, id);

export const isExtra = (id: ShopItemId): id is ExtraId => id === 'colete' || id === 'vida' || id === 'municao';

/** Pode comprar? 'no' = não faz sentido agora (já tem, vida cheia...), 'money' = falta dinheiro. */
export function canBuy(a: Actor, item: ShopItemId): 'ok' | 'no' | 'money' {
  if (!a.alive) return 'no';
  if (!isExtra(item)) {
    if (!a.special && a.weapon === item) return 'no';
  } else if (item === 'colete') {
    if (a.armor >= ARMOR_MAX) return 'no';
  } else if (item === 'vida') {
    if (a.hp >= MAX_HP) return 'no';
  }
  return a.money >= PRICE[item] ? 'ok' : 'money';
}
