import { SPECIALS, SPECIAL_IDS, specialAsWeapon } from './special/defs';

export { SPECIALS, SPECIAL_IDS, isSpecialId } from './special/defs';
export type { AnyWeaponId, SpecialId, SpecialDef, StatusKind, ProjKind, BeamKind } from './special/defs';

/** Armas comuns (clássicas da loja e do treino). As armas malucas têm ids próprios: ver `SpecialId`. */
export type WeaponId = 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'pistol' | 'knife';

export interface WeaponDef {
  id: WeaponId;
  /** Nome que aparece no HUD / kill feed. */
  name: string;
  short: string;
  damage: number;
  headMult: number;
  /** Tiros por minuto. */
  rpm: number;
  auto: boolean;
  mag: number;
  reload: number;
  pellets: number;
  /** Spread em radianos (meio-ângulo do cone). */
  spreadBase: number;
  spreadMove: number;
  spreadAir: number;
  spreadPerShot: number;
  spreadMax: number;
  crouchMult: number;
  /** Recuo vertical por tiro (graus). */
  kick: number;
  kickYaw: number;
  /** Quão rápido o recuo volta (1/s). */
  recover: number;
  range: number;
  /** Distância em que o dano começa a cair, e dano mínimo (fração). */
  falloffStart: number;
  falloffMin: number;
  moveMult: number;
  switchTime: number;
  /** Multiplicador de FOV ao mirar (ADS) e tempo para entrar na mira. Sniper usa zoomFov (luneta). */
  adsZoom: number;
  adsTime: number;
  zoomFov?: number;
  melee?: { range: number; heavyDamage: number; heavyTime: number };
}

const W = (d: WeaponDef) => d;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  smg: W({
    id: 'smg', name: 'SMG', short: 'SMG',
    damage: 21, headMult: 2.5, rpm: 860, auto: true, mag: 30, reload: 1.8, pellets: 1,
    spreadBase: 0.012, spreadMove: 0.018, spreadAir: 0.08, spreadPerShot: 0.0025, spreadMax: 0.06, crouchMult: 0.75,
    kick: 0.75, kickYaw: 0.5, recover: 9, range: 120, falloffStart: 15, falloffMin: 0.55, moveMult: 1.0, switchTime: 0.45, adsZoom: 0.82, adsTime: 0.17,
  }),
  rifle: W({
    id: 'rifle', name: 'Fuzil', short: 'FUZIL',
    damage: 33, headMult: 3, rpm: 600, auto: true, mag: 30, reload: 2.2, pellets: 1,
    spreadBase: 0.003, spreadMove: 0.05, spreadAir: 0.12, spreadPerShot: 0.004, spreadMax: 0.07, crouchMult: 0.6,
    kick: 1.15, kickYaw: 0.8, recover: 7, range: 250, falloffStart: 40, falloffMin: 0.75, moveMult: 0.9, switchTime: 0.6, adsZoom: 0.72, adsTime: 0.24,
  }),
  shotgun: W({
    id: 'shotgun', name: 'Escopeta', short: 'ESCOPETA',
    damage: 13, headMult: 1.6, rpm: 72, auto: false, mag: 6, reload: 2.4, pellets: 10,
    spreadBase: 0.065, spreadMove: 0.01, spreadAir: 0.03, spreadPerShot: 0, spreadMax: 0.08, crouchMult: 0.85,
    kick: 5.5, kickYaw: 1.5, recover: 6, range: 60, falloffStart: 7, falloffMin: 0.2, moveMult: 0.95, switchTime: 0.6, adsZoom: 0.88, adsTime: 0.2,
  }),
  sniper: W({
    id: 'sniper', name: 'Sniper', short: 'SNIPER',
    damage: 115, headMult: 2, rpm: 46, auto: false, mag: 5, reload: 2.8, pellets: 1,
    spreadBase: 0.09, spreadMove: 0.06, spreadAir: 0.2, spreadPerShot: 0, spreadMax: 0.3, crouchMult: 0.8,
    kick: 7, kickYaw: 1, recover: 5, range: 400, falloffStart: 400, falloffMin: 1, moveMult: 0.85, switchTime: 0.8, adsZoom: 0.8, adsTime: 0.28,
    zoomFov: 22,
  }),
  pistol: W({
    id: 'pistol', name: 'Pistola', short: 'PISTOLA',
    damage: 30, headMult: 3, rpm: 420, auto: false, mag: 12, reload: 1.4, pellets: 1,
    spreadBase: 0.005, spreadMove: 0.025, spreadAir: 0.08, spreadPerShot: 0.012, spreadMax: 0.05, crouchMult: 0.7,
    kick: 1.8, kickYaw: 0.6, recover: 10, range: 150, falloffStart: 20, falloffMin: 0.6, moveMult: 1.05, switchTime: 0.35, adsZoom: 0.85, adsTime: 0.14,
  }),
  knife: W({
    id: 'knife', name: 'Faca', short: 'FACA',
    damage: 55, headMult: 1, rpm: 140, auto: true, mag: 0, reload: 0, pellets: 0,
    spreadBase: 0, spreadMove: 0, spreadAir: 0, spreadPerShot: 0, spreadMax: 0, crouchMult: 1,
    kick: 0, kickYaw: 0, recover: 10, range: 2.2, falloffStart: 99, falloffMin: 1, moveMult: 1.12, switchTime: 0.3, adsZoom: 1, adsTime: 0.2,
    melee: { range: 2.2, heavyDamage: 100, heavyTime: 0.9 },
  }),
};

// Em runtime, WEAPONS também responde pelos ids das armas malucas (kill feed / HUD antigo fazem WEAPONS[e.weapon]).
// O tipo continua só com WeaponId: use `anyWeaponDef(id)` para acessar com tipo correto.
for (const id of SPECIAL_IDS) (WEAPONS as Record<string, WeaponDef>)[id] = specialAsWeapon(SPECIALS[id]);
export const anyWeaponDef = (id: WeaponId | import('./special/defs').SpecialId): WeaponDef => (WEAPONS as Record<string, WeaponDef>)[id];
