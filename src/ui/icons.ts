import { SPECIALS, isSpecialId } from '../game/special/defs';
import type { SpecialId } from '../game/special/defs';
import { WEAPONS } from '../game/weaponDefs';
import type { WeaponId } from '../game/weaponDefs';

/** Silhuetas pixeladas simples (viewBox 24x10). */
const ICONS: Record<WeaponId | SpecialId, string> = {
  smg: '<rect x="0" y="3" width="4" height="3"/><rect x="4" y="2" width="14" height="4"/><rect x="18" y="3" width="6" height="2"/><rect x="8" y="6" width="3" height="4"/><rect x="14" y="6" width="2" height="3"/>',
  rifle: '<rect x="0" y="3" width="6" height="4"/><rect x="6" y="3" width="12" height="3"/><rect x="18" y="4" width="6" height="1"/><rect x="9" y="6" width="3" height="4"/><rect x="8" y="1" width="6" height="2"/>',
  shotgun: '<rect x="0" y="3" width="8" height="4"/><rect x="8" y="3" width="16" height="2"/><rect x="11" y="5" width="6" height="2"/><rect x="8" y="5" width="2" height="3"/>',
  sniper: '<rect x="0" y="3" width="8" height="4"/><rect x="8" y="4" width="16" height="1"/><rect x="9" y="1" width="7" height="2"/><rect x="6" y="7" width="2" height="3"/>',
  pistol: '<rect x="5" y="2" width="14" height="3"/><rect x="5" y="5" width="4" height="5"/><rect x="9" y="5" width="3" height="2"/>',
  knife: '<rect x="2" y="6" width="20" height="3"/><rect x="3" y="3" width="16" height="3"/><rect x="19" y="4" width="3" height="2"/><rect x="1" y="4" width="2" height="5"/>',
  // armas malucas
  lorenzetti: '<rect x="0" y="5" width="9" height="2"/><rect x="8" y="3" width="3" height="4"/><path d="M11 2h11l2 6H9z"/><rect x="13" y="9" width="1" height="1"/><rect x="17" y="9" width="1" height="1"/><rect x="21" y="9" width="1" height="1"/>',
  estilingue: '<path d="M6 0h3l3 5 3-5h3l-5 8v2h-2V8z"/>',
  dolly: '<rect x="1" y="2" width="13" height="6"/><rect x="14" y="3" width="6" height="4"/><rect x="20" y="2" width="3" height="6"/>',
  rexona: '<rect x="1" y="2" width="14" height="6"/><rect x="15" y="3" width="3" height="4"/><rect x="20" y="4" width="2" height="2"/><rect x="22" y="1" width="1" height="2"/><rect x="22" y="7" width="1" height="2"/>',
  pombo: '<path d="M2 6l8-3h6l4-3-1 5 4 1-6 3-8 1z"/>',
  chinelo: '<ellipse cx="12" cy="5" rx="11" ry="4"/><path d="M11 0h2l-1 5z" fill="#000" fill-opacity=".55"/>',
  panela: '<rect x="0" y="4" width="4" height="2"/><rect x="20" y="4" width="4" height="2"/><rect x="4" y="3" width="16" height="6"/><rect x="3" y="2" width="18" height="2"/><rect x="11" y="0" width="2" height="2"/>',
  bola: '<circle cx="12" cy="5" r="4.8"/><path d="M12 2.6l2.2 1.7-.8 2.5h-2.8l-.8-2.5z" fill="#000" fill-opacity=".6"/><path d="M12 .3v2.3M7.3 3.6l2.4.8M16.7 3.6l-2.4.8M9 9.5l1.3-2.7M15 9.5l-1.3-2.7" stroke="#000" stroke-opacity=".5" stroke-width=".8" fill="none"/>',
  pipa: '<path d="M7 0l5.5 4L7 9 1.5 4z"/><path d="M7 0v9M1.5 4h11" stroke="#000" stroke-opacity=".5" stroke-width=".7" fill="none"/><path d="M7 9q2.5 2 5 0t5 0t5 0" stroke="currentColor" stroke-width="1" fill="none"/><rect x="11" y="8" width="2" height="1.4"/><rect x="16" y="8" width="2" height="1.4"/><rect x="21" y="8" width="2" height="1.4"/>',
  cafe: '<rect x="3" y="2" width="13" height="6"/><rect x="16" y="3" width="4" height="4"/><rect x="5" y="2" width="1" height="6" fill="#000" fill-opacity=".35"/><rect x="9" y="2" width="1" height="6" fill="#000" fill-opacity=".35"/><path d="M3 3H1v4h2" stroke="currentColor" fill="none" stroke-width="1"/><rect x="21" y="1" width="1" height="3"/><rect x="23" y="3" width="1" height="3"/><rect x="21" y="6" width="1" height="3"/>',
  ventilador: '<circle cx="8" cy="5" r="4.5"/><rect x="7" y="9" width="2" height="1"/><rect x="15" y="3" width="8" height="1"/><rect x="15" y="6" width="6" height="1"/>',
  rojao: '<rect x="0" y="5" width="11" height="1"/><rect x="9" y="3" width="8" height="4"/><rect x="11" y="3" width="1.5" height="4" fill="#000" fill-opacity=".45"/><path d="M17 3h2l5 2-5 2h-2z"/><rect x="0" y="2" width="1" height="1"/><rect x="2" y="7" width="1" height="1"/><rect x="4" y="1" width="1" height="1"/>',
  galinha: '<ellipse cx="11" cy="5.4" rx="7" ry="3.7"/><circle cx="19" cy="3" r="2.2"/><path d="M18 .5l1 1.2 1-1.4 1 1.4v1h-3z" fill="#000" fill-opacity=".55"/><path d="M21 3l3 .8-3 .8z"/><path d="M4 2.5l-4-2 1 3 3 2z"/><rect x="9" y="8.5" width="1" height="1.5"/><rect x="13" y="8.5" width="1" height="1.5"/><rect x="19.5" y="2.4" width="1" height="1" fill="#000"/>',
  tijolo: '<rect x="1" y="2" width="22" height="6"/><rect x="8" y="2" width="1" height="3" fill="#000" fill-opacity=".45"/><rect x="16" y="5" width="1" height="3" fill="#000" fill-opacity=".45"/><rect x="1" y="5" width="22" height="1" fill="#000" fill-opacity=".45"/>',
};
export const icon = (id: WeaponId | SpecialId) => `<svg viewBox="0 0 24 10" aria-hidden="true">${ICONS[id]}</svg>`;

/** Nome/abreviação/cor de qualquer arma (do gun game ou maluca). */
export function wInfo(id: string): { name: string; short: string; color: number | null } {
  if (isSpecialId(id)) { const d = SPECIALS[id]; return { name: d.name, short: d.short, color: d.color }; }
  const w = WEAPONS[id as WeaponId];
  return { name: w?.name ?? id, short: w?.short ?? id, color: null };
}


export const hex = (n: number) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
