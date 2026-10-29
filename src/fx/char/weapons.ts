import type * as THREE from 'three';
import type { WeaponId } from '../../game/weaponDefs';
import { partsGeo, sym, type Part } from './geo';

const GUN = 0x2b2d31, GUN2 = 0x3d4046, WOOD = 0x7a4a2a, TAN = 0xb59a6a, STEEL = 0xc8ccd2, BLACK = 0x18181a;

/** Arma low-poly em 3ª pessoa. Origem = empunhadura (mão direita), cano para -z. */
const DEFS: Record<WeaponId, () => Part[]> = {
  pistol: () => [
    sym(0.025, 0.03, 0.085, -0.19, 0.03, GUN),
    sym(0.022, -0.08, 0.03, -0.01, 0.05, BLACK),
    sym(0.008, 0.085, 0.1, -0.18, -0.16, GUN2),
  ],
  smg: () => [
    sym(0.035, 0.0, 0.085, -0.3, 0.06, GUN),
    sym(0.022, -0.16, 0.0, -0.13, -0.07, BLACK),
    sym(0.016, 0.03, 0.06, -0.42, -0.3, GUN2),
    sym(0.022, -0.09, 0.0, 0.0, 0.05, BLACK),
    sym(0.012, 0.0, 0.07, 0.06, 0.2, GUN2),
    sym(0.008, 0.085, 0.11, -0.05, 0.0, GUN2),
  ],
  rifle: () => [
    sym(0.036, -0.01, 0.085, -0.42, 0.1, GUN),
    sym(0.04, -0.015, 0.075, -0.42, -0.2, TAN),
    sym(0.03, -0.05, 0.07, 0.1, 0.34, TAN),
    sym(0.024, -0.16, -0.01, -0.2, -0.12, GUN2),
    sym(0.024, -0.24, -0.15, -0.23, -0.15, GUN2),
    sym(0.022, -0.1, 0.0, 0.0, 0.05, BLACK),
    sym(0.013, 0.02, 0.05, -0.7, -0.42, GUN2),
    sym(0.008, 0.05, 0.11, -0.62, -0.58, GUN),
    sym(0.02, 0.085, 0.13, -0.12, 0.0, BLACK),
  ],
  shotgun: () => [
    sym(0.026, 0.03, 0.08, -0.76, 0.0, GUN),
    sym(0.02, -0.01, 0.03, -0.62, -0.05, GUN2),
    sym(0.036, -0.03, 0.045, -0.46, -0.25, WOOD),
    sym(0.036, -0.03, 0.085, -0.05, 0.12, GUN),
    sym(0.03, -0.09, 0.06, 0.12, 0.42, WOOD),
    sym(0.022, -0.1, 0.0, 0.0, 0.06, WOOD),
    sym(0.006, 0.08, 0.1, -0.74, -0.72, STEEL),
  ],
  sniper: () => [
    sym(0.018, 0.02, 0.055, -1.0, -0.4, GUN),
    sym(0.036, -0.01, 0.08, -0.42, 0.1, 0x55603f),
    sym(0.032, -0.07, 0.07, 0.1, 0.4, 0x55603f),
    sym(0.022, -0.1, 0.0, 0.0, 0.05, BLACK),
    sym(0.03, 0.095, 0.155, -0.34, 0.02, BLACK),
    sym(0.036, 0.09, 0.16, -0.36, -0.32, GUN2),
    sym(0.012, 0.08, 0.1, -0.2, -0.14, BLACK),
    sym(0.02, -0.08, -0.01, -0.06, -0.02, GUN2),
    sym(0.028, 0.02, 0.065, -1.04, -0.98, BLACK),
  ],
  knife: () => [
    sym(0.006, -0.012, 0.04, -0.27, -0.045, STEEL),
    sym(0.004, 0.032, 0.042, -0.24, -0.06, 0xe8ebef),
    sym(0.032, -0.03, 0.05, -0.045, -0.025, BLACK),
    sym(0.02, -0.025, 0.035, -0.025, 0.1, 0x3a2a1e),
  ],
};

export function weaponGeo(id: WeaponId): THREE.BufferGeometry {
  return partsGeo(`w:${id}`, DEFS[id] ?? DEFS.smg);
}

/** Pose: onde fica a empunhadura (no grupo de mira) e onde vai a mão esquerda. */
export interface GripPose {
  grip: [number, number, number];
  left: [number, number, number] | null;
}

export const GRIPS: Record<WeaponId, GripPose> = {
  pistol: { grip: [0.06, -0.06, -0.47], left: [0.02, -0.1, -0.44] },
  smg: { grip: [0.15, -0.12, -0.32], left: [0.08, -0.16, -0.56] },
  rifle: { grip: [0.15, -0.12, -0.3], left: [0.1, -0.15, -0.62] },
  shotgun: { grip: [0.15, -0.12, -0.3], left: [0.1, -0.16, -0.64] },
  sniper: { grip: [0.15, -0.13, -0.28], left: [0.1, -0.16, -0.64] },
  knife: { grip: [0.27, -0.24, -0.36], left: null },
};
