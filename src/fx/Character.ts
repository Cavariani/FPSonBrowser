import * as THREE from 'three';
import type { SpecialId } from '../game/special/defs';
import type { WeaponId } from '../game/weaponDefs';
import { blobTexture } from '../render/textures';
import { partsGeo, sym, type Part } from './char/geo';
import { GRIPS, weaponGeo } from './char/weapons';
import { buildHeldModel, HELD_TP } from './special/models';

export interface CharacterPose {
  /** Velocidade horizontal (m/s) — dirige o ciclo de andar. */
  speed: number;
  grounded: boolean;
  crouched: boolean;
  /** Pitch da mira (rad) — inclina tronco/braços. */
  pitch: number;
  weapon: WeaponId;
  /** Arma maluca na mão (substitui a arma comum). */
  special?: SpecialId | null;
}

// ------------------------------------------------------------------ materiais compartilhados

let MAT: THREE.MeshLambertMaterial | null = null;
let FLASH_W: THREE.MeshBasicMaterial | null = null;
let FLASH_R: THREE.MeshBasicMaterial | null = null;
let SHADOW_MAT: THREE.MeshBasicMaterial | null = null;
let SHADOW_GEO: THREE.PlaneGeometry | null = null;

let PAPER_GEO: THREE.BufferGeometry | null = null;
let TAPE_GEO: THREE.BufferGeometry | null = null;
let TAPE_MAT: THREE.MeshLambertMaterial | null = null;

/** Folha levemente curvada (bordas pra trás), virada para -z. */
function paperRes() {
  if (!PAPER_GEO) {
    const g = new THREE.PlaneGeometry(PAPER_W, PAPER_H, 4, 3);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, -(x * x) * 1.4 - Math.max(0, -y - 0.12) * 0.25);
    }
    g.rotateY(Math.PI);
    g.computeVertexNormals();
    PAPER_GEO = g;
    TAPE_GEO = new THREE.BoxGeometry(0.2, 0.055, 0.006);
    TAPE_MAT = new THREE.MeshLambertMaterial({ color: 0xe6d3a3, transparent: true, opacity: 0.86 });
  }
  return { geo: PAPER_GEO, tapeGeo: TAPE_GEO!, tapeMat: TAPE_MAT! };
}

const PAPER_W = 0.34, PAPER_H = 0.42;

/** Compõe a foto numa "folha" branca (aspect-fit centralizado). */
function composePaper(tex: THREE.Texture): THREE.Texture {
  const img = tex.image as (CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number }) | undefined;
  const iw = img ? (img.videoWidth || img.width || 0) : 0;
  const ih = img ? (img.videoHeight || img.height || 0) : 0;
  if (!img || !iw || !ih) return tex;
  const W = 170, H = 210;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f6f4ee';
  ctx.fillRect(0, 0, W, H);
  const m = 10;
  const k = Math.min((W - 2 * m) / iw, (H - 2 * m) / ih);
  const dw = iw * k, dh = ih * k;
  try {
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } catch {
    return tex;
  }
  // amassadinho: uma dobra e sombra de leve
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  ctx.fillRect(0, H * 0.48, W, 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function mats() {
  if (!MAT) {
    MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
    FLASH_W = new THREE.MeshBasicMaterial({ color: 0xffffff });
    FLASH_R = new THREE.MeshBasicMaterial({ color: 0xff3a2a });
    SHADOW_MAT = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    SHADOW_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
  return { mat: MAT, white: FLASH_W!, red: FLASH_R!, shadowMat: SHADOW_MAT!, shadowGeo: SHADOW_GEO! };
}

// ------------------------------------------------------------------ paletas

const SKIN = [0xf1c7a1, 0xe3b088, 0xc68b5e, 0xa46c45, 0x7a4a2c, 0x5a3520];
const PANTS = [0x5b5a3c, 0x8a7a55, 0x3f444b, 0x2c2c30, 0x6b5a45, 0x6e7350];
const BOOTS = [0x3a2a1e, 0x1e1e20, 0x6b5233];
const HAIR = [0x1e1611, 0x3b2a1c, 0x6b4a2b, 0xb08a4a, 0x111111, 0x8a8a8a];
const UNDER = [0x4a4f3a, 0x2e3033, 0x6b6e5a, 0x7d6b4f];
const HELMET = [0x55603f, 0x8f7b55, 0x3d4237];
const CAP = [0x1d3f6e, 0xc23b2b, 0x2e3033, 0x8f7b55, 0x3f8a3c];
const BANDANA = [0xb3261e, 0x1e1e20, 0x2f6aa6];

const dark = (hex: number, k: number) => {
  const r = ((hex >> 16) & 255) * k, g = ((hex >> 8) & 255) * k, b = (hex & 255) * k;
  return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
};

interface Look {
  skin: number; pants: number; boots: number; hair: number; under: number;
  vest: boolean; hairStyle: number; gear: number; gearColor: number; shades: boolean; beard: boolean;
  gloves: boolean; radio: boolean; capBack: boolean;
}

function makeLook(seed: number): Look {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const r = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const gear = Math.floor(r() * 5); // 0 nada, 1 capacete, 2 boné, 3 bandana, 4 balaclava
  return {
    skin: pick(SKIN), pants: pick(PANTS), boots: pick(BOOTS), hair: pick(HAIR), under: pick(UNDER),
    vest: r() < 0.5,
    hairStyle: Math.floor(r() * 5),
    gear,
    gearColor: gear === 1 ? pick(HELMET) : gear === 2 ? pick(CAP) : gear === 3 ? pick(BANDANA) : 0x1a1a1a,
    shades: r() < 0.35,
    beard: r() < 0.3,
    gloves: r() < 0.5,
    radio: r() < 0.25,
    capBack: r() < 0.35,
  };
}

// ------------------------------------------------------------------ partes

const HIP = 0.92;
const TORSO_H = 0.52;
const SHOULDER_Y = 0.43;
const ARM_REACH = 0.47;

function torsoParts(color: number, L: Look): Part[] {
  const p: Part[] = [];
  if (L.vest) {
    p.push(sym(0.232, 0.0, TORSO_H, -0.132, 0.132, L.under));
    p.push(sym(0.248, 0.07, TORSO_H - 0.03, -0.152, 0.152, color));
    const pc = dark(color, 0.68);
    for (const cx of [-0.12, 0, 0.12]) p.push(sym(0.048, 0.12, 0.26, -0.185, -0.152, pc, cx));
    p.push(sym(0.06, 0.3, 0.4, -0.172, -0.152, pc, -0.12));
    p.push(sym(0.05, TORSO_H - 0.04, TORSO_H + 0.005, -0.15, 0.15, color, -0.17));
    p.push(sym(0.05, TORSO_H - 0.04, TORSO_H + 0.005, -0.15, 0.15, color, 0.17));
  } else {
    p.push(sym(0.24, 0.0, TORSO_H, -0.14, 0.14, color));
    p.push(sym(0.09, TORSO_H - 0.06, TORSO_H + 0.003, -0.145, -0.1, dark(color, 0.8)));
    // alça cruzada (bandoleira)
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      p.push(sym(0.03, 0.08 + t * 0.38, 0.14 + t * 0.38, -0.162, -0.14, 0x3a2a1e, -0.18 + t * 0.36));
    }
  }
  // cinto e bolsinhas
  p.push(sym(0.252, -0.03, 0.07, -0.152, 0.152, 0x2a241c));
  p.push(sym(0.035, -0.01, 0.055, -0.165, -0.152, 0xb8a060));
  const pc = dark(L.pants, 0.75);
  p.push(sym(0.045, -0.02, 0.1, -0.18, -0.1, pc, 0.17));
  p.push(sym(0.045, -0.02, 0.1, -0.18, -0.1, pc, -0.17));
  if (L.radio) {
    p.push(sym(0.15, 0.12, 0.46, 0.14, 0.29, 0x55603f));
    p.push(sym(0.012, 0.46, 0.92, 0.2, 0.22, 0x1e1e20, 0.1));
  }
  return p;
}

function headParts(L: Look): Part[] {
  const p: Part[] = [];
  const bala = L.gear === 4;
  const skin = L.skin;
  const headCol = bala ? 0x1d1d20 : skin;
  p.push(sym(0.07, -0.01, 0.06, -0.07, 0.07, bala ? headCol : dark(skin, 0.9)));
  p.push(sym(0.17, 0.05, 0.39, -0.17, 0.17, headCol));
  if (bala) p.push(sym(0.14, 0.19, 0.29, -0.176, -0.12, skin));
  // olhos / sobrancelha / nariz / boca
  if (L.shades) {
    p.push(sym(0.15, 0.2, 0.27, -0.188, -0.172, 0x111111));
    p.push(sym(0.05, 0.215, 0.25, -0.19, -0.186, 0x3b5c7a, -0.075));
    p.push(sym(0.05, 0.215, 0.25, -0.19, -0.186, 0x3b5c7a, 0.075));
  } else {
    p.push(sym(0.026, 0.2, 0.26, -0.182, -0.168, 0x161616, -0.075));
    p.push(sym(0.026, 0.2, 0.26, -0.182, -0.168, 0x161616, 0.075));
    if (!bala) {
      p.push(sym(0.045, 0.28, 0.305, -0.18, -0.168, L.hair, -0.075));
      p.push(sym(0.045, 0.28, 0.305, -0.18, -0.168, L.hair, 0.075));
    }
  }
  if (!bala) {
    p.push(sym(0.026, 0.14, 0.21, -0.205, -0.168, dark(skin, 0.86)));
    if (L.beard) p.push(sym(0.172, 0.05, 0.15, -0.178, 0.02, L.hair));
    p.push(sym(0.055, 0.095, 0.115, -0.186, -0.168, 0x5a2a20));
  }
  // cabelo (escondido pelo capacete/boné quando tem)
  const covered = L.gear === 1 || L.gear === 2 || bala;
  if (!bala) {
    switch (L.hairStyle) {
      case 1:
      case 4:
        if (!covered) p.push(sym(0.176, 0.37, 0.43, -0.176, 0.176, L.hair));
        p.push(sym(0.176, 0.2, 0.39, 0.13, 0.182, L.hair));
        p.push(sym(0.006, 0.26, 0.39, -0.06, 0.17, L.hair, 0.172));
        p.push(sym(0.006, 0.26, 0.39, -0.06, 0.17, L.hair, -0.172));
        if (L.hairStyle === 4) p.push(sym(0.04, 0.12, 0.33, 0.18, 0.27, L.hair));
        break;
      case 2:
        if (!covered) p.push(sym(0.035, 0.37, 0.52, -0.16, 0.18, L.hair));
        break;
      case 3:
        if (!covered) p.push(sym(0.173, 0.37, 0.405, -0.173, 0.173, L.hair));
        p.push(sym(0.006, 0.2, 0.33, -0.04, 0.06, L.hair, 0.172));
        p.push(sym(0.006, 0.2, 0.33, -0.04, 0.06, L.hair, -0.172));
        break;
    }
  }
  const gc = L.gearColor;
  switch (L.gear) {
    case 1: // capacete
      p.push(sym(0.205, 0.31, 0.49, -0.2, 0.2, gc));
      p.push(sym(0.218, 0.29, 0.33, -0.218, 0.218, dark(gc, 0.85)));
      p.push(sym(0.13, 0.4, 0.46, -0.222, -0.2, 0x222222));
      p.push(sym(0.045, 0.41, 0.45, -0.226, -0.218, 0x6fc3df, -0.065));
      p.push(sym(0.045, 0.41, 0.45, -0.226, -0.218, 0x6fc3df, 0.065));
      break;
    case 2: { // boné
      p.push(sym(0.18, 0.36, 0.47, -0.18, 0.18, gc));
      const brim = L.capBack ? sym(0.15, 0.36, 0.39, 0.18, 0.33, dark(gc, 0.85)) : sym(0.15, 0.36, 0.39, -0.33, -0.18, dark(gc, 0.85));
      p.push(brim);
      p.push(sym(0.03, 0.47, 0.49, -0.03, 0.03, dark(gc, 0.7)));
      break;
    }
    case 3: // bandana
      p.push(sym(0.178, 0.29, 0.35, -0.178, 0.178, gc));
      p.push(sym(0.03, 0.18, 0.33, 0.178, 0.23, gc, 0.05));
      p.push(sym(0.025, 0.2, 0.32, 0.178, 0.25, dark(gc, 0.8), -0.04));
      break;
  }
  return p;
}

function armParts(color: number, L: Look): Part[] {
  const hand = L.gloves ? 0x1e1e20 : L.skin;
  if (L.vest) {
    return [
      sym(0.068, -0.068, 0.068, -0.42, 0.06, L.under),
      sym(0.072, -0.072, 0.072, -0.13, -0.06, color),
      sym(0.058, -0.058, 0.058, -0.52, -0.42, hand),
    ];
  }
  return [
    sym(0.076, -0.076, 0.076, -0.17, 0.06, color),
    sym(0.06, -0.06, 0.06, -0.42, -0.17, L.skin),
    sym(0.058, -0.058, 0.058, -0.52, -0.42, hand),
  ];
}

function thighParts(L: Look, side: number): Part[] {
  const pc = dark(L.pants, 0.78);
  return [
    sym(0.1, -0.44, 0.03, -0.11, 0.11, L.pants),
    // bolso cargo do lado de fora
    [side < 0 ? -0.118 : 0.1, -0.3, -0.07, side < 0 ? -0.1 : 0.118, -0.15, 0.07, pc],
  ];
}

function shinParts(L: Look): Part[] {
  return [
    sym(0.094, -0.3, 0.0, -0.098, 0.098, L.pants),
    sym(0.104, -0.46, -0.27, -0.16, 0.11, L.boots),
    sym(0.108, -0.48, -0.44, -0.17, 0.12, 0x151515),
    sym(0.098, -0.31, -0.26, -0.105, 0.105, dark(L.pants, 0.75)),
  ];
}

// ------------------------------------------------------------------ modelo

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const NEG_Z = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Modelo de personagem em 3ª pessoa (bots e jogadores remotos): mercenário blocky.
 * O root é posicionado/rotacionado pelo Game (pos nos pés, yaw); aqui só animamos os filhos.
 * 10 malhas, geometrias cacheadas por visual e material compartilhado entre todos.
 */
export class CharacterModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private spine = new THREE.Group();
  private aim = new THREE.Group();
  private thighL: THREE.Mesh;
  private thighR: THREE.Mesh;
  private shinL: THREE.Mesh;
  private shinR: THREE.Mesh;
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private weapon: THREE.Mesh;
  private shadow: THREE.Mesh;
  private meshes: THREE.Mesh[];
  private weaponId: WeaponId | null = null;
  private specialId: SpecialId | null = null;
  private specialObj: THREE.Object3D | null = null;
  private specialT = 0;

  private dead = false;
  private phase = 0;
  private crouch = 0;
  private air = 0;
  private amp = 0;
  private kick = 0;
  private swing = 0;
  private flinch = 0;
  private flashT = 0;
  private flashing = false;
  private flashMat: THREE.Material;
  private seed: number;

  // cara de papel (foto do jogador)
  private paper = new THREE.Group();
  private paperMesh: THREE.Mesh | null = null;
  private paperMat: THREE.MeshBasicMaterial | null = null;
  private paperTex: THREE.Texture | null = null;
  private paperTilt = 0;
  private paperVel = new THREE.Vector3();
  private paperT = 0;
  private paperFlying = false;

  // morte
  private dDir = new THREE.Vector3();
  private fallAxis = new THREE.Vector3();
  private theta = 0;
  private omega = 0;
  private hopY = 0;
  private hopV = 0;
  private slide = 0;
  private slideV = 0;
  private spin = 0;
  private spinV = 0;
  private headSpin = 0;
  private deadT = 0;
  private wVel = new THREE.Vector3();
  private wSpin = new THREE.Vector3();
  private wRest = false;

  constructor(color: number, seed = 0) {
    this.seed = seed;
    const { mat, white, shadowMat, shadowGeo } = mats();
    this.flashMat = white;
    const L = makeLook(seed);
    const lk = `${L.skin}|${L.pants}|${L.boots}|${L.hair}|${L.under}|${+L.vest}|${L.hairStyle}|${L.gear}|${L.gearColor}|${+L.shades}|${+L.beard}|${+L.gloves}|${+L.radio}|${+L.capBack}`;
    const mk = (g: THREE.BufferGeometry) => {
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      return m;
    };
    this.thighL = mk(partsGeo(`thL:${L.pants}`, () => thighParts(L, -1)));
    this.thighR = mk(partsGeo(`thR:${L.pants}`, () => thighParts(L, 1)));
    this.shinL = mk(partsGeo(`sh:${L.pants}:${L.boots}`, () => shinParts(L)));
    this.shinR = mk(this.shinL.geometry);
    this.torso = mk(partsGeo(`to:${color}:${lk}`, () => torsoParts(color, L)));
    this.head = mk(partsGeo(`he:${lk}`, () => headParts(L)));
    this.armL = mk(partsGeo(`ar:${color}:${lk}`, () => armParts(color, L)));
    this.armR = mk(this.armL.geometry);
    this.weapon = mk(weaponGeo('smg'));
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.scale.set(0.95, 1, 0.95);
    this.shadow.position.y = 0.02;
    this.shadow.renderOrder = 1;

    this.thighL.position.set(-0.12, 0, 0);
    this.thighR.position.set(0.12, 0, 0);
    this.shinL.position.y = -0.44;
    this.shinR.position.y = -0.44;
    this.thighL.add(this.shinL);
    this.thighR.add(this.shinR);
    this.head.position.y = TORSO_H;
    this.aim.position.y = SHOULDER_Y;
    this.armL.position.set(-0.31, 0, 0);
    this.armR.position.set(0.31, 0, 0);
    this.aim.add(this.armL, this.armR, this.weapon);
    this.spine.add(this.torso, this.head, this.aim);
    this.hips.position.y = HIP;
    this.hips.add(this.thighL, this.thighR, this.spine);
    this.body.add(this.hips);
    this.root.add(this.body, this.shadow);
    this.meshes = [this.thighL, this.thighR, this.shinL, this.shinR, this.torso, this.head, this.armL, this.armR, this.weapon];
    this.setWeapon('smg');
    this.poseArms(1);
    this.paperTilt = ((seed % 7) - 3) * 0.035;
  }

  /**
   * Foto do jogador como "cara": folha de papel colada na frente da cabeça com fita crepe.
   * null = cara padrão.
   */
  setFace(tex: THREE.Texture | null): void {
    if (this.paperTex && this.paperTex !== tex) this.paperTex.dispose();
    this.paperTex = null;
    if (!tex) {
      this.paper.visible = false;
      return;
    }
    const map = composePaper(tex);
    if (map !== tex) this.paperTex = map;
    // imagem ainda carregando: usa direto e recompõe quando chegar
    const img = tex.image as HTMLImageElement | undefined;
    if (map === tex && img && typeof img.addEventListener === 'function' && 'complete' in img && !img.complete) {
      img.addEventListener('load', () => { if (this.paperMat?.map === tex) this.setFace(tex); }, { once: true });
    }
    if (!this.paperMesh) {
      const r = paperRes();
      this.paperMat = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, color: 0xe8e6e0 });
      this.paperMesh = new THREE.Mesh(r.geo, this.paperMat);
      this.paperMesh.position.set(0, -PAPER_H / 2 + 0.02, 0);
      const tape = new THREE.Mesh(r.tapeGeo, r.tapeMat);
      tape.position.set(0.02, 0.0, -0.004);
      tape.rotation.z = -0.12;
      // fita dobrando por cima da testa
      const tape2 = new THREE.Mesh(r.tapeGeo, r.tapeMat);
      tape2.scale.set(1, 1.2, 1);
      tape2.rotation.set(Math.PI / 2, 0, -0.12);
      tape2.position.set(0.02, 0.003, 0.03);
      this.paper.add(this.paperMesh, tape, tape2);
    } else {
      this.paperMat!.map = map;
      this.paperMat!.needsUpdate = true;
    }
    this.paper.visible = true;
    if (!this.paper.parent) this.attachPaper();
  }

  private attachPaper(): void {
    this.head.add(this.paper);
    this.paper.position.set(0, 0.425, -0.215);
    this.paper.rotation.set(0, 0, this.paperTilt);
    this.paperFlying = false;
  }

  private setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.weapon.geometry = weaponGeo(id);
    this.weapon.rotation.set(0, 0, 0);
  }

  private setSpecial(id: SpecialId | null): void {
    if (id === this.specialId) return;
    this.specialId = id;
    this.specialObj?.removeFromParent();
    this.specialObj = null;
    this.weapon.visible = !id;
    if (!id) return;
    const o = buildHeldModel(id);
    o.scale.setScalar(HELD_TP[id].scale);
    o.traverse((c) => { (c as THREE.Mesh).castShadow = true; });
    this.aim.add(o);
    this.specialObj = o;
  }

  /** Aponta um braço (eixo -z) do ombro até o alvo, esticando um pouco se precisar. */
  private reach(arm: THREE.Mesh, target: THREE.Vector3, k: number): void {
    _v.subVectors(target, arm.position);
    const len = _v.length();
    _v.divideScalar(Math.max(len, 1e-4));
    _q.setFromUnitVectors(NEG_Z, _v);
    arm.quaternion.slerp(_q, k);
    arm.scale.z += (THREE.MathUtils.clamp(len / ARM_REACH, 0.75, 1.4) - arm.scale.z) * k;
  }

  private poseArms(k: number): void {
    if (this.specialObj && this.specialId) {
      // arma maluca: segura na frente do peito; "swing" = arremesso/golpe
      const o = this.specialObj;
      const s = Math.sin(Math.min(1, this.swing) * Math.PI);
      o.position.set(0.12 - s * 0.1, -0.12 + s * 0.2, -0.42 - s * 0.25 + this.kick * 0.06);
      o.rotation.set(s * -0.8 - this.kick * 0.2, 0, 0);
      this.reach(this.armR, _v2.copy(o.position).add(_tmpOff.set(0, 0, 0.04)), k);
      const L = HELD_TP[this.specialId].left;
      if (L) {
        const sc = o.scale.x;
        this.reach(this.armL, _v2.set(o.position.x + L[0] * sc, o.position.y + L[1] * sc, o.position.z + L[2] * sc), k);
      } else {
        const sw = Math.sin(this.phase) * 0.7 * this.amp;
        _v2.set(-0.36, -Math.cos(sw) * 0.47, -Math.sin(sw) * 0.47);
        _v2.applyAxisAngle(X_AXIS, -this.aim.rotation.x);
        this.reach(this.armL, _v2, k);
      }
      return;
    }
    const g = GRIPS[this.weaponId ?? 'smg'];
    const wp = this.weapon.position;
    wp.set(g.grip[0], g.grip[1], g.grip[2]);
    if (this.weaponId === 'knife') {
      // facada: a mão vai pra frente e pra cima
      const s = Math.sin(Math.min(1, this.swing) * Math.PI);
      wp.z -= s * 0.3;
      wp.y += s * 0.12;
      wp.x -= s * 0.12;
      this.weapon.rotation.set(-0.25 + s * 0.4, 0, 0);
      this.reach(this.armR, _v2.copy(wp).add(_tmpOff.set(0, 0, 0.05)), k);
      // braço esquerdo solto, balançando com o passo (independente do pitch)
      const sw = Math.sin(this.phase) * 0.7 * this.amp;
      _v2.set(-0.36, -Math.cos(sw) * 0.47, -Math.sin(sw) * 0.47);
      _v2.applyAxisAngle(X_AXIS, -this.aim.rotation.x);
      this.reach(this.armL, _v2, k);
    } else {
      this.reach(this.armR, _v2.copy(wp).add(_tmpOff.set(0, 0, 0.03)), k);
      if (g.left) this.reach(this.armL, _v2.set(g.left[0], g.left[1], g.left[2]), k);
    }
  }

  update(dt: number, pose: CharacterPose): void {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.setFlash(false);
    }
    if (this.dead) {
      this.updateDeath(dt);
      return;
    }
    this.setWeapon(pose.weapon);
    this.setSpecial(pose.special ?? null);
    if (this.specialObj) {
      this.specialT += dt;
      (this.specialObj.userData.tick as ((dt: number, t: number, a?: number) => void) | undefined)?.(dt, this.specialT, 0.4);
    }
    const k = Math.min(1, dt * 12);
    this.crouch += ((pose.crouched ? 1 : 0) - this.crouch) * k;
    this.air += ((pose.grounded ? 0 : 1) - this.air) * Math.min(1, dt * 8);
    const targetAmp = Math.min(1, pose.speed / 5.5) * (pose.grounded ? 1 : 0.2);
    this.amp += (targetAmp - this.amp) * Math.min(1, dt * 8);
    this.phase += dt * Math.max(pose.speed, 0.0) * 2.4;
    const c = this.crouch, a = this.air, amp = this.amp;

    const sw = Math.sin(this.phase) * 0.62 * amp;
    const kneeL = Math.max(0, Math.sin(this.phase - 1.2)) * 0.9 * amp;
    const kneeR = Math.max(0, Math.sin(this.phase + Math.PI - 1.2)) * 0.9 * amp;
    this.thighL.rotation.set(sw + c * 1.25 + a * 0.7, 0, -0.03);
    this.thighR.rotation.set(-sw + c * 1.25 + a * 0.25, 0, 0.03);
    this.shinL.rotation.x = -kneeL - c * 2.0 - a * 1.0;
    this.shinR.rotation.x = -kneeR - c * 2.0 - a * 0.5;

    const bob = Math.abs(Math.sin(this.phase)) * 0.035 * amp;
    this.hips.position.y = HIP - c * 0.5 + bob;

    this.flinch *= Math.exp(-dt * 10);
    this.spine.rotation.set(-c * 0.45 + pose.pitch * 0.2 - amp * 0.08, Math.sin(this.phase) * 0.1 * amp, this.flinch);

    this.kick *= Math.exp(-dt * 14);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 4);
    this.aim.rotation.set(pose.pitch - this.spine.rotation.x + this.kick * 0.18, Math.sin(this.phase) * 0.04 * amp - this.spine.rotation.y * 0.8, 0);
    this.aim.position.set(0, SHOULDER_Y + bob * 0.3, this.kick * 0.07);
    this.head.rotation.set(pose.pitch * 0.55 - this.spine.rotation.x * 0.6, -this.spine.rotation.y, -this.flinch * 0.5);

    this.poseArms(Math.min(1, dt * 18));
    if (this.paper.visible) {
      this.paperT += dt;
      this.paper.rotation.x = -0.04 - amp * 0.18 - a * 0.25 + Math.sin(this.paperT * 9 + this.phase) * (0.03 + amp * 0.06) - this.flinch * 0.6;
      this.paper.rotation.z = this.paperTilt + Math.sin(this.paperT * 5.3) * 0.02;
    }
    const sh = 0.95 - c * 0.0 - a * 0.25;
    this.shadow.scale.set(sh, 1, sh);
  }

  onFire(): void {
    if (this.dead) return;
    if (this.weaponId === 'knife' || (this.specialId && this.specialId !== 'coxinha')) this.swing = 1;
    else this.kick = 1;
  }

  onHurt(headshot: boolean): void {
    const m = mats();
    this.flashMat = headshot ? m.red : m.white;
    this.flashT = 0.09;
    this.setFlash(true);
    this.flinch = (this.seed & 1 ? 1 : -1) * (headshot ? 0.35 : 0.2) * (Math.random() < 0.5 ? -1 : 1);
  }

  private setFlash(on: boolean): void {
    if (on === this.flashing && !on) return;
    this.flashing = on;
    const m = on ? this.flashMat : mats().mat;
    for (const mesh of this.meshes) mesh.material = m;
  }

  /** dir = direção do tiro que matou (mundo). */
  die(dir: THREE.Vector3, headshot: boolean): void {
    if (this.dead) return;
    this.setSpecial(null);
    this.dead = true;
    this.deadT = 0;
    // direção em espaço local do root
    this.dDir.set(dir.x, 0, dir.z);
    if (this.dDir.lengthSq() < 1e-6) this.dDir.set(0, 0, 1);
    this.dDir.normalize().applyAxisAngle(UP, -this.root.rotation.y);
    this.fallAxis.crossVectors(UP, this.dDir).normalize();
    this.theta = 0;
    this.omega = 2.0 + Math.random() * 1.2 + (headshot ? 1.6 : 0);
    this.hopY = 0;
    this.hopV = 1.6 + Math.random() * 1.2 + (headshot ? 0.8 : 0);
    this.slide = 0;
    this.slideV = 1.6 + Math.random();
    this.spin = 0;
    this.spinV = (Math.random() - 0.5) * 4;
    this.headSpin = headshot ? 16 + Math.random() * 8 : 0;
    this.kick = 0;
    this.swing = 0;
    // a arma sai voando
    this.root.updateMatrixWorld(true);
    this.root.attach(this.weapon);
    this.wVel.copy(this.dDir).multiplyScalar(1.2 + Math.random()).add(_v.set((Math.random() - 0.5) * 1.5, 2.6 + Math.random(), 0));
    this.wSpin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    this.wRest = false;
    if (this.paper.visible && this.paper.parent) {
      this.root.attach(this.paper);
      this.paperVel.copy(this.dDir).multiplyScalar(-0.6).add(_v.set((Math.random() - 0.5) * 1.2, 3.2 + Math.random() * 1.5, 0));
      this.paperFlying = true;
      this.paperT = 0;
    }
  }

  private updateDeath(dt: number): void {
    this.deadT += dt;
    const t = this.deadT;
    // tombo com quique
    if (this.omega !== 0 || this.theta < Math.PI / 2) {
      this.omega += 7 * Math.sin(this.theta + 0.25) * dt;
      this.theta += this.omega * dt;
      if (this.theta >= Math.PI / 2) {
        this.theta = Math.PI / 2;
        if (Math.abs(this.omega) > 0.7) this.omega = -this.omega * 0.38;
        else this.omega = 0;
      }
      if (this.theta < 0) { this.theta = 0; this.omega = Math.abs(this.omega); }
    }
    // pulinho
    this.hopV -= 14 * dt;
    this.hopY += this.hopV * dt;
    if (this.hopY < 0) {
      this.hopY = 0;
      this.hopV = Math.abs(this.hopV) > 1 ? -this.hopV * 0.35 : 0;
    }
    this.slide += this.slideV * dt;
    this.slideV *= Math.exp(-dt * 3.5);
    this.spin += this.spinV * dt;
    this.spinV *= Math.exp(-dt * 2.5);

    _q.setFromAxisAngle(this.fallAxis, this.theta);
    _q2.setFromAxisAngle(UP, this.spin);
    this.body.quaternion.multiplyQuaternions(_q2, _q);
    const st = Math.sin(this.theta);
    this.body.position.set(this.dDir.x * this.slide, this.hopY + st * 0.15, this.dDir.z * this.slide);
    this.shadow.position.set(this.dDir.x * (this.slide + st * 0.8), 0.02, this.dDir.z * (this.slide + st * 0.8));
    this.shadow.scale.set(0.95 + st * 0.4, 1, 0.95 + st * 0.4);

    // membros abrem (estrela) com chacoalhada
    const k = Math.min(1, dt * 10);
    const flail = Math.sin(t * 22) * Math.exp(-t * 2.5) * 0.5;
    this.hips.position.y += (HIP - this.hips.position.y) * k;
    this.spine.rotation.x += (0.15 - this.spine.rotation.x) * k;
    this.spine.rotation.z += (flail * 0.3 - this.spine.rotation.z) * k;
    this.aim.rotation.x += (0 - this.aim.rotation.x) * k;
    this.aim.position.z += (0 - this.aim.position.z) * k;
    this.thighL.rotation.x += (0.2 + flail - this.thighL.rotation.x) * k;
    this.thighL.rotation.z += (-0.5 - this.thighL.rotation.z) * k;
    this.thighR.rotation.x += (-0.1 - flail - this.thighR.rotation.x) * k;
    this.thighR.rotation.z += (0.5 - this.thighR.rotation.z) * k;
    this.shinL.rotation.x += (-0.3 - this.shinL.rotation.x) * k;
    this.shinR.rotation.x += (-0.1 - this.shinR.rotation.x) * k;
    this.reach(this.armL, _v2.set(-0.85, 0.35 + flail, -0.25 + flail * 0.5), k);
    this.reach(this.armR, _v2.set(0.85, 0.35 - flail, -0.25 - flail * 0.5), k);
    if (this.headSpin > 0.1) {
      this.head.rotation.y += this.headSpin * dt;
      this.headSpin *= Math.exp(-dt * 2.2);
    }
    this.head.rotation.x += (0.3 - this.head.rotation.x) * k;

    // folha descolando e caindo planando
    if (this.paperFlying) {
      const p = this.paper;
      this.paperT += dt;
      this.paperVel.y -= 5 * dt;
      this.paperVel.multiplyScalar(Math.exp(-dt * 1.8));
      p.position.addScaledVector(this.paperVel, dt);
      p.position.x += Math.sin(this.paperT * 5) * dt * 0.8;
      p.rotation.x += (Math.sin(this.paperT * 4) * 2.2 - 0.6) * dt * 2;
      p.rotation.z += Math.cos(this.paperT * 3.3) * dt * 2;
      if (p.position.y < 0.03 && this.paperVel.y < 0) {
        p.position.y = 0.03;
        p.rotation.set(Math.PI / 2, 0, p.rotation.z);
        this.paperFlying = false;
      }
    }
    // arma caindo
    if (!this.wRest) {
      const w = this.weapon;
      this.wVel.y -= 14 * dt;
      w.position.addScaledVector(this.wVel, dt);
      w.rotation.x += this.wSpin.x * dt;
      w.rotation.y += this.wSpin.y * dt;
      w.rotation.z += this.wSpin.z * dt;
      if (w.position.y < 0.05) {
        w.position.y = 0.05;
        if (Math.abs(this.wVel.y) > 1.2) {
          this.wVel.y *= -0.3;
          this.wVel.x *= 0.5;
          this.wVel.z *= 0.5;
          this.wSpin.multiplyScalar(0.4);
        } else {
          this.wRest = true;
          w.rotation.set(0, w.rotation.y, Math.PI / 2 * Math.round(w.rotation.z / (Math.PI / 2)));
        }
      }
    }
  }

  respawn(): void {
    this.dead = false;
    this.setFlash(false);
    this.flashT = 0;
    this.root.scale.set(1, 1, 1);
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.body.position.set(0, 0, 0);
    this.body.quaternion.identity();
    this.shadow.position.set(0, 0.02, 0);
    this.hips.position.y = HIP;
    this.spine.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.thighL.rotation.set(0, 0, 0);
    this.thighR.rotation.set(0, 0, 0);
    this.shinL.rotation.set(0, 0, 0);
    this.shinR.rotation.set(0, 0, 0);
    this.aim.rotation.set(0, 0, 0);
    this.aim.add(this.weapon);
    this.weapon.rotation.set(0, 0, 0);
    if (this.paper.visible) this.attachPaper();
    this.crouch = 0;
    this.air = 0;
    this.kick = 0;
    this.swing = 0;
    this.headSpin = 0;
    this.poseArms(1);
  }

  dispose(): void {
    // Geometrias e materiais do corpo são compartilhados (cache). Só a folha da foto é por instância.
    this.paperTex?.dispose();
    this.paperMat?.dispose();
  }
}

const _tmpOff = new THREE.Vector3();
