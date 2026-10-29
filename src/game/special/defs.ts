import type { WeaponDef, WeaponId } from '../weaponDefs';

/** Armas malucas (pickups). Ids fixos: o artista, o áudio e o HUD usam estes nomes. */
export type SpecialId =
  | 'lorenzetti' | 'estilingue' | 'dolly' | 'rexona' | 'pombo'
  | 'chinelo' | 'panela' | 'coxinha' | 'ventilador' | 'tijolo';

export const SPECIAL_IDS: SpecialId[] = [
  'lorenzetti', 'estilingue', 'dolly', 'rexona', 'pombo', 'chinelo', 'panela', 'coxinha', 'ventilador', 'tijolo',
];

/** Qualquer arma que pode aparecer em dano/kill: as do gun game + as malucas. */
export type AnyWeaponId = WeaponId | SpecialId;

export const isSpecialId = (w: string): w is SpecialId => (SPECIAL_IDS as string[]).includes(w);

/** Efeitos de status. */
export type StatusKind = 'burn' | 'shock' | 'blind' | 'stun';

/** Projéteis físicos. */
export type ProjKind = 'stone' | 'bottle' | 'brick' | 'panela' | 'coxinha' | 'pombo' | 'chinelo';

/** Armas de raio/jato contínuo (segurar o botão). */
export type BeamKind = 'lorenzetti' | 'rexona' | 'ventilador';

export type SpecialStyle = 'beam' | 'charge' | 'throw' | 'flame' | 'homing' | 'boomerang' | 'burst' | 'wind';

export interface SpecialDef {
  id: SpecialId;
  name: string;
  short: string;
  /** Dica de controle para o HUD. */
  hint: string;
  style: SpecialStyle;
  /** Munição inicial. Unidade em `unit`: segundos de uso (raio/jato) ou nº de usos. */
  ammo: number;
  unit: 'sec' | 'shot';
  /** Cor do pickup / brilho (0xRRGGBB). */
  color: number;
  /** Parâmetros de balanceamento (ver cada arma). */
  p: Record<string, number>;
}

/**
 * Balanceamento. Tudo aqui é número de jogo: mexa à vontade.
 * Dano em HP (jogador tem 100). Distâncias em metros, tempos em segundos.
 */
export const SPECIALS: Record<SpecialId, SpecialDef> = {
  lorenzetti: {
    id: 'lorenzetti', name: 'Chuveiro Lorenzetti', short: 'LORENZETTI', hint: 'Segure para dar choque',
    style: 'beam', ammo: 6, unit: 'sec', color: 0x59c8ff,
    p: { range: 35, cone: 0.07, dps: 100, arcDps: 50, arcRange: 9, tick: 0.1, shockDur: 0.5 },
  },
  estilingue: {
    id: 'estilingue', name: 'Estilingue', short: 'ESTILINGUE', hint: 'Segure para esticar, solte para atirar',
    style: 'charge', ammo: 8, unit: 'shot', color: 0xb5792f,
    p: { chargeTime: 1.0, minCharge: 0.12, vMin: 22, vMax: 74, g: 14, dmgMin: 18, dmgMax: 90, headMult: 2, cd: 0.3, e: 0.55, killCharge: 0.95 },
  },
  dolly: {
    id: 'dolly', name: 'Dolly Guaraná', short: 'DOLLY', hint: 'Arremessa a garrafa: explode em gêiser',
    style: 'throw', ammo: 3, unit: 'shot', color: 0xff5a8a,
    p: { speed: 20, lift: 0.14, g: 18, fuse: 1.2, radius: 5, dmg: 100, dmgMin: 25, knock: 15, up: 12, cd: 0.8, e: 0.45 },
  },
  rexona: {
    id: 'rexona', name: 'Desodorante Rexona', short: 'REXONA', hint: 'Segure para lançar chamas',
    style: 'flame', ammo: 5, unit: 'sec', color: 0xffa23a,
    p: { range: 7, cone: 0.27, dps: 64, tick: 0.125, burn: 3, burnDps: 14 },
  },
  pombo: {
    id: 'pombo', name: 'Pombo', short: 'POMBO', hint: 'Solta pombos teleguiados',
    style: 'homing', ammo: 4, unit: 'shot', color: 0xb9c4d6,
    p: { cd: 0.6, speed: 17, turn: 2.7, life: 8, dmg: 42, blind: 3, acquire: 45, acquireCone: 1.25 },
  },
  chinelo: {
    id: 'chinelo', name: 'Chinelo Havaianas', short: 'CHINELO', hint: 'Arremessa e volta como bumerangue',
    style: 'boomerang', ammo: 6, unit: 'shot', color: 0x2fb35a,
    p: { speed: 27, straight: 0.3, turnOut: 3.4, outTime: 1.05, backSpeed: 32, backTurn: 6.5, dmg: 200, radius: 0.5, cd: 0.25 },
  },
  panela: {
    id: 'panela', name: 'Panela de Pressão', short: 'PANELA', hint: 'Granada: chia e explode em feijão',
    style: 'throw', ammo: 2, unit: 'shot', color: 0xc9ccd4,
    p: { speed: 15, lift: 0.2, g: 20, fuse: 3, radius: 8, dmg: 110, dmgMin: 30, knock: 17, up: 11, cd: 1.0, e: 0.5 },
  },
  coxinha: {
    id: 'coxinha', name: 'Coxinha-Metralhadora', short: 'COXINHA', hint: 'Cospe rajadas de coxinhas',
    style: 'burst', ammo: 8, unit: 'shot', color: 0xe8a03a,
    p: { pellets: 6, spread: 0.085, speed: 58, g: 6, dmg: 17, falloffStart: 12, falloffEnd: 40, falloffMin: 0.4, cd: 0.62, life: 1.5, rest: 4.5 },
  },
  ventilador: {
    id: 'ventilador', name: 'Ventilador Arno', short: 'VENTILADOR', hint: 'Segure para empurrar todo mundo',
    style: 'wind', ammo: 6, unit: 'sec', color: 0x8fe3d2,
    p: { range: 14, cone: 0.42, tick: 0.1, push: 3.8, lift: 3.0, cap: 12, fallT: 3.5 },
  },
  tijolo: {
    id: 'tijolo', name: 'Tijolo Baiano', short: 'TIJOLO', hint: 'Arremesso pesado. Na cabeça é nocaute',
    style: 'throw', ammo: 4, unit: 'shot', color: 0xc4572b,
    p: { speed: 23, lift: 0.12, g: 22, dmg: 55, headDmg: 70, killHp: 70, stun: 1.5, cd: 0.9, e: 0.28 },
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
