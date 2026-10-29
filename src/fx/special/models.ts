import * as THREE from 'three';
import { SPECIALS, type ProjKind, type SpecialId } from '../../game/special/defs';
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
  coxinha: 0xe0a030,
  coxinhaDark: 0xb87818,
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
};

/** Peças animáveis do item na mão. */
export interface HeldParts {
  /** Ponto de saída (cano/boca), filho do item. */
  muzzle: THREE.Object3D;
  /** Hélice do ventilador / canos da metralhadora de coxinha (giram em z). */
  spinner?: THREE.Object3D;
  /** Disco de "borrão" da hélice (opacidade conforme a velocidade). */
  blur?: THREE.Mesh;
  /** Manivela (coxinha). */
  crank?: THREE.Object3D;
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
  /** Coxinhas na bacia (pulam quando atira). */
  bowl?: THREE.Object3D;
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

/** Coxinha (nariz em +Z). */
function coxinhaGeo(): THREE.BufferGeometry {
  return cached('cx', () => {
    const b = new Builder();
    b.cylZ(C.coxinha, 0.055, 0.12, 0, 0, 0.02, 7, 0.006);
    b.push(new THREE.IcosahedronGeometry(0.058, 0), C.coxinhaDark, 0, 0, -0.045);
    b.push(new THREE.IcosahedronGeometry(0.05, 0), C.coxinha, 0, 0.004, -0.05);
    return b.build();
  });
}

/** Metralhadora giratória de coxinha: canos de PVC, tambor de fritadeira, bacia de coxinhas e manivela. */
function coxinhaGun(): { g: THREE.Group; p: HeldParts } {
  const g = new THREE.Group();
  g.add(M(cached('cxg', () => {
    const b = new Builder();
    b.box(C.dark, 0.034, 0.1, 0.044, 0, -0.012, 0.012, -0.25); // cabo
    b.box(C.dark, 0.01, 0.008, 0.06, 0, 0.015, -0.035);
    b.cylZ(C.aluminium, 0.07, 0.17, 0, 0.08, -0.08, 10); // tambor
    b.cylZ(C.aluminiumDark, 0.073, 0.012, 0, 0.08, -0.03, 10);
    b.cylZ(C.aluminiumDark, 0.073, 0.012, 0, 0.08, -0.15, 10);
    b.cylZ(C.dark, 0.03, 0.05, 0, 0.08, 0.02, 8);
    b.box(C.dark, 0.032, 0.08, 0.036, 0, 0.0, -0.2, 0.1); // empunhadura da frente
    // bacia de alumínio em cima
    b.push(new THREE.CylinderGeometry(0.085, 0.05, 0.05, 10), C.aluminium, 0, 0.175, -0.07);
    b.box(C.aluminiumDark, 0.03, 0.04, 0.03, 0, 0.14, -0.07);
    // funil laranja ligando bacia e tambor
    b.push(new THREE.CylinderGeometry(0.03, 0.012, 0.04, 8), C.orange, 0.0, 0.14, -0.12);
    return b.build();
  })));
  const bowl = new THREE.Group();
  const cx = coxinhaGeo();
  const spots: [number, number, number, number][] = [[0, 0.21, -0.07, 0.3], [0.04, 0.205, -0.05, 1.2], [-0.04, 0.205, -0.09, 2.2], [0.02, 0.215, -0.11, 4], [-0.03, 0.21, -0.03, 5.1]];
  for (const [x, y, z, r] of spots) {
    const m = M(cx, x, y, z);
    m.rotation.set(-1.1, r, 0);
    m.scale.setScalar(0.7);
    bowl.add(m);
  }
  g.add(bowl);
  const spinner = new THREE.Group();
  spinner.add(M(cached('cxg-bar', () => {
    const b = new Builder();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.cylZ(C.pvc, 0.015, 0.26, Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.13, 7);
      b.cylZ(C.coxinha, 0.012, 0.012, Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.262, 6); // coxinha na boca
    }
    b.cylZ(C.aluminiumDark, 0.062, 0.012, 0, 0, -0.2, 10);
    b.cylZ(C.aluminiumDark, 0.062, 0.012, 0, 0, -0.04, 10);
    return b.build();
  })));
  spinner.position.set(0, 0.08, -0.16);
  g.add(spinner);
  const crank = new THREE.Group();
  crank.add(M(cached('cxg-crank', () => new Builder().box(C.steel, 0.008, 0.07, 0.01, 0, 0.035, 0).box(C.red, 0.03, 0.014, 0.014, -0.015, 0.07, 0).build())));
  crank.position.set(-0.075, 0.08, -0.06);
  g.add(crank);
  return { g, p: { muzzle: anchor(g, 0, 0.08, -0.44), spinner, crank, bowl } };
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

const BUILDERS: Record<SpecialId, () => { g: THREE.Group; p: HeldParts }> = {
  lorenzetti, estilingue, dolly, rexona, pombo: pigeonParts, chinelo, panela, coxinha: coxinhaGun, ventilador, tijolo,
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
  coxinha: { left: [0, 0.0, -0.2], scale: 1.2 },
  ventilador: { left: [-0.04, 0.12, -0.02], scale: 1.1 },
  tijolo: { left: null, scale: 1.3 },
};

// ------------------------------------------------------------------ pickup

const labels = new Map<string, THREE.CanvasTexture>();
const PICK_SCALE: Record<SpecialId, number> = {
  lorenzetti: 3.7, estilingue: 4.2, dolly: 2.7, rexona: 4.2, pombo: 3.2, chinelo: 3.7, panela: 2.7, coxinha: 2.4, ventilador: 2.7, tijolo: 3.5,
};

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

  // coluna de luz (dá pra ver de longe)
  const col = new THREE.Mesh(
    cached('pk-col', () => new THREE.CylinderGeometry(0.2, 0.32, 7, 10, 1, true)),
    new THREE.MeshBasicMaterial({
      color: d.color, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }),
  );
  col.position.y = 3.2;
  g.add(col);
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
    glow.scale.setScalar(1.2 + Math.sin(t * 4) * 0.2);
    spin.rotation.x = Math.sin(t * 1.3) * 0.15;
    spin.position.y = Math.sin(t * 2.2) * 0.06;
    ring.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    tick?.(dt, t, id === 'ventilador' ? 0.3 : 0);
    if (id === 'lorenzetti' && parts.glow) (parts.glow.material as THREE.SpriteMaterial).opacity = 0.4 + Math.sin(t * 9) * 0.3;
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

    case 'coxinha': {
      const m = M(coxinhaGeo());
      m.scale.setScalar(1.4);
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
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}
