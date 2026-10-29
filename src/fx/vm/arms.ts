import * as THREE from 'three';
import { Builder, PAL, vmMaterial } from './build';

/**
 * Braço low-poly: luva tática escura e manga verde-oliva.
 * Frame local: origem = palma; dedos apontam -Z; antebraço sai para +Z; costas da mão = +Y.
 * `grip` = dedos fechados (segurando cabo); senão, mão mais aberta (apoio/guarda-mão).
 */
export function buildArm(side: 'right' | 'left', grip = true): THREE.Mesh {
  const s = side === 'right' ? -1 : 1; // lado do polegar com a palma para baixo
  const b = new Builder();
  // palma + protetor de nós dos dedos
  b.box(PAL.glove, 0.074, 0.034, 0.08, 0, 0, 0);
  b.box(PAL.glovePad, 0.06, 0.01, 0.03, 0, 0.02, -0.025);
  // dedos (bloco único), curvados para baixo se segurando
  if (grip) {
    b.box(PAL.glove, 0.07, 0.032, 0.036, 0, -0.012, -0.05, -0.55);
    b.box(PAL.glovePad, 0.068, 0.03, 0.03, 0, -0.04, -0.06, -1.4);
  } else {
    b.box(PAL.glove, 0.07, 0.026, 0.06, 0, -0.006, -0.065, -0.25);
  }
  // polegar
  b.box(PAL.glove, 0.024, 0.024, 0.052, s * 0.044, -0.012, -0.03, 0, s * -0.35, 0);
  // pulso da luva com velcro
  b.box(PAL.glove, 0.064, 0.054, 0.06, 0, 0, 0.068);
  b.box(PAL.glovePad, 0.066, 0.02, 0.03, 0, 0.022, 0.075);
  // punho da manga
  b.box(PAL.cuff, 0.078, 0.07, 0.04, 0, 0, 0.115);
  // manga
  b.box(PAL.sleeve, 0.082, 0.076, 0.5, 0, 0, 0.385);
  b.box(PAL.sleeveDark, 0.084, 0.012, 0.44, 0, -0.03, 0.4);
  if (side === 'left') {
    // relógio de pulso
    b.box(PAL.black, 0.07, 0.06, 0.02, 0, 0, 0.1);
    b.box(PAL.steel, 0.03, 0.01, 0.024, 0, 0.033, 0.1);
  }
  return b.mesh(vmMaterial);
}

export interface Pose {
  p: THREE.Vector3;
  r: THREE.Euler;
}

export const pose = (x: number, y: number, z: number, rx: number, ry: number, rz: number): Pose => ({
  p: new THREE.Vector3(x, y, z),
  r: new THREE.Euler(rx, ry, rz, 'YXZ'),
});

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/** Aplica interpolação entre duas poses num objeto (sem alocar). */
export function applyPose(o: THREE.Object3D, a: Pose, b: Pose, t: number): void {
  o.position.lerpVectors(a.p, b.p, t);
  _qa.setFromEuler(a.r);
  _qb.setFromEuler(b.r);
  o.quaternion.slerpQuaternions(_qa, _qb, t);
}
