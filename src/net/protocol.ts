import type { WeaponId } from '../game/weaponDefs';
import type { DamageRequest, MatchEvent } from '../game/Match';
import type { SpecialId } from '../game/special/defs';
import type { SpecialMsg } from '../game/special/msgs';
import type { PickupInfo } from '../game/special/Pickups';

/** Prefixo do peer ID do host no broker do PeerJS. O ID completo é `fpsdoclt-<CODIGO>`. */
export const ROOM_PREFIX = 'fpsdoclt-';
/** Sem I e O (confundem com 1 e 0). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LEN = 5;

export function genCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** Normaliza o que o usuário digitou; null se inválido. */
export function normalizeCode(raw: string): string | null {
  const c = (raw || '').toUpperCase().replace(/[^A-Z]/g, '');
  return c.length === CODE_LEN ? c : null;
}

export const WEAPON_IDS: WeaponId[] = ['smg', 'rifle', 'shotgun', 'sniper', 'pistol', 'knife'];
export const weaponIndex = (w: WeaponId): number => Math.max(0, WEAPON_IDS.indexOf(w));

export type Mode = 'gungame' | 'treino';

/** Estado completo de um actor (welcome / actor-join). */
export interface ActorInfo {
  id: string;
  n: number; // índice numérico de rede (usado nos snapshots binários)
  name: string;
  c: number; // cor
  b: 0 | 1; // bot
  hp: number;
  al: 0 | 1; // vivo
  kl: number;
  de: number;
  lv: number;
  lk: number;
  w: WeaponId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Cara do boneco (data URL jpeg/png), opcional. */
  f?: string | null;
  /** Arma maluca na mão, se houver. */
  sp?: SpecialId;
}

/** Tamanho máximo (caracteres) aceito para a data URL da face na rede. */
export const MAX_FACE_LEN = 16 * 1024 + 64;

/** Valida a face recebida pela rede: data URL image/jpeg|png, base64, até ~16 KB. Senão, null. */
export function validFace(f: unknown): string | null {
  if (typeof f !== 'string' || f.length > MAX_FACE_LEN) return null;
  return /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(f) ? f : null;
}

/** Tiro visual compacto. `e` = pontos finais achatados [x,y,z,...]; `s[i]` = 1 (carne), string (material) ou 0. */
export interface FireMsg {
  k: 'f';
  a: string;
  w: WeaponId;
  o: [number, number, number];
  e: number[];
  s: (string | number)[];
}

export interface MeleeMsg {
  k: 'm';
  a: string;
  w: WeaponId;
  hit: boolean;
  hv: boolean;
  o: [number, number, number];
}

/** Mensagens JSON no canal confiável. */
export type Msg =
  | { k: 'hello'; name: string; v: number; face?: string | null }
  | { k: 'welcome'; id: string; hostId: string; mode: Mode; ep: number; actors: ActorInfo[]; pk?: PickupInfo[] }
  | { k: 'full' }
  | { k: 'join'; a: ActorInfo }
  | { k: 'leave'; id: string }
  | { k: 'ev'; e: MatchEvent }
  | { k: 'dmg'; r: DamageRequest }
  | { k: 'mode'; m: Mode }
  | { k: 'ping'; t: number }
  | { k: 'pong'; t: number }
  | { k: 'bye'; msg: string }
  /** Armas malucas: visual de projétil/raio (retransmitido pelo host). */
  | { k: 'sp'; m: SpecialMsg }
  /** Cliente → host: quero pegar o pickup `id`. */
  | { k: 'pk'; id: number }
  /** Cliente → host: minha arma maluca acabou. */
  | { k: 'spx'; w: SpecialId }
  | FireMsg
  | MeleeMsg;

// ------------------------------------------------------------------ snapshots binários

export const T_C2H = 1; // cliente → host
export const T_H2C = 2; // host → clientes (agregado)

/** Cliente → host: [type u8][epoch u8][seq u16][x f32][y f32][z f32][yaw i16][pitch i16][speed u8][flags u8] */
export const C2H_SIZE = 22;
/** Host → cliente: header [type u8][count u8][seq u16] + count * entry */
export const H2C_HEADER = 4;
/** Entry: [num u8][x f32][y f32][z f32][yaw i16][pitch i16][speed u8][flags u8][ping u16] */
export const H2C_ENTRY = 21;
export const MAX_ACTORS = 40;

export const F_CROUCH = 1;
export const F_GROUND = 2;

const TWO_PI = Math.PI * 2;
export function qYaw(yaw: number): number {
  const y = yaw - TWO_PI * Math.round(yaw / TWO_PI);
  return Math.round((y / Math.PI) * 32767);
}
export const dYaw = (q: number): number => (q / 32767) * Math.PI;
export function qPitch(p: number): number {
  const c = Math.max(-1.5707, Math.min(1.5707, p));
  return Math.round((c / (Math.PI / 2)) * 32767);
}
export const dPitch = (q: number): number => (q / 32767) * (Math.PI / 2);
export const qSpeed = (s: number): number => Math.max(0, Math.min(255, Math.round(s * 16)));
export const dSpeed = (q: number): number => q / 16;
export const packFlags = (crouched: boolean, grounded: boolean, weapon: WeaponId): number =>
  (crouched ? F_CROUCH : 0) | (grounded ? F_GROUND : 0) | (weaponIndex(weapon) << 2);
export const flagWeapon = (f: number): WeaponId => WEAPON_IDS[(f >> 2) & 15] ?? 'smg';

export const r2 = (n: number): number => Math.round(n * 100) / 100;
