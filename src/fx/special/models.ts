import * as THREE from 'three';
import { SPECIALS, type ProjKind, type SpecialId } from '../../game/special/defs';
import { POWERS, type PowerId } from '../../game/special/Powerups';
import { Builder, vmMaterial } from '../vm/build';
import { labelTexture, softTexture } from './pools';

/**
 * Modelos das armas malucas, low-poly em blocos (cor por vértice, 1 draw call por peça):
 *
 *  - buildPickupModel(id): o item flutuando no mapa (~0.6 m), com brilho, coluna de luz e nome.
 *    `userData.spin` = filho que gira; `userData.update(t, dt)` = animação extra.
 *  - buildProjectileModel(kind): o que voa. Nariz em +Z. `userData.anim(t)` = batida de asa etc.
 *  - buildHeldModel(id): o item na mão (sem braços). Origem = palma da mão direita; boca/cano para -Z.
 *    `userData.parts` = peças animáveis (HeldParts); `userData.tick(dt, t, active)` = animação passiva.
 *
 * Cores e escalas em metros "reais" (o chuveiro tem ~17 cm de diâmetro, a garrafa ~32 cm etc.).
 */

const C = {
  white: 0xf2f2ee,
  offWhite: 0xd8dcdf,
  chrome: 0xb8c0c8,
  steel: 0x7a828c,
  dark: 0x26282c,
  black: 0x17181a,
  wood: 0xa8743c,
  woodDark: 0x7a4e24,
  rubber: 0xd8452e,
  leather: 0x6a3f22,
  stone: 0x8d8981,
  bottle: 0x2f8f3f,
  bottleDark: 0x1f6a2c,
  guarana: 0x6a3a14,
  red: 0xd8342c,
  yellow: 0xffd200,
  blue: 0x2a4fa8,
  blueDark: 0x1a3474,
  orange: 0xf08a24,
  aluminium: 0xc9ccd4,
  aluminiumDark: 0x9a9ea8,
  pvc: 0xe8e8e0,
  fanBlue: 0x7cc4ea,
  brick: 0xb8552e,
  brickIn: 0x8e3a1a,
  pigeon: 0x9aa4b4,
  pigeonDark: 0x5c6474,
  pigeonWing: 0xb4bcc8,
  neckGreen: 0x3f9a7a,
  neckPurple: 0x8a5aa8,
  beak: 0x3a3436,
  eye: 0xff7a1a,
  foot: 0xd86a6a,
  green: 0x2fb35a,
  havaYellow: 0xffd200,
  hen: 0xc58a4a,
  henLight: 0xe0b070,
  henDark: 0x8c5a2a,
  henTail: 0x3a2a1a,
  comb: 0xe02a2a,
  henBeak: 0xf2a020,
  tape: 0xe8d8a8,
};

/** Peças animáveis do item na mão. */
export interface HeldParts {
  /** Ponto de saída (cano/boca), filho do item. */
  muzzle: THREE.Object3D;
  /** Hélice do ventilador (gira em z). */
  spinner?: THREE.Object3D;
  /** Disco de "borrão" da hélice (opacidade conforme a velocidade). */
  blur?: THREE.Mesh;
  /** Pino/válvula da panela. */
  valve?: THREE.Object3D;
  /** Botão do aerosol. */
  nozzle?: THREE.Object3D;
  /** Isqueiro (chama aditiva). */
  flame?: THREE.Sprite;
  /** Estilingue: bolsinha (com a pedra) e os dois elásticos. */
  pouch?: THREE.Object3D;
  stone?: THREE.Object3D;
  bands?: [THREE.Object3D, THREE.Object3D];
  bandTips?: [THREE.Vector3, THREE.Vector3];
  /** Pombo: asas, cabeça e corpo. */
  wingL?: THREE.Object3D;
  wingR?: THREE.Object3D;
  head?: THREE.Object3D;
  /** Brilho da resistência (lorenzetti). */
  glow?: THREE.Sprite;
  /** Pipa: carretel com a linha enrolada (gira quando a pipa está no ar) e a ponta da linha. */
  reel?: THREE.Object3D;
  line?: THREE.Object3D;
}

// ------------------------------------------------------------------ helpers

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
const M = (g: THREE.BufferGeometry, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(g, vmMaterial);
  m.position.set(x, y, z);
  return m;
};
const anchor = (parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D => {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  parent.add(o);
  return o;
};

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.Texture {
  let t = texCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!, w, h);
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

function bigText(c: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, fill: string, stroke?: string): void {
  let s = size;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  do {
    c.font = `900 ${s}px Arial Black, Arial, sans-serif`;
    s -= 1;
  } while (c.measureText(text).width > maxW && s > 6);
  if (stroke) {
    c.lineWidth = Math.max(2, s * 0.18);
    c.lineJoin = 'round';
    c.strokeStyle = stroke;
    c.strokeText(text, x, y);
  }
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

const labelMats = new Map<string, THREE.Material>();
function labelMat(key: string, tex: () => THREE.Texture): THREE.Material {
  let m = labelMats.get(key);
  if (!m) labelMats.set(key, (m = new THREE.MeshLambertMaterial({ map: tex(), flatShading: true })));
  return m;
}

/** Rótulo cilíndrico (garrafa, lata). */
function wrapLabel(key: string, r: number, h: number, y: number, draw: (c: CanvasRenderingContext2D, w: number, hh: number) => void): THREE.Mesh {
  const g = cached(`lbl:${key}:${r}:${h}`, () => new THREE.CylinderGeometry(r, r, h, 10, 1, true));
  const m = new THREE.Mesh(g, labelMat(key, () => canvasTex(key, 256, 64, draw)));
  m.position.y = y;
  return m;
}

let _flameMat: THREE.SpriteMaterial | null = null;
function flameSprite(color = 0xffb040): THREE.Sprite {
  _flameMat ??= new THREE.SpriteMaterial({ map: softTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const s = new THREE.Sprite(_flameMat);
  return s;
}
function glowSprite(color: number): THREE.Sprite {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
}

// ------------------------------------------------------------------ itens

/** Chuveiro Lorenzetti: segura pelo cano (vertical), ducha virada pra frente. */
function lorenzetti(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('lz', () => {
    const b = new Builder();
    // cano (pega da mão) + cotovelo
    b.cyl(C.chrome, 0.013, 0.17, 0, 0.0, 0.0, 0, 0, 0, 7);
    b.box(C.chrome, 0.032, 0.032, 0.032, 0, 0.09, 0);
    b.cylZ(C.chrome, 0.013, 0.07, 0, 0.09, -0.04, 7);
    b.box(C.white, 0.03, 0.012, 0.03, 0, -0.06, 0); // rosca/vedação
    // corpo branco (cúpula) + espalhador
    b.cylZ(C.white, 0.06, 0.05, 0, 0.09, -0.09, 10, 0.075);
    b.cylZ(C.white, 0.088, 0.035, 0, 0.09, -0.13, 12);
    b.cylZ(C.offWhite, 0.084, 0.012, 0, 0.09, -0.152, 12);
    // furinhos
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      if (i * i + j * j > 6) continue;
      b.box(C.dark, 0.008, 0.008, 0.004, i * 0.024, 0.09 + j * 0.024, -0.159);
    }
    // seletor de temperatura (verão/inverno) e fios
    b.box(C.red, 0.026, 0.016, 0.026, 0.0, 0.14, -0.1);
    b.box(C.blue, 0.006, 0.018, 0.006, 0.0, 0.152, -0.1);
    // fios descascados saindo de trás (vermelho e preto) com pontas de cobre
    b.box(C.red, 0.008, 0.008, 0.07, -0.012, 0.12, -0.035, 0.9);
    b.box(C.black, 0.008, 0.008, 0.07, 0.012, 0.12, -0.035, 1.0);
    b.box(0xd88a3a, 0.01, 0.01, 0.012, -0.012, 0.146, -0.006);
    b.box(0xd88a3a, 0.01, 0.01, 0.012, 0.012, 0.149, -0.01);
    return b.build();
  })));
  const glow = glowSprite(0x7cd0ff);
  glow.position.set(0, 0.09, -0.17);
  glow.scale.setScalar(0.25);
  g.add(glow);
  return { g, p: { muzzle: anchor(g, 0, 0.09, -0.17), glow } };
}

/** Estilingue: forquilha de madeira, elástico de borracha e bolsinha de couro com pedra. */
function estilingue(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('es', () => {
    const b = new Builder();
    b.box(C.wood, 0.026, 0.12, 0.03, 0, -0.02, 0);
    b.box(C.woodDark, 0.028, 0.03, 0.032, 0, -0.065, 0); // fita no cabo
    b.box(C.wood, 0.024, 0.1, 0.026, -0.03, 0.08, 0, 0, 0, 0.55);
    b.box(C.wood, 0.024, 0.1, 0.026, 0.03, 0.08, 0, 0, 0, -0.55);
    b.box(C.woodDark, 0.026, 0.02, 0.028, -0.058, 0.122, 0);
    b.box(C.woodDark, 0.026, 0.02, 0.028, 0.058, 0.122, 0);
    return b.build();
  })));
  const tips: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-0.058, 0.125, 0), new THREE.Vector3(0.058, 0.125, 0)];
  const bandG = cached('es-band', () => new Builder().box(C.rubber, 0.01, 0.01, 1, 0, 0, 0.5).build());
  const bl = M(bandG), br = M(bandG);
  g.add(bl, br);
  const pouch = new THREE.Group();
  pouch.add(M(cached('es-pouch', () => new Builder().box(C.leather, 0.05, 0.03, 0.02, 0, 0, 0).build())));
  const stone = M(cached('es-stone', () => new Builder().push(new THREE.IcosahedronGeometry(0.02, 0), C.stone).build()), 0, 0.004, -0.006);
  pouch.add(stone);
  pouch.position.set(0, 0.045, 0.06);
  g.add(pouch);
  return { g, p: { muzzle: anchor(g, 0, 0.125, -0.02), pouch, stone, bands: [bl, br], bandTips: tips } };
}

/** Rótulo da Dolly. */
const dollyLabel = (c: CanvasRenderingContext2D, w: number, h: number) => {
  c.fillStyle = '#ffd21e';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#d8241c';
  c.fillRect(0, 0, w, h * 0.18);
  c.fillRect(0, h * 0.82, w, h * 0.18);
  for (let k = 0; k < 2; k++) {
    const x = w * (0.25 + k * 0.5);
    bigText(c, 'Dolly', x, h * 0.48, w * 0.4, 34, '#d8241c', '#fff');
  }
  c.fillStyle = '#2f8f3f';
  c.fillRect(w * 0.48, h * 0.25, w * 0.04, h * 0.5);
};

function bottleGeo(): THREE.BufferGeometry {
  return cached('dolly', () => {
    const b = new Builder();
    // pé petaloide
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.box(C.bottleDark, 0.035, 0.03, 0.035, Math.cos(a) * 0.028, -0.135, Math.sin(a) * 0.028, 0, -a, 0);
    }
    b.cyl(C.bottle, 0.052, 0.24, 0, -0.01, 0, 0, 0, 0, 10);
    b.cyl(C.guarana, 0.047, 0.2, 0, -0.02, 0, 0, 0, 0, 8); // líquido (aparece pelos frisos)
    b.cyl(C.bottleDark, 0.054, 0.008, 0, 0.09, 0, 0, 0, 0, 10); // friso
    b.push(new THREE.CylinderGeometry(0.018, 0.052, 0.06, 10), C.bottle, 0, 0.14, 0);
    b.cyl(C.bottle, 0.017, 0.025, 0, 0.18, 0, 0, 0, 0, 8);
    b.cyl(C.red, 0.02, 0.022, 0, 0.202, 0, 0, 0, 0, 8); // tampa
    b.box(0xffffff, 0.044, 0.006, 0.044, 0, 0.189, 0, 0, 0.4, 0);
    return b.build();
  });
}

/** Garrafa PET 2 L de guaraná Dolly. Origem = centro do corpo. */
function dolly(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(bottleGeo()));
  g.add(wrapLabel('dolly', 0.0535, 0.09, 0.02, dollyLabel));
  return { g, p: { muzzle: anchor(g, 0, 0.21, 0) } };
}

/** Desodorante aerosol + isqueiro preso na frente do bico. */
function rexona(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('rx', () => {
    const b = new Builder();
    b.cyl(C.blueDark, 0.03, 0.17, 0, 0.01, 0, 0, 0, 0, 10);
    b.push(new THREE.CylinderGeometry(0.018, 0.03, 0.022, 10), C.chrome, 0, 0.106, 0);
    b.cyl(C.chrome, 0.031, 0.008, 0, -0.072, 0, 0, 0, 0, 10);
    // isqueiro "Bic" amarrado com fita crepe
    b.box(C.red, 0.022, 0.07, 0.014, -0.022, 0.07, -0.045, 0, 0.5, 0);
    b.box(C.chrome, 0.022, 0.014, 0.016, -0.022, 0.112, -0.045, 0, 0.5, 0);
    b.cyl(C.steel, 0.006, 0.012, -0.022, 0.121, -0.04, 0, 0.5, Math.PI / 2, 6);
    b.box(0xe8d8a8, 0.075, 0.016, 0.03, -0.01, 0.065, -0.03, 0, 0.5, 0); // fita crepe
    return b.build();
  })));
  g.add(wrapLabel('rexona', 0.0305, 0.09, 0.0, (c, w, h) => {
    c.fillStyle = '#1a3474';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#ff7a1a';
    c.beginPath();
    c.moveTo(0, h * 0.85);
    c.quadraticCurveTo(w * 0.5, h * 0.2, w, h * 0.7);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.fill();
    bigText(c, 'REXONA', w * 0.3, h * 0.42, w * 0.42, 30, '#ffffff');
    bigText(c, 'REXONA', w * 0.8, h * 0.42, w * 0.42, 30, '#ffffff');
  }));
  const nozzle = new THREE.Group();
  nozzle.add(M(cached('rx-noz', () => new Builder().box(C.white, 0.024, 0.016, 0.026, 0, 0, 0).box(C.dark, 0.006, 0.006, 0.004, 0, 0, -0.014).build())));
  nozzle.position.set(0, 0.124, -0.002);
  g.add(nozzle);
  const flame = flameSprite();
  flame.position.set(-0.018, 0.142, -0.05);
  flame.scale.set(0.03, 0.05, 1);
  g.add(flame);
  return { g, p: { muzzle: anchor(g, 0, 0.13, -0.06), nozzle, flame } };
}

/** Pombo cinza "quadradão". Olha para -Z. */
function pigeonParts(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('pb-body', () => {
    const b = new Builder();
    b.box(C.pigeon, 0.12, 0.11, 0.19, 0, 0, 0);
    b.box(C.pigeon, 0.1, 0.08, 0.08, 0, -0.01, -0.09); // peito
    b.box(C.pigeonDark, 0.1, 0.035, 0.12, 0, 0.0, 0.15, -0.12); // cauda
    b.box(C.black, 0.102, 0.012, 0.03, 0, -0.003, 0.2, -0.12);
    b.box(C.foot, 0.014, 0.04, 0.014, 0.03, -0.07, -0.01);
    b.box(C.foot, 0.014, 0.04, 0.014, -0.03, -0.07, -0.01);
    b.box(C.foot, 0.03, 0.008, 0.04, 0.03, -0.09, -0.02);
    b.box(C.foot, 0.03, 0.008, 0.04, -0.03, -0.09, -0.02);
    return b.build();
  })));
  const head = new THREE.Group();
  head.add(M(cached('pb-head', () => {
    const b = new Builder();
    b.box(C.neckGreen, 0.075, 0.07, 0.07, 0, -0.03, 0.02);
    b.box(C.neckPurple, 0.077, 0.03, 0.05, 0, -0.05, 0.03);
    b.box(C.pigeonDark, 0.065, 0.065, 0.07, 0, 0.02, -0.005);
    b.box(C.beak, 0.016, 0.014, 0.035, 0, 0.015, -0.055);
    b.box(0xf2f0ea, 0.018, 0.01, 0.012, 0, 0.026, -0.04); // cera branca
    b.box(C.eye, 0.068, 0.014, 0.014, 0, 0.032, -0.02);
    b.box(C.black, 0.07, 0.007, 0.007, 0, 0.032, -0.022);
    return b.build();
  })));
  head.position.set(0, 0.09, -0.1);
  g.add(head);
  const wingG = cached('pb-wing', () => {
    const b = new Builder();
    b.box(C.pigeonWing, 0.02, 0.08, 0.17, 0.01, 0, 0.02);
    b.box(C.black, 0.022, 0.014, 0.05, 0.01, -0.012, 0.03);
    b.box(C.black, 0.022, 0.014, 0.05, 0.01, -0.03, 0.04);
    b.box(C.pigeonDark, 0.02, 0.07, 0.06, 0.01, 0, 0.12);
    return b.build();
  });
  const wingR = new THREE.Group(), wingL = new THREE.Group();
  wingR.add(M(wingG));
  const ml = M(wingG);
  ml.scale.x = -1;
  wingL.add(ml);
  wingR.position.set(0.06, 0.03, 0);
  wingL.position.set(-0.06, 0.03, 0);
  g.add(wingR, wingL);
  return { g, p: { muzzle: anchor(g, 0, 0.05, -0.15), wingL, wingR, head } };
}

/** Chinelo de dedo (sola deitada no plano XZ, bico em -Z). */
function chineloGeo(): THREE.BufferGeometry {
  return cached('ch', () => {
    const b = new Builder();
    // solado em 3 blocos (calcanhar estreito, frente larga)
    b.box(0xf4f4ef, 0.075, 0.012, 0.1, 0, -0.012, 0.075);
    b.box(0xf4f4ef, 0.072, 0.012, 0.1, 0.003, -0.012, -0.02);
    b.box(0xf4f4ef, 0.088, 0.012, 0.09, 0.004, -0.012, -0.11);
    b.box(C.green, 0.077, 0.012, 0.1, 0, 0.0, 0.075);
    b.box(C.green, 0.074, 0.012, 0.1, 0.003, 0.0, -0.02);
    b.box(C.green, 0.09, 0.012, 0.09, 0.004, 0.0, -0.11);
    b.box(C.green, 0.07, 0.012, 0.03, 0.004, 0.0, -0.16);
    // tiras em V + pino do dedão
    b.box(C.havaYellow, 0.009, 0.018, 0.11, 0.03, 0.014, -0.03, 0, -0.45, 0);
    b.box(C.havaYellow, 0.009, 0.018, 0.11, -0.025, 0.014, -0.03, 0, 0.45, 0);
    b.box(C.havaYellow, 0.012, 0.022, 0.012, 0.006, 0.016, -0.085);
    // bandeirinha do Brasil na tira
    b.box(0x2fb35a, 0.011, 0.01, 0.016, 0.037, 0.024, -0.01, 0, -0.45, 0);
    return b.build();
  });
}
function chinelo(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(chineloGeo(), 0, 0, -0.07));
  return { g, p: { muzzle: anchor(g, 0, 0, -0.2) } };
}

function panelaGeo(): THREE.BufferGeometry {
  return cached('pn', () => {
    const b = new Builder();
    b.cyl(C.aluminium, 0.1, 0.12, 0, -0.04, 0, 0, 0, 0, 12);
    b.cyl(C.aluminiumDark, 0.102, 0.012, 0, -0.1, 0, 0, 0, 0, 12);
    b.cyl(C.aluminiumDark, 0.106, 0.02, 0, 0.025, 0, 0, 0, 0, 12); // tampa
    b.push(new THREE.CylinderGeometry(0.03, 0.09, 0.02, 12), C.aluminium, 0, 0.044, 0);
    // cabos pretos compridos (o de cima travando no de baixo)
    b.box(C.black, 0.03, 0.022, 0.18, 0, -0.008, 0.16);
    b.box(C.black, 0.028, 0.018, 0.17, 0, 0.022, 0.16);
    b.box(C.black, 0.04, 0.03, 0.04, 0, 0.0, 0.09);
    b.box(C.black, 0.05, 0.02, 0.03, 0, -0.05, -0.115); // alça do outro lado
    b.box(C.red, 0.012, 0.012, 0.012, 0.03, 0.048, 0.02); // válvula de segurança vermelha
    return b.build();
  });
}
/** Panela de pressão. Origem = cabo (a panela fica em -Z). */
function panela(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(panelaGeo(), 0, 0, -0.2));
  const valve = new THREE.Group();
  valve.add(M(cached('pn-valve', () => new Builder().cyl(C.dark, 0.006, 0.03, 0, 0.015, 0, 0, 0, 0, 6).cyl(C.black, 0.016, 0.022, 0, 0.032, 0, 0, 0, 0, 8).build())));
  valve.position.set(0, 0.052, -0.2);
  g.add(valve);
  return { g, p: { muzzle: anchor(valve, 0, 0.05, 0), valve } };
}

/** Ventilador de mesa Arno: segurado pelo pescoço, base pendurada embaixo. */
function ventilador(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('vt', () => {
    const b = new Builder();
    b.cyl(C.offWhite, 0.016, 0.16, 0, 0.02, 0, 0, 0, 0, 7); // pescoço
    b.box(C.white, 0.13, 0.025, 0.11, 0, -0.07, 0.01); // base
    b.box(C.blue, 0.02, 0.008, 0.02, 0.04, -0.054, -0.03); // botões
    b.box(C.white, 0.02, 0.008, 0.02, 0.015, -0.054, -0.03);
    b.box(C.white, 0.02, 0.008, 0.02, -0.01, -0.054, -0.03);
    b.box(C.dark, 0.012, 0.012, 0.1, 0, -0.075, 0.1, 0.4); // fio
    b.cylZ(C.white, 0.05, 0.09, 0, 0.13, 0.02, 10, 0.04); // motor
    b.box(C.white, 0.03, 0.04, 0.03, 0, 0.1, 0.02);
    // grade: anéis + raios
    b.push(new THREE.TorusGeometry(0.13, 0.005, 4, 18), C.chrome, 0, 0.13, -0.09);
    b.push(new THREE.TorusGeometry(0.125, 0.005, 4, 18), C.chrome, 0, 0.13, -0.03);
    b.push(new THREE.TorusGeometry(0.07, 0.004, 4, 14), C.chrome, 0, 0.13, -0.1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      b.box(C.chrome, 0.005, 0.12, 0.004, Math.cos(a) * 0.07, 0.13 + Math.sin(a) * 0.07, -0.1, 0, 0, a + Math.PI / 2);
      b.box(C.chrome, 0.005, 0.005, 0.06, Math.cos(a) * 0.128, 0.13 + Math.sin(a) * 0.128, -0.06);
    }
    b.cylZ(C.blue, 0.026, 0.01, 0, 0.13, -0.105, 10); // emblema Arno
    return b.build();
  })));
  const spinner = new THREE.Group();
  spinner.add(M(cached('vt-blade', () => {
    const b = new Builder();
    b.cylZ(C.offWhite, 0.024, 0.03, 0, 0, 0, 8);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      b.box(C.fanBlue, 0.055, 0.1, 0.006, Math.cos(a) * 0.065, Math.sin(a) * 0.065, -0.004, 0.0, 0.35, a - Math.PI / 2);
    }
    return b.build();
  })));
  spinner.position.set(0, 0.13, -0.06);
  g.add(spinner);
  const blur = new THREE.Mesh(
    cached('vt-blur', () => new THREE.CircleGeometry(0.115, 18)),
    new THREE.MeshBasicMaterial({ color: 0xb8e2f8, transparent: true, opacity: 0, depthWrite: false }),
  );
  blur.position.set(0, 0.13, -0.064);
  blur.rotation.y = Math.PI;
  g.add(blur);
  return { g, p: { muzzle: anchor(g, 0, 0.13, -0.12), spinner, blur } };
}

/** Tijolo baiano de 8 furos (furos atravessando em Z). */
function brickGeo(): THREE.BufferGeometry {
  return cached('tj', () => {
    const b = new Builder();
    const W = 0.19, H = 0.09, D = 0.19, t = 0.011;
    b.box(C.brick, W, t, D, 0, H / 2 - t / 2, 0);
    b.box(C.brick, W, t, D, 0, -H / 2 + t / 2, 0);
    b.box(C.brick, t, H, D, W / 2 - t / 2, 0, 0);
    b.box(C.brick, t, H, D, -W / 2 + t / 2, 0, 0);
    for (const x of [-W / 4, 0, W / 4]) b.box(C.brickIn, 0.008, H - 2 * t, D, x, 0, 0);
    b.box(C.brickIn, W - 2 * t, 0.008, D, 0, 0, 0);
    // ranhuras nas faces
    for (const y of [-0.02, 0.02]) b.box(0xa94a24, W + 0.002, 0.004, D * 0.96, 0, y, 0);
    return b.build();
  });
}
function tijolo(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(brickGeo(), -0.095, 0, -0.04));
  return { g, p: { muzzle: anchor(g, -0.095, 0, -0.14) } };
}

// ------------------------------------------------------------------ armas novas (placeholders: o artista refina)

/** Bola de futebol: icosfera branca com remendos pretos nos 12 vértices (raio 0.11 m). */
function ballGeo(): THREE.BufferGeometry {
  return cached('bola', () => {
    const R = 0.11;
    const b = new Builder();
    b.push(new THREE.IcosahedronGeometry(R, 1), C.white);
    const t = (1 + Math.sqrt(5)) / 2;
    const vs: [number, number, number][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    const z = new THREE.Vector3(0, 0, 1);
    for (const [x, y, w] of vs) {
      const n = new THREE.Vector3(x, y, w).normalize();
      const g = new THREE.CircleGeometry(0.045, 5);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(z, n));
      g.translate(n.x * R * 1.01, n.y * R * 1.01, n.z * R * 1.01);
      b.push(g, C.black);
    }
    return b.build();
  });
}
/** Bola na mão (apoiada na palma, um palmo à frente). */
function bola(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(ballGeo(), 0, 0.03, -0.12));
  return { g, p: { muzzle: anchor(g, 0, 0.03, -0.24) } };
}

/** Rótulo da lata de linha (lata de achocolatado reaproveitada, clássico). */
const canLabel = (c: CanvasRenderingContext2D, w: number, h: number) => {
  c.fillStyle = '#e8c21a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#b8241c';
  c.fillRect(0, h * 0.72, w, h * 0.28);
  for (let k = 0; k < 2; k++) bigText(c, 'NESCAU', w * (0.25 + k * 0.5), h * 0.4, w * 0.4, 30, '#7a3a14', '#fff6d0');
};

/** Lata de linha: a linha (com cerol) enrolada na lata, que gira em Z. Segura pela lata, boca pra frente. */
function pipa(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  const can = new THREE.Group();
  can.add(M(cached('pp-can', () => {
    const b = new Builder();
    b.cylZ(C.chrome, 0.052, 0.012, 0, 0, 0.065, 12);
    b.cylZ(C.chrome, 0.052, 0.012, 0, 0, -0.065, 12);
    return b.build();
  })));
  const lbl = wrapLabel('nescau', 0.05, 0.12, 0, canLabel);
  lbl.rotation.x = Math.PI / 2;
  can.add(lbl);
  can.position.set(0, 0.05, -0.04);
  g.add(can);
  // linha enrolada por cima do rótulo (é o que gira)
  const reel = new THREE.Group();
  reel.add(M(cached('pp-reel', () => {
    const b = new Builder();
    b.cylZ(0xf4ecd8, 0.058, 0.07, 0, 0, 0.0, 12);
    b.cylZ(0xe040f0, 0.0585, 0.008, 0, 0, 0.02, 12);
    b.cylZ(0x2a9bff, 0.0585, 0.008, 0, 0, -0.012, 12);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box(0xfffbe8, 0.006, 0.006, 0.06, Math.cos(a) * 0.058, Math.sin(a) * 0.058, 0, 0, 0, a);
    }
    return b.build();
  })));
  reel.position.set(0, 0.05, -0.04);
  g.add(reel);
  // ponta da linha saindo da lata (escala z = comprimento, apontada pela animação)
  const line = M(cached('pp-line', () => new Builder().box(0xfff4d0, 0.004, 0.004, 1, 0, 0, -0.5).build()), 0, 0.105, -0.06);
  line.scale.z = 0.08;
  g.add(line);
  return { g, p: { muzzle: anchor(g, 0, 0.11, -0.1), reel, line } };
}

/** Estampa florida clássica de garrafa térmica (fundo vermelho, flores brancas e amarelas). */
const floral = (c: CanvasRenderingContext2D, w: number, h: number) => {
  c.fillStyle = '#c8281e';
  c.fillRect(0, 0, w, h);
  const flower = (x: number, y: number, r: number, petal: string, core: string) => {
    c.fillStyle = petal;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      c.beginPath();
      c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = core;
    c.beginPath();
    c.arc(x, y, r * 0.6, 0, Math.PI * 2);
    c.fill();
  };
  let seed = 7;
  const R = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 16; i++) {
    const x = R() * w, y = R() * h, r = 5 + R() * 6;
    c.fillStyle = '#2f8f3f';
    c.fillRect(x + r * 0.4, y + r * 0.6, r * 1.4, r * 0.5);
    flower(x, y, r, i % 3 === 0 ? '#ffd23a' : '#fff6ee', i % 3 === 0 ? '#c8281e' : '#ffb000');
  }
};

/** Garrafa térmica de bico, florida. Segura pela alça (à direita); bico pra frente; botão de pressão em cima. */
function cafe(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(M(cached('cf', () => {
    const b = new Builder();
    b.cyl(0xf2ece0, 0.052, 0.025, 0, -0.105, 0, 0, 0, 0, 12); // base creme
    b.cyl(0xf2ece0, 0.054, 0.02, 0, 0.1, 0, 0, 0, 0, 12); // anel
    b.push(new THREE.CylinderGeometry(0.035, 0.052, 0.05, 12), 0xf2ece0, 0, 0.135, 0); // ombro
    b.cyl(0xf2ece0, 0.036, 0.02, 0, 0.17, 0, 0, 0, 0, 12);
    // bico comprido
    b.push(new THREE.CylinderGeometry(0.012, 0.022, 0.08, 8), 0xf2ece0, 0, 0.165, -0.055, -1.1, 0, 0);
    // alça
    b.box(0xf2ece0, 0.016, 0.15, 0.03, 0.078, 0.03, 0.0);
    b.box(0xf2ece0, 0.04, 0.02, 0.026, 0.06, 0.1, 0.0);
    b.box(0xf2ece0, 0.04, 0.02, 0.026, 0.06, -0.04, 0.0);
    return b.build();
  })));
  body.add(wrapLabel('floral', 0.0525, 0.18, 0.0, floral));
  body.position.set(-0.075, 0, 0);
  g.add(body);
  // botão de pressão (a mão esquerda aperta)
  const nozzle = new THREE.Group();
  nozzle.add(M(cached('cf-btn', () => new Builder().cyl(0xc8281e, 0.026, 0.02, 0, 0, 0, 0, 0, 0, 10).cyl(0xf2ece0, 0.012, 0.012, 0, 0.014, 0, 0, 0, 0, 8).build())));
  nozzle.position.set(-0.075, 0.188, 0);
  g.add(nozzle);
  return { g, p: { muzzle: anchor(g, -0.075, 0.19, -0.1), nozzle } };
}

/**
 * Rojão de vara (festa junina), apontando para -Z: tubo de papelão vermelho com cinta verde e amarela, cabeça azul
 * pontuda e vara de bambu presa com fita. Origem = palma da mão direita, que segura a vara.
 */
function rojaoGeo(): THREE.BufferGeometry {
  return cached('rj', () => {
    const b = new Builder();
    b.cylZ(C.wood, 0.006, 0.44, 0, 0, 0.02, 5); // vara de bambu
    b.cylZ(C.woodDark, 0.0075, 0.015, 0, 0, 0.245, 5); // nó
    b.cylZ(C.red, 0.032, 0.22, 0, 0.04, -0.25, 8); // tubo
    b.cylZ(C.green, 0.0335, 0.05, 0, 0.04, -0.2, 8); // cinta verde
    b.cylZ(C.yellow, 0.0335, 0.02, 0, 0.04, -0.29, 8); // cinta amarela
    b.cylZ(C.blue, 0.004, 0.09, 0, 0.04, -0.405, 8, 0.032); // cabeça pontuda (afina para -Z)
    b.box(C.tape, 0.036, 0.075, 0.022, 0, 0.02, -0.165); // fita prendendo a vara
    b.cylZ(0xf2f2ee, 0.003, 0.05, 0, 0.04, -0.115, 4); // pavio (sai pela traseira)
    return b.build();
  });
}
function rojao(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(rojaoGeo()));
  const flame = flameSprite(0xffc060);
  flame.position.set(0, 0.04, -0.085);
  flame.scale.set(0.05, 0.05, 1);
  g.add(flame);
  return { g, p: { muzzle: anchor(g, 0, 0.04, -0.46), flame } };
}

/** Galinha da vovó (sem pernas), olhando para -Z. Origem = centro do corpo. Cabeça e asas são peças animáveis. */
function henParts(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('hn-body', () => {
    const b = new Builder();
    b.box(C.hen, 0.13, 0.12, 0.19, 0, 0, 0.01);
    b.box(C.henLight, 0.11, 0.1, 0.07, 0, -0.01, -0.09); // peito
    b.box(C.henDark, 0.12, 0.02, 0.15, 0, 0.065, 0.02); // dorso
    // rabo de galo: três penas escuras abertas em leque
    b.box(C.henTail, 0.02, 0.11, 0.05, 0, 0.1, 0.12, -0.35);
    b.box(C.henTail, 0.02, 0.1, 0.05, -0.035, 0.09, 0.115, -0.3, 0, 0.35);
    b.box(C.henTail, 0.02, 0.1, 0.05, 0.035, 0.09, 0.115, -0.3, 0, -0.35);
    return b.build();
  })));
  const head = new THREE.Group();
  head.add(M(cached('hn-head', () => {
    const b = new Builder();
    b.box(C.hen, 0.06, 0.07, 0.06, 0, 0.02, 0); // pescoço
    b.box(C.henLight, 0.062, 0.062, 0.07, 0, 0.07, -0.015); // cabeça
    b.box(C.henBeak, 0.022, 0.014, 0.035, 0, 0.066, -0.066); // bico de cima
    b.box(C.henBeak, 0.016, 0.008, 0.025, 0, 0.052, -0.06); // bico de baixo
    b.box(C.comb, 0.014, 0.03, 0.05, 0, 0.11, -0.015); // crista
    b.box(C.comb, 0.014, 0.02, 0.014, 0, 0.123, -0.03);
    b.box(C.comb, 0.014, 0.02, 0.014, 0, 0.123, 0.0);
    b.box(C.comb, 0.012, 0.026, 0.012, 0, 0.034, -0.062); // barbela
    // olhos arregalados (e um pouco vesgos)
    for (const sx of [-1, 1]) {
      b.box(0xffffff, 0.014, 0.024, 0.024, sx * 0.032, 0.078, -0.03);
      b.box(C.black, 0.006, 0.011, 0.011, sx * 0.039, 0.078, -0.038);
    }
    return b.build();
  })));
  head.position.set(0, 0.08, -0.1);
  g.add(head);
  const wingG = cached('hn-wing', () => {
    const b = new Builder();
    b.box(0xa86e34, 0.02, 0.075, 0.14, 0.01, 0, 0.01);
    b.box(C.henDark, 0.022, 0.03, 0.06, 0.012, -0.045, 0.045);
    return b.build();
  });
  const wingR = new THREE.Group(), wingL = new THREE.Group();
  wingR.add(M(wingG));
  const ml = M(wingG);
  ml.scale.x = -1;
  wingL.add(ml);
  wingR.position.set(0.065, 0.01, 0.01);
  wingL.position.set(-0.065, 0.01, 0.01);
  g.add(wingR, wingL);
  return { g, p: { muzzle: anchor(g, 0, 0.05, -0.2), wingL, wingR, head } };
}

/** Perna de galinha pendurada em y=0 (descendo até o pé, dedos para -Z). */
function henLegGeo(): THREE.BufferGeometry {
  return cached('hn-leg', () => {
    const b = new Builder();
    b.box(C.henBeak, 0.012, 0.06, 0.012, 0, -0.03, 0);
    b.box(C.henBeak, 0.03, 0.008, 0.042, 0, -0.064, -0.014);
    return b.build();
  });
}
/** Galinha na mão: pernas penduradas. */
function galinha(): { g: THREE.Group; p: HeldParts } {
  const { g, p } = henParts();
  for (const sx of [-1, 1]) g.add(M(henLegGeo(), sx * 0.03, -0.06, 0.0));
  return { g, p };
}

const BUILDERS: Record<SpecialId, () => { g: THREE.Group; p: HeldParts }> = {
  lorenzetti, estilingue, dolly, rexona, pombo: pigeonParts, chinelo, panela, ventilador, tijolo, bola, pipa, cafe, rojao, galinha,
};

// ------------------------------------------------------------------ animação passiva

const _v = new THREE.Vector3();

/** Estica os elásticos do estilingue até a bolsinha. */
export function updateBands(p: HeldParts): void {
  if (!p.bands || !p.bandTips || !p.pouch) return;
  for (let i = 0; i < 2; i++) {
    const band = p.bands[i], tip = p.bandTips[i];
    band.position.copy(tip);
    _v.copy(p.pouch.position);
    _v.x += i === 0 ? -0.02 : 0.02;
    const d = _v.distanceTo(tip);
    band.lookAt(_v.applyMatrix4(band.parent!.matrixWorld));
    band.scale.set(1, 1, Math.max(0.01, d));
  }
}

/** Animação "sempre ligada" do item (hélice girando devagar, pombo inquieto, chama do isqueiro). */
function passiveTick(id: SpecialId, p: HeldParts, t: number, dt: number, active: number): void {
  switch (id) {
    case 'ventilador':
      p.spinner!.rotation.z -= dt * (5 + active * 55);
      (p.blur!.material as THREE.MeshBasicMaterial).opacity = active * 0.45;
      break;
    case 'pombo': {
      const fl = Math.max(0, Math.sin(t * 2.3) * Math.sin(t * 7.1));
      const a = fl * Math.sin(t * 38) * 0.6 + active * Math.sin(t * 34) * 0.9;
      p.wingR!.rotation.z = -Math.abs(a);
      p.wingL!.rotation.z = Math.abs(a);
      p.head!.rotation.set(Math.sin(t * 5.3) * 0.2, Math.sin(t * 3.1) * 0.5, 0);
      p.head!.position.z = -0.1 + Math.sin(t * 9) * 0.008;
      break;
    }
    case 'rexona': {
      const f = 0.85 + Math.random() * 0.3;
      p.flame!.scale.set(0.028 * f, 0.05 * f, 1);
      break;
    }
    case 'rojao': {
      // pavio aceso chiando: a faísca pisca e muda de tamanho
      const f = 0.7 + Math.random() * 0.6;
      p.flame!.scale.set(0.05 * f, 0.05 * f, 1);
      break;
    }
    case 'galinha': {
      // bica o ar, olha pros lados e de vez em quando bate as asas (muito mais, quando "ativa")
      const peck = Math.pow(Math.max(0, Math.sin(t * 3.1)), 6);
      const fl = Math.max(0, Math.sin(t * 1.9) * Math.sin(t * 6.7));
      const a = fl * Math.sin(t * 34) * 0.7 + active * Math.sin(t * 32) * 0.9;
      p.wingR!.rotation.z = -Math.abs(a);
      p.wingL!.rotation.z = Math.abs(a);
      p.head!.rotation.set(peck * 0.55 + Math.sin(t * 5) * 0.12, Math.sin(t * 2.3) * 0.5, 0);
      p.head!.position.z = -0.1 - peck * 0.02 + Math.sin(t * 9) * 0.006;
      break;
    }
    case 'estilingue':
      updateBands(p);
      break;
    case 'lorenzetti':
      (p.glow!.material as THREE.SpriteMaterial).opacity = active * (0.6 + Math.random() * 0.4);
      break;
  }
}

/** Item na mão. Origem = palma direita, boca em -Z. */
export function buildHeldModel(id: SpecialId): THREE.Object3D {
  const { g, p } = BUILDERS[id]();
  g.userData.parts = p;
  g.userData.kind = id;
  g.userData.tick = (dt: number, t: number, active = 0) => passiveTick(id, p, t, dt, active);
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

/**
 * 3ª pessoa: onde a mão esquerda vai (espaço do item, em metros) e a escala do item na mão do boneco.
 * null = só a mão direita.
 */
export const HELD_TP: Record<SpecialId, { left: [number, number, number] | null; scale: number }> = {
  lorenzetti: { left: [-0.03, -0.02, 0.0], scale: 1.3 },
  estilingue: { left: [0, 0.12, 0.12], scale: 1.4 },
  dolly: { left: null, scale: 1.2 },
  rexona: { left: [-0.03, 0.07, -0.05], scale: 1.4 },
  pombo: { left: [-0.14, 0, 0], scale: 1.3 },
  chinelo: { left: null, scale: 1.3 },
  panela: { left: [-0.05, -0.04, -0.2], scale: 1.2 },
  ventilador: { left: [-0.04, 0.12, -0.02], scale: 1.1 },
  tijolo: { left: null, scale: 1.3 },
  bola: { left: [0, 0.02, -0.2], scale: 1.4 },
  pipa: { left: [-0.02, 0.1, -0.2], scale: 1.3 },
  cafe: { left: [-0.075, 0.2, 0.0], scale: 1.3 },
  rojao: { left: [0, 0.04, -0.24], scale: 1.3 },
  galinha: { left: [-0.1, -0.02, -0.02], scale: 1.5 },
};

// ------------------------------------------------------------------ pickup

const labels = new Map<string, THREE.CanvasTexture>();
const PICK_SCALE: Record<SpecialId, number> = {
  lorenzetti: 3.7, estilingue: 4.2, dolly: 2.7, rexona: 4.2, pombo: 3.2, chinelo: 3.7, panela: 2.7, ventilador: 2.7, tijolo: 3.5, bola: 3.0, pipa: 3.8, cafe: 3.4, rojao: 3.4, galinha: 3.0,
};

const BEAM_H = 160;

/** Cilindro aberto do chão até BEAM_H, com a base no y=0. */
function beamGeometry(rBottom: number, rTop: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, BEAM_H, 10, 1, true).translate(0, BEAM_H / 2, 0);
}

const beamMats = new Map<number, { core: THREE.ShaderMaterial; halo: THREE.ShaderMaterial }>();

/** Material do feixe: aditivo, sem neblina, some suave lá em cima e pulsa subindo. Um par por cor. */
function beamMaterial(color: number): { core: THREE.ShaderMaterial; halo: THREE.ShaderMaterial } {
  let m = beamMats.get(color);
  if (m) return m;
  const make = (strength: number, edge: number) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vH = position.y / ${BEAM_H.toFixed(1)};
        // engrossa com a distância: de longe continua com alguns pixels de largura
        vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float grow = max(1.0, distance(cameraPosition, base) * 0.045);
        vec3 p = vec3(position.x * grow, position.y, position.z * grow);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uStrength;
      varying float vH;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        // mais forte no meio do cilindro visto de frente (parece um feixe "cheio")
        float facing = pow(abs(dot(normalize(vN), normalize(vView))), ${edge.toFixed(1)});
        float fade = (1.0 - smoothstep(0.35, 1.0, vH)) * smoothstep(0.0, 0.01, vH);
        float pulse = 0.75 + 0.25 * sin(vH * 60.0 - uTime * 6.0);
        float a = facing * fade * pulse * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  m = { core: make(1.8, 1.0), halo: make(0.6, 2.0) };
  beamMats.set(color, m);
  return m;
}

export function buildPickupModel(id: SpecialId): THREE.Object3D {
  const d = SPECIALS[id];
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const item = buildHeldModel(id);
  // centraliza pelo bounding box
  const box = new THREE.Box3().setFromObject(item);
  const c = box.getCenter(new THREE.Vector3());
  item.position.copy(c).multiplyScalar(-1);
  const holder = new THREE.Group();
  holder.add(item);
  holder.scale.setScalar(PICK_SCALE[id]);
  holder.rotation.set(0.25, 0, 0.15);
  spin.add(holder);
  g.add(spin);
  const parts = item.userData.parts as HeldParts;
  const tick = item.userData.tick as (dt: number, t: number, a?: number) => void;

  // brilho
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softTexture(), color: d.color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.scale.setScalar(1.3);
  g.add(glow);

  // Feixe de luz até o céu, na cor da arma: dá pra ver de qualquer canto do mapa por cima dos telhados
  const beamMat = beamMaterial(d.color);
  const core = new THREE.Mesh(cached('pk-beam-core', () => beamGeometry(0.22, 0.3)), beamMat.core);
  const halo = new THREE.Mesh(cached('pk-beam-halo', () => beamGeometry(0.8, 1.1)), beamMat.halo);
  for (const m of [core, halo]) {
    m.position.y = -0.8;
    m.frustumCulled = false;
    m.renderOrder = 5;
    g.add(m);
  }
  // anel no chão
  const ring = new THREE.Mesh(
    cached('pk-ring', () => new THREE.RingGeometry(0.42, 0.55, 20).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  ring.position.y = -0.82;
  g.add(ring);

  // nome
  let tex = labels.get(id);
  if (!tex) labels.set(id, (tex = labelTexture(d.short, '#' + d.color.toString(16).padStart(6, '0'))));
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  label.scale.set(1.6, 0.4, 1);
  label.position.y = 0.72;
  g.add(label);

  g.userData.spin = spin;
  g.userData.update = (t: number, dt = 1 / 60) => {
    beamMat.core.uniforms.uTime.value = t;
    beamMat.halo.uniforms.uTime.value = t;
    glow.scale.setScalar(1.2 + Math.sin(t * 4) * 0.2);
    spin.rotation.x = Math.sin(t * 1.3) * 0.15;
    spin.position.y = Math.sin(t * 2.2) * 0.06;
    ring.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    tick?.(dt, t, id === 'ventilador' ? 0.3 : 0);
    if (id === 'lorenzetti' && parts.glow) (parts.glow.material as THREE.SpriteMaterial).opacity = 0.4 + Math.sin(t * 9) * 0.3;
  };
  return g;
}

// ------------------------------------------------------------------ powerups do mapa

/** Geometria de cada powerup (~0.4 m), centrada na origem. */
function powerGeo(id: PowerId): THREE.BufferGeometry {
  return cached('pw-' + id, () => {
    const b = new Builder();
    switch (id) {
      case 'marmita': // marmitex de alumínio com tampa e alça
        b.box(C.aluminium, 0.38, 0.2, 0.27).box(C.aluminiumDark, 0.4, 0.04, 0.29, 0, 0.09, 0).box(C.red, 0.1, 0.03, 0.3, 0, 0.115, 0)
          .box(C.steel, 0.22, 0.03, 0.03, 0, 0.17, 0).box(C.steel, 0.03, 0.08, 0.03, -0.1, 0.13, 0).box(C.steel, 0.03, 0.08, 0.03, 0.1, 0.13, 0);
        break;
      case 'capacete': // capacete amarelo de obra
        b.push(new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), C.yellow, 0, 0, 0)
          .cyl(C.yellow, 0.25, 0.03, 0, -0.01, 0, 0, 0, 0, 10).box(C.orange, 0.06, 0.05, 0.4, 0, 0.19, 0).box(C.black, 0.1, 0.04, 0.03, 0, 0.06, 0.2);
        break;
      case 'energetico': // latinha com raio
        b.cyl(C.yellow, 0.09, 0.3, 0, 0, 0, 0, 0, 0, 10).cyl(C.aluminium, 0.092, 0.03, 0, 0.165, 0, 0, 0, 0, 10).cyl(C.aluminium, 0.092, 0.03, 0, -0.165, 0, 0, 0, 0, 10)
          .box(C.black, 0.05, 0.14, 0.01, 0.01, 0.03, 0.09, 0, 0, -0.35).box(C.black, 0.05, 0.1, 0.01, -0.02, -0.06, 0.09, 0, 0, -0.35);
        break;
      case 'pilha': // pilha grande
        b.cyl(C.green, 0.09, 0.3, 0, 0, 0, 0, 0, 0, 10).cyl(C.black, 0.092, 0.1, 0, -0.1, 0, 0, 0, 0, 10).cyl(C.havaYellow, 0.04, 0.05, 0, 0.175, 0, 0, 0, 0, 8)
          .box(C.white, 0.06, 0.14, 0.01, 0, 0.03, 0.092);
        break;
      case 'pix': // bolo de notas
        for (let i = 0; i < 3; i++) {
          b.box(C.green, 0.36, 0.035, 0.18, 0, -0.05 + i * 0.045, 0, 0, i * 0.2 - 0.2, 0);
        }
        b.box(0x28ffa8, 0.08, 0.15, 0.2, 0, 0, 0, 0, 0, 0);
        break;
      case 'cachaca': // garrafa de cachaça com rótulo
        b.cyl(C.woodDark, 0.09, 0.28, 0, -0.02, 0, 0, 0, 0, 10).cyl(C.woodDark, 0.035, 0.14, 0, 0.19, 0, 0, 0, 0, 8)
          .box(C.black, 0.08, 0.03, 0.08, 0, 0.27, 0).box(C.tape, 0.1, 0.12, 0.012, 0, -0.03, 0.093);
        break;
    }
    return b.build();
  });
}

export function buildPowerModel(id: PowerId): THREE.Object3D {
  const d = POWERS[id];
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const item = M(powerGeo(id));
  item.scale.setScalar(1.5);
  item.rotation.set(0.2, 0, 0.1);
  spin.add(item);
  g.add(spin);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softTexture(), color: d.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  glow.scale.setScalar(1.2);
  g.add(glow);

  // feixe de luz mais fino que o das armas: dá pra diferenciar de longe
  const beamMat = beamMaterial(d.color);
  const halo = new THREE.Mesh(cached('pw-beam', () => beamGeometry(0.4, 0.5)), beamMat.halo);
  halo.position.y = -0.8;
  halo.frustumCulled = false;
  halo.renderOrder = 5;
  g.add(halo);

  const ring = new THREE.Mesh(
    cached('pk-ring', () => new THREE.RingGeometry(0.42, 0.55, 20).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  ring.position.y = -0.82;
  g.add(ring);

  const key = 'pw:' + id;
  let tex = labels.get(key);
  if (!tex) labels.set(key, (tex = labelTexture(d.name.toUpperCase(), '#' + d.color.toString(16).padStart(6, '0'))));
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  label.scale.set(1.6, 0.4, 1);
  label.position.y = 0.6;
  g.add(label);

  g.userData.spin = spin;
  g.userData.update = (t: number) => {
    beamMat.halo.uniforms.uTime.value = t;
    glow.scale.setScalar(1.1 + Math.sin(t * 4) * 0.15);
    ring.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
  };
  return g;
}

// ------------------------------------------------------------------ projéteis

export function buildProjectileModel(kind: ProjKind): THREE.Object3D {
  const g = new THREE.Group();
  switch (kind) {
    case 'stone':
      g.add(M(cached('pj-stone', () => new Builder().push(new THREE.IcosahedronGeometry(0.06, 0), C.stone).push(new THREE.IcosahedronGeometry(0.035, 0), 0x6f6b64, 0.03, 0.02, 0).build())));
      break;

    case 'bottle': {
      g.add(M(bottleGeo()));
      g.add(wrapLabel('dolly', 0.0535, 0.09, 0.02, dollyLabel));
      g.scale.setScalar(1.3);
      break;
    }

    case 'brick':
      g.add(M(brickGeo()));
      break;

    case 'panela': {
      g.add(M(panelaGeo(), 0, 0, -0.05));
      const valve = M(cached('pn-valve', () => new Builder().cyl(C.dark, 0.006, 0.03, 0, 0.015, 0, 0, 0, 0, 6).cyl(C.black, 0.016, 0.022, 0, 0.032, 0, 0, 0, 0, 8).build()), 0, 0.052, -0.05);
      g.add(valve);
      g.scale.setScalar(1.3);
      g.userData.anim = (t: number) => {
        valve.rotation.set(Math.sin(t * 40) * 0.3, t * 12, Math.cos(t * 37) * 0.3);
      };
      break;
    }

    case 'bola': {
      const m = M(ballGeo());
      m.scale.setScalar(2); // modelo tem raio 0.11; a bola de jogo tem 0.22
      g.add(m);
      break;
    }

    case 'pombo': {
      const { g: bird, p } = pigeonParts();
      bird.rotation.y = Math.PI; // olha para +Z
      bird.scale.setScalar(1.6);
      g.add(bird);
      g.userData.anim = (t: number) => {
        const a = Math.sin(t * 30);
        p.wingR!.rotation.z = -0.2 - a * 1.1;
        p.wingL!.rotation.z = 0.2 + a * 1.1;
        p.wingR!.rotation.x = p.wingL!.rotation.x = -0.4;
        p.head!.position.z = -0.1 + Math.sin(t * 12) * 0.012;
        bird.position.y = Math.sin(t * 30 + 1) * 0.02;
      };
      break;
    }

    case 'chinelo': {
      const m = M(chineloGeo(), 0, 0, 0.0);
      m.scale.setScalar(1.6);
      g.add(m);
      break;
    }

    case 'rojao': {
      // foguete com o nariz em +Z (o modelo da mão aponta para -Z: gira 180°) e rastro de faíscas colorido de festa
      const rocket = M(rojaoGeo());
      rocket.rotation.y = Math.PI;
      rocket.scale.setScalar(1.5);
      g.add(rocket);
      const COLS = [0xffe080, 0x28ffa8, 0xff4a3a, 0xffd200, 0x2a9bff, 0xff5ad0, 0xffa030];
      const sparks: THREE.Sprite[] = [];
      for (let i = 0; i < 9; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: softTexture(), color: COLS[i % COLS.length], transparent: true, opacity: 0.9 - i * 0.08, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }));
        sp.position.z = 0.1 - i * 0.17;
        sp.scale.setScalar(0.42 - i * 0.03);
        g.add(sp);
        sparks.push(sp);
      }
      g.userData.anim = (t: number) => {
        sparks.forEach((sp, i) => {
          const f = 0.8 + 0.4 * Math.sin(t * 50 + i * 2.1);
          sp.scale.setScalar((0.42 - i * 0.03) * f);
          sp.position.x = Math.sin(t * 31 + i * 1.7) * 0.025 * i;
          sp.position.y = Math.cos(t * 27 + i * 1.3) * 0.025 * i;
        });
      };
      break;
    }

    case 'galinha': {
      // galinha correndo (nariz em +Z): pernas alternando, cabeça balançando e asinhas abertas de pânico.
      // Origem = centro do corpo; os pés ficam ~0.21 m abaixo.
      const { g: hen, p } = henParts();
      hen.rotation.y = Math.PI;
      hen.scale.setScalar(1.7);
      g.add(hen);
      const legs: THREE.Group[] = [];
      for (const sx of [-1, 1]) {
        const leg = new THREE.Group();
        leg.add(M(henLegGeo()));
        leg.position.set(sx * 0.03, -0.06, 0);
        hen.add(leg);
        legs.push(leg);
      }
      g.userData.anim = (t: number) => {
        const ph = t * 22;
        legs[0].rotation.x = Math.sin(ph) * 0.9;
        legs[1].rotation.x = -Math.sin(ph) * 0.9;
        hen.position.y = Math.abs(Math.sin(ph)) * 0.025;
        p.head!.position.z = -0.1 + Math.sin(ph * 2) * 0.02;
        p.head!.rotation.x = Math.sin(ph * 2 + 1) * 0.15;
        p.wingR!.rotation.z = -0.5 - Math.sin(ph * 1.5) * 0.5;
        p.wingL!.rotation.z = 0.5 + Math.sin(ph * 1.5) * 0.5;
      };
      break;
    }
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}


/**
 * Pipa com cerol: losango de papel de seda em 4 cores (plano XY, frente em +Z, vale dos dois lados), varetas e
 * rabiola de plástico colorido. Origem = centro. `userData.tail` = grupo da rabiola (balança em x).
 */
export function buildKiteModel(): THREE.Object3D {
  const g = new THREE.Group();
  const tri = (a: [number, number], b: [number, number], z: number): THREE.BufferGeometry => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.06, z, a[0], a[1], z, b[0], b[1], z], 3));
    geo.computeVertexNormals();
    return geo;
  };
  const T = 0.5, Bt = -0.52, L = -0.36, Rr = 0.36;
  const quads: [[number, number], [number, number], number][] = [
    [[0, T], [L, 0.06], 0xe040f0], [[Rr, 0.06], [0, T], 0xffd200], [[L, 0.06], [0, Bt], 0x2a9bff], [[0, Bt], [Rr, 0.06], 0xff3a3a],
  ];
  g.add(M(cached('kite-paper', () => {
    const b = new Builder();
    for (const [p1, p2, c] of quads) {
      b.push(tri(p1, p2, 0.001), c);
      b.push(tri(p2, p1, -0.001), c);
    }
    // bordas de linha branca
    b.box(0xffffff, 0.01, 0.6, 0.006, -0.18, 0.28, 0, 0, 0, -0.62);
    b.box(0xffffff, 0.01, 0.6, 0.006, 0.18, 0.28, 0, 0, 0, 0.62);
    b.box(0xffffff, 0.01, 0.68, 0.006, -0.18, -0.23, 0, 0, 0, 0.6);
    b.box(0xffffff, 0.01, 0.68, 0.006, 0.18, -0.23, 0, 0, 0, -0.6);
    return b.build();
  })));
  g.add(M(cached('kite-sticks', () => new Builder().box(C.woodDark, 0.012, 1.02, 0.012, 0, -0.01, 0.012).box(C.woodDark, 0.74, 0.012, 0.012, 0, 0.06, 0.012).build())));
  const tail = new THREE.Group();
  tail.position.set(0, -0.52, 0);
  const COLS = [0x2fe05a, 0xffd200, 0xe040f0, 0x2a9bff, 0xff3a3a];
  for (let i = 0; i < 12; i++) {
    const c = COLS[i % COLS.length];
    const bit = cached('kite-bit' + c, () => new Builder().box(c, 0.11, 0.035, 0.008, 0, 0, 0).box(0xffffff, 0.006, 0.12, 0.004, 0, 0.04, 0).build());
    const m = M(bit, Math.sin(i * 0.9) * 0.06, -0.1 - i * 0.12, 0);
    m.rotation.z = Math.sin(i * 1.7) * 0.6;
    tail.add(m);
  }
  g.add(tail);
  g.userData.tail = tail;
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}
