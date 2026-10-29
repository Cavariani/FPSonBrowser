import * as THREE from 'three';
import type { WeaponId } from '../../game/weaponDefs';
import { buildArm, pose, type Pose } from './arms';
import { Builder, PAL, vmMaterial } from './build';

export type ReloadKind = 'mag' | 'shells' | 'bolt' | 'none';

/** Ajuste de "feel" por arma (viewmodel). Ângulos em rad, distâncias em m. */
export interface Feel {
  /** Recuo para trás (z). */
  back: number;
  /** Levantada do cano (pitch). */
  up: number;
  /** Subida em y. */
  rise: number;
  /** Aleatório lateral (yaw/roll). */
  side: number;
  /** Mola do recuo: rigidez e amortecimento. */
  k: number;
  c: number;
  /** Multiplicador de bob/sway (armas pesadas balançam mais devagar e mais). */
  bob: number;
  sway: number;
  flash: number;
}

export interface WeaponModel {
  id: WeaponId;
  /** Origem = ponto do cabo onde fica a mão direita. */
  root: THREE.Group;
  /** Posição/rotação de descanso no espaço da câmera do viewmodel. */
  hipPos: THREE.Vector3;
  /** ADS: altura da linha de mira (y no espaço da arma) e z do holder quando mirando. */
  sightY: number;
  adsZ: number;
  hipRot: THREE.Euler;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  mag?: THREE.Object3D;
  magRest?: THREE.Vector3;
  /** Ferrolho da pistola / alavanca de manejo (desliza em +z). */
  slide?: THREE.Object3D;
  pump?: THREE.Object3D;
  bolt?: THREE.Object3D;
  /** Lâmina da faca (grupo animado no golpe). */
  top?: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftArm: THREE.Object3D | null;
  rightHold: Pose;
  leftHold: Pose | null;
  reload: ReloadKind;
  feel: Feel;
  casing: 'brass' | 'shell' | 'none';
}

let armR: THREE.BufferGeometry | null = null;
let armL: THREE.BufferGeometry | null = null;
let armLOpen: THREE.BufferGeometry | null = null;

function arm(side: 'right' | 'left', grip = true): THREE.Mesh {
  if (!armR) {
    armR = buildArm('right', true).geometry;
    armL = buildArm('left', true).geometry;
    armLOpen = buildArm('left', false).geometry;
  }
  const g = side === 'right' ? armR! : grip ? armL! : armLOpen!;
  const m = new THREE.Mesh(g, vmMaterial);
  m.frustumCulled = false;
  return m;
}

function anchor(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

const feel = (f: Partial<Feel>): Feel => ({ back: 0.02, up: 0.04, rise: 0.004, side: 0.01, k: 260, c: 22, bob: 1, sway: 1, flash: 1, ...f });

// ------------------------------------------------------------------ armas

function smg(): WeaponModel {
  const root = new THREE.Group();
  const b = new Builder();
  // corpo
  b.box(PAL.graphite, 0.05, 0.07, 0.27, 0, 0.065, -0.08);
  b.box(PAL.black, 0.052, 0.018, 0.24, 0, 0.105, -0.08); // trilho
  // red dot simples no trilho
  b.box(PAL.black, 0.03, 0.012, 0.045, 0, 0.12, -0.05);
  b.box(PAL.black, 0.005, 0.034, 0.012, -0.0155, 0.14, -0.062);
  b.box(PAL.black, 0.005, 0.034, 0.012, 0.0155, 0.14, -0.062);
  b.box(PAL.black, 0.036, 0.005, 0.012, 0, 0.159, -0.062);
  // cano/guarda-mão
  b.box(PAL.black, 0.044, 0.05, 0.1, 0, 0.065, -0.26);
  b.cylZ(PAL.steel, 0.012, 0.07, 0, 0.068, -0.34);
  b.cylZ(PAL.black, 0.017, 0.035, 0, 0.068, -0.375);
  // empunhadura + guarda-mato
  b.box(PAL.black, 0.034, 0.1, 0.044, 0, -0.012, 0.012, -0.25);
  b.box(PAL.black, 0.01, 0.008, 0.07, 0, 0.012, -0.04);
  b.box(PAL.steel, 0.006, 0.02, 0.006, 0, 0.026, -0.03);
  // empunhadura frontal
  b.box(PAL.black, 0.03, 0.08, 0.036, 0, 0.0, -0.25, 0.12);
  // coronha dobrável (arame)
  b.box(PAL.steel, 0.008, 0.008, 0.1, 0.018, 0.07, 0.1);
  b.box(PAL.steel, 0.008, 0.008, 0.1, -0.018, 0.07, 0.1);
  b.box(PAL.black, 0.046, 0.05, 0.014, 0, 0.06, 0.15);
  // detalhe laranja (seletor)
  b.box(PAL.orange, 0.006, 0.012, 0.016, -0.027, 0.06, -0.01);
  root.add(b.mesh(vmMaterial));
  const dot = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0035, 0.002), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  dot.position.set(0, 0.14, -0.066);
  root.add(dot);

  // pente reto
  const mag = new THREE.Group();
  const mb = new Builder();
  mb.box(PAL.black, 0.028, 0.15, 0.038, 0, -0.07, 0, 0.08);
  mb.box(PAL.steel, 0.032, 0.012, 0.042, 0, -0.145, 0.006, 0.08);
  mag.add(mb.mesh(vmMaterial));
  mag.position.set(0, 0.035, -0.15);
  root.add(mag);

  // alavanca de manejo (desliza)
  const slide = new THREE.Group();
  slide.add(new Builder().box(PAL.steel, 0.016, 0.014, 0.022, -0.032, 0.085, 0).mesh(vmMaterial));
  slide.position.set(0, 0, -0.17);
  root.add(slide);



  const rightArm = arm('right');
  const leftArm = arm('left');
  root.add(rightArm, leftArm);
  return {
    id: 'smg', root,
    hipPos: new THREE.Vector3(0.19, -0.18, -0.44), hipRot: new THREE.Euler(0.07, 0.13, 0, 'YXZ'),
    sightY: 0.14, adsZ: -0.2,
    muzzle: anchor(root, 0, 0.068, -0.4), eject: anchor(root, 0.03, 0.08, -0.06),
    mag, magRest: mag.position.clone(), slide,
    rightArm, leftArm,
    rightHold: pose(0.028, -0.012, 0.01, 0.45, 0.32, -1.45),
    leftHold: pose(-0.022, -0.01, -0.25, 0.75, -0.42, 1.55),
    reload: 'mag', casing: 'brass',
    feel: feel({ back: 0.012, up: 0.022, rise: 0.003, side: 0.012, k: 360, c: 26, bob: 0.9, sway: 0.9, flash: 0.75 }),
  };
}

function rifle(): WeaponModel {
  const root = new THREE.Group();
  const b = new Builder();
  // receptor
  b.box(PAL.graphite, 0.048, 0.064, 0.3, 0, 0.06, -0.07);
  b.box(PAL.steel, 0.044, 0.022, 0.27, 0, 0.1, -0.06); // tampa
  // alça de mira (entalhe: dois postes)
  b.box(PAL.black, 0.024, 0.008, 0.03, 0, 0.11, -0.21);
  b.box(PAL.black, 0.007, 0.034, 0.012, -0.0075, 0.127, -0.21);
  b.box(PAL.black, 0.007, 0.034, 0.012, 0.0075, 0.127, -0.21);
  // guarda-mão de madeira
  b.box(PAL.wood, 0.054, 0.046, 0.2, 0, 0.055, -0.32);
  b.box(PAL.woodDark, 0.056, 0.008, 0.18, 0, 0.04, -0.32);
  b.box(PAL.wood, 0.042, 0.026, 0.17, 0, 0.096, -0.31); // tubo de gás em madeira
  // cano e massa
  b.cylZ(PAL.steel, 0.011, 0.24, 0, 0.068, -0.53);
  b.box(PAL.black, 0.006, 0.06, 0.01, 0, 0.105, -0.6);
  b.box(PAL.black, 0.02, 0.012, 0.014, 0, 0.08, -0.6);
  b.box(PAL.graphite, 0.026, 0.026, 0.05, 0, 0.068, -0.66); // quebra-chamas
  b.cylZ(PAL.steel, 0.006, 0.18, 0, 0.096, -0.48); // tubo de gás
  // empunhadura
  b.box(PAL.woodDark, 0.034, 0.1, 0.044, 0, -0.012, 0.012, -0.3);
  b.box(PAL.black, 0.01, 0.008, 0.07, 0, 0.014, -0.045);
  b.box(PAL.black, 0.01, 0.025, 0.008, 0, 0.003, -0.08);
  b.box(PAL.steel, 0.006, 0.02, 0.006, 0, 0.022, -0.035);
  // coronha
  b.box(PAL.wood, 0.042, 0.06, 0.2, 0, 0.042, 0.17, 0.12);
  b.box(PAL.wood, 0.044, 0.085, 0.06, 0, 0.022, 0.28, 0.12);
  b.box(PAL.black, 0.046, 0.09, 0.012, 0, 0.018, 0.315, 0.12);
  root.add(b.mesh(vmMaterial));

  // pente curvo laranja-baquelite (AK)
  const mag = new THREE.Group();
  const mb = new Builder();
  mb.box(PAL.orange, 0.032, 0.06, 0.06, 0, -0.03, 0, 0.12);
  mb.box(PAL.orange, 0.032, 0.06, 0.058, 0, -0.085, -0.014, 0.3);
  mb.box(PAL.orange, 0.032, 0.06, 0.056, 0, -0.137, -0.038, 0.5);
  mb.box(0xa64420, 0.034, 0.012, 0.058, 0, -0.164, -0.054, 0.5);
  mag.add(mb.mesh(vmMaterial));
  mag.position.set(0, 0.03, -0.115);
  root.add(mag);

  const slide = new THREE.Group();
  slide.add(new Builder().box(PAL.chrome, 0.02, 0.012, 0.016, 0.032, 0.075, 0).mesh(vmMaterial));
  slide.position.set(0, 0, -0.08);
  root.add(slide);


  const rightArm = arm('right');
  const leftArm = arm('left');
  root.add(rightArm, leftArm);
  return {
    id: 'rifle', root,
    hipPos: new THREE.Vector3(0.2, -0.19, -0.47), hipRot: new THREE.Euler(0.07, 0.135, 0, 'YXZ'),
    sightY: 0.135, adsZ: -0.17,
    muzzle: anchor(root, 0, 0.068, -0.69), eject: anchor(root, 0.03, 0.08, -0.08),
    mag, magRest: mag.position.clone(), slide,
    rightArm, leftArm,
    rightHold: pose(0.028, -0.012, 0.012, 0.45, 0.32, -1.45),
    leftHold: pose(-0.03, 0.03, -0.33, 0.75, -0.5, 1.75),
    reload: 'mag', casing: 'brass',
    feel: feel({ back: 0.02, up: 0.035, rise: 0.004, side: 0.014, k: 300, c: 24, bob: 1.0, sway: 1.0, flash: 1 }),
  };
}

function shotgun(): WeaponModel {
  const root = new THREE.Group();
  const b = new Builder();
  b.box(PAL.graphite, 0.05, 0.07, 0.2, 0, 0.065, -0.06);
  b.box(PAL.black, 0.04, 0.012, 0.18, 0, 0.104, -0.06);
  b.cylZ(PAL.steel, 0.015, 0.56, 0, 0.088, -0.43, 7);
  b.cylZ(PAL.graphite, 0.012, 0.44, 0, 0.052, -0.38, 6);
  b.box(PAL.graphite, 0.022, 0.03, 0.02, 0, 0.07, -0.62);
  b.box(PAL.steel, 0.01, 0.022, 0.03, 0, 0.108, -0.68);
  b.box(PAL.gold, 0.009, 0.012, 0.01, 0, 0.124, -0.69); // conta (massa)
  b.box(PAL.black, 0.02, 0.006, 0.04, 0, 0.11, -0.04); // sulco de mira no receptor
  // empunhadura + coronha madeira
  b.box(PAL.wood, 0.036, 0.1, 0.046, 0, -0.012, 0.016, -0.32);
  b.box(PAL.wood, 0.044, 0.07, 0.24, 0, 0.03, 0.17, 0.16);
  b.box(PAL.woodDark, 0.048, 0.1, 0.016, 0, 0.005, 0.29, 0.16);
  b.box(PAL.black, 0.01, 0.008, 0.07, 0, 0.018, -0.045);
  b.box(PAL.steel, 0.006, 0.02, 0.006, 0, 0.026, -0.035);
  // cartuchos de reserva (porta-cartuchos lateral)
  for (let i = 0; i < 4; i++) {
    b.box(PAL.red, 0.012, 0.042, 0.016, -0.031, 0.062, -0.12 + i * 0.022);
    b.box(PAL.brass, 0.013, 0.012, 0.017, -0.031, 0.036, -0.12 + i * 0.022);
  }
  b.box(PAL.black, 0.004, 0.03, 0.1, -0.026, 0.062, -0.087);
  root.add(b.mesh(vmMaterial));

  const pump = new THREE.Group();
  const pb = new Builder();
  pb.box(PAL.wood, 0.052, 0.046, 0.17, 0, 0.052, 0);
  for (let i = 0; i < 5; i++) pb.box(PAL.woodDark, 0.054, 0.048, 0.008, 0, 0.052, -0.06 + i * 0.03);
  pump.add(pb.mesh(vmMaterial));
  pump.position.set(0, 0, -0.38);
  root.add(pump);


  const rightArm = arm('right');
  const leftArm = arm('left', false);
  root.add(rightArm, leftArm);
  return {
    id: 'shotgun', root,
    hipPos: new THREE.Vector3(0.2, -0.19, -0.46), hipRot: new THREE.Euler(0.07, 0.135, 0, 'YXZ'),
    sightY: 0.13, adsZ: -0.22,
    muzzle: anchor(root, 0, 0.088, -0.72), eject: anchor(root, 0.03, 0.08, -0.06),
    pump,
    rightArm, leftArm,
    rightHold: pose(0.029, -0.012, 0.016, 0.45, 0.32, -1.45),
    leftHold: pose(-0.032, 0.03, -0.38, 0.6, -0.45, 1.9),
    reload: 'shells', casing: 'shell',
    feel: feel({ back: 0.075, up: 0.2, rise: 0.012, side: 0.03, k: 150, c: 14, bob: 1.1, sway: 1.15, flash: 1.6 }),
  };
}

function sniper(): WeaponModel {
  const root = new THREE.Group();
  const b = new Builder();
  b.box(PAL.graphite, 0.044, 0.056, 0.26, 0, 0.065, -0.05);
  b.cylZ(PAL.black, 0.012, 0.5, 0, 0.072, -0.43, 7);
  b.box(PAL.graphite, 0.03, 0.03, 0.06, 0, 0.072, -0.7); // freio de boca
  b.box(PAL.black, 0.032, 0.008, 0.02, 0, 0.072, -0.69);
  // coronha tan
  b.box(PAL.tan, 0.05, 0.05, 0.26, 0, 0.04, -0.21);
  b.box(PAL.tan, 0.036, 0.1, 0.044, 0, -0.012, 0.016, -0.3);
  b.box(PAL.tan, 0.044, 0.07, 0.24, 0, 0.045, 0.17, 0.06);
  b.box(PAL.tan, 0.046, 0.1, 0.08, 0, 0.02, 0.27, 0.06);
  b.box(PAL.black, 0.048, 0.105, 0.016, 0, 0.018, 0.315, 0.06);
  b.box(PAL.black, 0.01, 0.008, 0.06, 0, 0.018, -0.04);
  // luneta
  b.cylZ(PAL.black, 0.02, 0.2, 0, 0.13, -0.08, 8);
  b.cylZ(PAL.black, 0.03, 0.06, 0, 0.13, -0.2, 8, 0.02);
  b.cylZ(PAL.black, 0.026, 0.04, 0, 0.13, 0.03, 8);
  b.box(PAL.steel, 0.018, 0.04, 0.02, 0, 0.1, -0.13);
  b.box(PAL.steel, 0.018, 0.04, 0.02, 0, 0.1, -0.01);
  b.box(PAL.steel, 0.014, 0.016, 0.016, 0, 0.156, -0.07); // torre
  b.box(PAL.steel, 0.016, 0.014, 0.016, -0.024, 0.13, -0.07);
  // lente azulada
  b.cylZ(0x6fb6e8, 0.026, 0.004, 0, 0.13, -0.232, 8);
  root.add(b.mesh(vmMaterial));

  const bolt = new THREE.Group();
  const bb = new Builder();
  bb.box(PAL.chrome, 0.05, 0.01, 0.01, 0.026, 0, 0);
  bb.box(PAL.black, 0.02, 0.02, 0.02, 0.052, -0.006, 0.004);
  bb.box(PAL.steel, 0.02, 0.02, 0.07, 0, 0, -0.02);
  bolt.add(bb.mesh(vmMaterial));
  bolt.position.set(0, 0.075, 0.03);
  root.add(bolt);

  const mag = new THREE.Group();
  mag.add(new Builder().box(PAL.black, 0.03, 0.05, 0.06, 0, -0.025, 0).box(PAL.steel, 0.032, 0.008, 0.062, 0, -0.05, 0).mesh(vmMaterial));
  mag.position.set(0, 0.03, -0.1);
  root.add(mag);


  const rightArm = arm('right');
  const leftArm = arm('left');
  root.add(rightArm, leftArm);
  return {
    id: 'sniper', root,
    hipPos: new THREE.Vector3(0.2, -0.19, -0.48), hipRot: new THREE.Euler(0.07, 0.13, 0, 'YXZ'),
    sightY: 0.13, adsZ: -0.1,
    muzzle: anchor(root, 0, 0.072, -0.74), eject: anchor(root, 0.03, 0.08, 0.0),
    mag, magRest: mag.position.clone(), bolt,
    rightArm, leftArm,
    rightHold: pose(0.029, -0.012, 0.016, 0.45, 0.32, -1.45),
    leftHold: pose(-0.033, 0.02, -0.28, 0.75, -0.5, 1.8),
    reload: 'bolt', casing: 'brass',
    feel: feel({ back: 0.09, up: 0.22, rise: 0.014, side: 0.03, k: 140, c: 13, bob: 1.15, sway: 1.25, flash: 1.5 }),
  };
}

function pistol(): WeaponModel {
  const root = new THREE.Group();
  const b = new Builder();
  b.box(PAL.black, 0.03, 0.03, 0.15, 0, 0.042, -0.055);
  b.box(PAL.black, 0.032, 0.1, 0.044, 0, -0.008, 0.006, -0.22);
  b.box(PAL.graphite, 0.033, 0.06, 0.03, 0, -0.01, 0.01, -0.22); // textura do cabo
  b.box(PAL.black, 0.008, 0.008, 0.055, 0, 0.012, -0.05);
  b.box(PAL.black, 0.008, 0.024, 0.008, 0, 0.022, -0.078);
  b.box(PAL.steel, 0.005, 0.016, 0.005, 0, 0.026, -0.04);
  b.box(PAL.chrome, 0.012, 0.006, 0.006, 0, -0.063, 0.02); // argola do cordão
  root.add(b.mesh(vmMaterial));

  const slide = new THREE.Group();
  const sb = new Builder();
  sb.box(PAL.steel, 0.032, 0.034, 0.18, 0, 0, -0.06);
  for (let i = 0; i < 4; i++) sb.box(PAL.graphite, 0.034, 0.026, 0.005, 0, 0, 0.012 + i * 0.01);
  sb.box(PAL.black, 0.009, 0.01, 0.01, -0.0085, 0.021, 0.02);
  sb.box(PAL.black, 0.009, 0.01, 0.01, 0.0085, 0.021, 0.02);
  sb.box(PAL.white, 0.003, 0.003, 0.002, -0.0085, 0.022, 0.0145);
  sb.box(PAL.white, 0.003, 0.003, 0.002, 0.0085, 0.022, 0.0145);
  sb.box(PAL.black, 0.006, 0.01, 0.008, 0, 0.021, -0.14);
  sb.box(0x7dff6a, 0.0035, 0.0035, 0.002, 0, 0.0225, -0.1355);
  sb.box(PAL.graphite, 0.022, 0.012, 0.03, 0.006, 0.006, -0.03); // janela de ejeção
  slide.add(sb.mesh(vmMaterial));
  slide.position.set(0, 0.073, 0);
  root.add(slide);

  const mag = new THREE.Group();
  mag.add(new Builder().box(PAL.steel, 0.024, 0.09, 0.034, 0, -0.04, 0, -0.22).box(PAL.black, 0.034, 0.012, 0.048, -0.0, -0.088, 0.02, -0.22).mesh(vmMaterial));
  mag.position.set(0, 0.012, 0.0);
  root.add(mag);


  const rightArm = arm('right');
  const leftArm = arm('left');
  root.add(rightArm, leftArm);
  return {
    id: 'pistol', root,
    hipPos: new THREE.Vector3(0.14, -0.15, -0.38), hipRot: new THREE.Euler(0.05, 0.12, 0, 'YXZ'),
    sightY: 0.099, adsZ: -0.2,
    muzzle: anchor(root, 0, 0.073, -0.16), eject: anchor(root, 0.02, 0.08, -0.03),
    mag, magRest: mag.position.clone(), slide,
    rightArm, leftArm,
    rightHold: pose(0.026, -0.012, 0.012, 0.42, 0.3, -1.45),
    leftHold: pose(-0.03, -0.022, 0.02, 0.55, -0.55, 1.2),
    reload: 'mag', casing: 'brass',
    feel: feel({ back: 0.035, up: 0.14, rise: 0.008, side: 0.02, k: 330, c: 22, bob: 0.85, sway: 0.8, flash: 0.9 }),
  };
}

function knife(): WeaponModel {
  const root = new THREE.Group();
  const b = new Builder();
  // cabo (origem = centro da mão), lâmina aponta -z e um pouco para cima
  b.box(PAL.black, 0.03, 0.036, 0.11, 0, 0, 0.01);
  for (let i = 0; i < 4; i++) b.box(PAL.graphite, 0.032, 0.038, 0.008, 0, 0, -0.03 + i * 0.022);
  b.box(PAL.steel, 0.034, 0.04, 0.016, 0, 0, 0.072); // pomo
  b.box(PAL.steel, 0.07, 0.016, 0.014, 0, 0.004, -0.05); // guarda
  // lâmina: corpo + gume claro + ponta
  b.box(PAL.steel, 0.008, 0.04, 0.17, 0, 0.006, -0.14);
  b.box(PAL.chrome, 0.006, 0.012, 0.17, 0, -0.016, -0.14);
  b.box(PAL.graphite, 0.009, 0.008, 0.12, 0, 0.024, -0.12); // dorso
  b.box(PAL.steel, 0.008, 0.03, 0.05, 0, -0.002, -0.235, -0.45);
  b.box(PAL.chrome, 0.006, 0.01, 0.04, 0, -0.016, -0.24, -0.75);
  // serrilha no dorso
  for (let i = 0; i < 4; i++) b.box(PAL.graphite, 0.009, 0.01, 0.01, 0, 0.03, -0.09 - i * 0.022, 0.6);
  const blade = new THREE.Group();
  blade.add(b.mesh(vmMaterial));
  root.add(blade);

  const rightArm = arm('right');
  root.add(rightArm);
  return {
    id: 'knife', root,
    hipPos: new THREE.Vector3(0.17, -0.17, -0.36), hipRot: new THREE.Euler(0.3, 0.34, -0.35, 'YXZ'),
    sightY: 0, adsZ: -0.27,
    muzzle: anchor(root, 0, 0, -0.25), eject: anchor(root, 0, 0, 0),
    top: blade,
    rightArm, leftArm: null,
    rightHold: pose(0.026, -0.006, 0.01, 0.45, 0.32, -1.45),
    leftHold: null,
    reload: 'none', casing: 'none',
    feel: feel({ bob: 1.0, sway: 1.1, flash: 0 }),
  };
}

export function buildWeapons(): Record<WeaponId, WeaponModel> {
  return { smg: smg(), rifle: rifle(), shotgun: shotgun(), sniper: sniper(), pistol: pistol(), knife: knife() };
}
