import { MAX_HP } from '../Actor';
import type { WeaponDef, WeaponId } from '../weaponDefs';

/** Armas malucas (pickups). Ids fixos: o artista, o áudio e o HUD usam estes nomes. */
export type SpecialId =
  | 'lorenzetti' | 'estilingue' | 'dolly' | 'rexona' | 'pombo'
  | 'chinelo' | 'panela' | 'ventilador' | 'tijolo'
  | 'bola' | 'pipa' | 'rodo' | 'cafe';

export const SPECIAL_IDS: SpecialId[] = [
  'lorenzetti', 'estilingue', 'dolly', 'rexona', 'pombo', 'chinelo', 'panela', 'ventilador', 'tijolo',
  'bola', 'pipa', 'rodo', 'cafe',
];

/** Qualquer arma que pode aparecer em dano/kill: as do gun game + as malucas. */
export type AnyWeaponId = WeaponId | SpecialId;

export const isSpecialId = (w: string): w is SpecialId => (SPECIAL_IDS as string[]).includes(w);

/** Efeitos de status. `steam` = vapor do café: embaça a tela da vítima. */
export type StatusKind = 'burn' | 'shock' | 'blind' | 'stun' | 'steam';

/** Projéteis físicos. */
export type ProjKind = 'stone' | 'bottle' | 'brick' | 'panela' | 'bola' | 'pombo' | 'chinelo';

/** Armas de raio/jato contínuo (segurar o botão). */
export type BeamKind = 'lorenzetti' | 'rexona' | 'ventilador' | 'cafe';

export type SpecialStyle = 'beam' | 'charge' | 'throw' | 'flame' | 'homing' | 'boomerang' | 'wind' | 'kick' | 'kite' | 'melee' | 'jet';

export interface SpecialDef {
  id: SpecialId;
  name: string;
  short: string;
  /** Dica de controle para o HUD. */
  hint: string;
  style: SpecialStyle;
  /** Munição inicial. Unidade em `unit`: segundos de uso (raio/jato/pipa no ar) ou nº de usos. */
  ammo: number;
  unit: 'sec' | 'shot';
  /** Cor da arma (0xRRGGBB): feixe de luz do pickup, brilho e HUD. Distinta entre as 13. */
  color: number;
  /** Loja: segundos para a munição voltar do zero ao máximo (padrão REGEN_FULL). Mais lento = arma mais forte. */
  regen?: number;
  /** Parâmetros de balanceamento (ver cada arma). */
  p: Record<string, number>;
}

/** Loja: segundos padrão para a munição regenerar por completo. */
export const REGEN_FULL = 24;

/**
 * Balanceamento. Tudo aqui é número de jogo: mexa à vontade.
 * Dano em HP (jogador tem MAX_HP = 130). Distâncias em metros, tempos em segundos.
 * Filosofia: pegou, saiu matando (meio OP), mas dá pra fugir/desviar de tudo.
 */
export const SPECIALS: Record<SpecialId, SpecialDef> = {
  lorenzetti: {
    id: 'lorenzetti', name: 'Chuveiro Lorenzetti', short: 'LORENZETTI', hint: 'Segure para dar choque',
    style: 'beam', ammo: 9, unit: 'sec', color: 0x5a3cff, regen: 30,
    p: { range: 40, cone: 0.09, dps: 140, arcDps: 80, arcRange: 11, tick: 0.1, shockDur: 0.7 },
  },
  estilingue: {
    id: 'estilingue', name: 'Estilingue', short: 'ESTILINGUE', hint: 'Segure para esticar, solte para atirar',
    style: 'charge', ammo: 14, unit: 'shot', color: 0xffc400, regen: 30,
    p: { chargeTime: 0.65, minCharge: 0.15, vMin: 26, vMax: 85, g: 14, dmgMin: 30, dmgMax: 135, headMult: 2.2, cd: 0.2, e: 0.55, killCharge: 0.8 },
  },
  dolly: {
    id: 'dolly', name: 'Dolly Guaraná', short: 'DOLLY', hint: 'Arremessa a garrafa: explode em gêiser',
    style: 'throw', ammo: 5, unit: 'shot', color: 0xff4d94,
    p: { speed: 24, lift: 0.14, g: 18, fuse: 1.0, radius: 6.5, dmg: 175, dmgMin: 55, knock: 17, up: 12, cd: 0.55, e: 0.45 },
  },
  rexona: {
    id: 'rexona', name: 'Desodorante Rexona', short: 'REXONA', hint: 'Segure para lançar chamas',
    style: 'flame', ammo: 8, unit: 'sec', color: 0x1e78ff,
    p: { range: 10, cone: 0.3, dps: 110, tick: 0.1, burn: 4, burnDps: 22 },
  },
  pombo: {
    id: 'pombo', name: 'Pombo', short: 'POMBO', hint: 'Solta pombos teleguiados',
    style: 'homing', ammo: 8, unit: 'shot', color: 0x9a5cff,
    p: { cd: 0.38, speed: 21, turn: 3.4, life: 9, dmg: 70, blind: 3.5, acquire: 60, acquireCone: 1.4 },
  },
  chinelo: {
    id: 'chinelo', name: 'Chinelo Havaianas', short: 'CHINELO', hint: 'Arremessa e volta como bumerangue',
    style: 'boomerang', ammo: 10, unit: 'shot', color: 0x3fd23f,
    // Ida reta (sem queda, turnOut 0), volta teleguiada. Dois acertos matam (ida + volta): dmg = ceil(MAX_HP / 2).
    p: { speed: 31, straight: 0.3, turnOut: 0, outTime: 1.1, backSpeed: 36, backTurn: 6.5, dmg: Math.ceil(MAX_HP / 2), radius: 0.6, cd: 0.2 },
  },
  panela: {
    id: 'panela', name: 'Panela de Pressão', short: 'PANELA', hint: 'Granada: chia e explode em feijão',
    style: 'throw', ammo: 4, unit: 'shot', color: 0xf2f4ff,
    p: { speed: 15, lift: 0.2, g: 20, fuse: 2.4, radius: 9.5, dmg: 190, dmgMin: 60, knock: 19, up: 12, cd: 0.6, e: 0.5 },
  },
  ventilador: {
    id: 'ventilador', name: 'Ventilador Arno', short: 'VENTILADOR', hint: 'Segure: vento que corta. Perto, a hélice picota',
    style: 'wind', ammo: 8, unit: 'sec', color: 0x20e8e8,
    // dps: dano do vento no cone todo. chop*: bem perto a hélice picota (dano alto; empurra menos para a vítima ficar na hélice).
    p: { range: 16, cone: 0.45, tick: 0.1, push: 3.0, lift: 3.0, cap: 10, fallT: 4, dps: 75, chopRange: 3.5, chopDps: 220, chopPush: 0.4 },
  },
  tijolo: {
    id: 'tijolo', name: 'Tijolo Baiano', short: 'TIJOLO', hint: 'Um tijolo, um corpo. Voa reto',
    style: 'throw', ammo: 6, unit: 'shot', color: 0xe5352b, regen: 36,
    // One shot em qualquer parte do corpo (dmg >= MAX_HP). Voa reto: sem gravidade (g 0) e sem lift.
    p: { speed: 48, lift: 0, g: 0, dmg: 999, cd: 0.6, e: 0.28 },
  },
  bola: {
    id: 'bola', name: 'Bola de Futebol', short: 'BOLA', hint: 'Clique para chutar. Na cabeça é GOLAÇO',
    style: 'kick', ammo: 5, unit: 'shot', color: 0xa6ee2f,
    // Dano = velocidade * dmgPerSpeed (min..max). Cabeça com speed >= headMinSpeed mata na hora (golaço).
    // carry: fração da velocidade que a bola mantém ao atravessar um jogador (acerta vários).
    p: { speed: 40, lift: 0.1, g: 15, e: 0.82, maxBounce: 6, life: 5, radius: 0.22, cd: 0.5, dmgPerSpeed: 2.6, dmgMin: 12, dmgMax: 150, headMinSpeed: 6, hitCool: 0.5, carry: 0.78 },
  },
  pipa: {
    id: 'pipa', name: 'Pipa com Cerol', short: 'PIPA', hint: 'Clique solta/recolhe. Varra a linha com a mira',
    style: 'kite', ammo: 10, unit: 'sec', color: 0xe040f0,
    // len: comprimento da linha; bias: a pipa fica um pouco acima da mira (rad); follow: agilidade do atraso (1/s).
    p: { len: 22, bias: 0.07, follow: 5.5, launchT: 0.6, launchLift: 0.5, dps: 150, tick: 0.1, reach: 0.45, cd: 0.35 },
  },
  rodo: {
    id: 'rodo', name: 'Rodo', short: 'RODO', hint: 'Clique: golpe. Direito: carregado. Home run!',
    style: 'melee', ammo: 12, unit: 'shot', color: 0x28ffa8,
    // Home run: o knockback marca a vítima (kill de quem bateu se ela espatifa na parede em alta velocidade ou cai).
    p: {
      range: 2.8, cone: 0.7, dmg: 60, knock: 24, up: 6.5, cd: 0.45,
      hRange: 3.2, hCone: 0.8, hDmg: 110, hKnock: 38, hUp: 9, windup: 0.3, hCd: 0.95, hCost: 2,
      fallT: 4.5, slamMin: 11, slamLoss: 8, slamBase: 8, slamMul: 13, slamMax: 260,
    },
  },
  cafe: {
    id: 'cafe', name: 'Garrafa Térmica de Café', short: 'CAFÉ', hint: 'Segure para jorrar café fervendo',
    style: 'jet', ammo: 6, unit: 'sec', color: 0xff8a1f,
    p: { range: 9, cone: 0.27, dps: 90, tick: 0.1, burn: 3.5, burnDps: 16, steam: 2.0 },
  },
};

/**
 * Versão "WeaponDef" de uma arma maluca. Serve para código antigo que faz `WEAPONS[id]` (kill feed, HUD)
 * continuar funcionando com um nome certo.
 */
export function specialAsWeapon(d: SpecialDef): WeaponDef {
  return {
    id: d.id as unknown as WeaponId,
    name: d.name, short: d.short,
    damage: 0, headMult: 1, rpm: 60, auto: false, mag: Math.ceil(d.ammo), reload: 0, pellets: 1,
    spreadBase: 0.006, spreadMove: 0.01, spreadAir: 0.02, spreadPerShot: 0, spreadMax: 0.03, crouchMult: 1,
    kick: 0, kickYaw: 0, recover: 10, range: 40, falloffStart: 40, falloffMin: 1, moveMult: 1,
    switchTime: 0.3, adsZoom: 1, adsTime: 0.2,
  };
}
