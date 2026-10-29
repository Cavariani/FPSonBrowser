import type { Facing, MapAwning, MapBox, MapDef, MapPalm, MapSign, MaterialId, SpawnPoint, Vec3 } from './types';

/*
 * de_poeira — cidadezinha murada no deserto.
 *
 * Vista de cima (x: oeste → leste, z: norte(-) → sul(+)), área interna [-52, 52]²:
 *
 *   z=-52 ┌──────────── A (Pátio) ──────┬── CT (Casa Grande)┬── B (Mercado) ───┐
 *         │  palco      caixotes   arco│  casa grande │porta carroça  doca   │
 *   z=-22 │                    escada ↗ │  terraço     │                      │
 *         │                            │ (plataforma)│◄─ beco coberto        │
 *   z=-14 │ LONGO │   casas            │    MEIO     │   casas      │TÚNEL  │
 *         │       │                    │  portão     │              │(coberto)
 *   z= 24 │ portas│                    │    (z=10)   │              │ zig-zag
 *   z= 38 ├───────┴────────────────────┴─────────────┴──────────────┴───────┤
 *         │                 BASE SUL (fonte, banca, guarita)                   │
 *   z=52  └────────────────────────────────────────────────────────────────────┘
 */

const boxes: MapBox[] = [];
const signs: MapSign[] = [];
const awnings: MapAwning[] = [];
const palms: MapPalm[] = [];

// PRNG determinístico (o mapa é igual em todos os clientes)
let _s = 1337;
const rnd = () => {
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MaterialId, extra: Partial<MapBox> = {}): void {
  boxes.push({
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    mat,
    ...extra,
  });
}
/** Caixa só visual. */
const deco = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, mat: MaterialId, extra: Partial<MapBox> = {}) =>
  box(x0, y0, z0, x1, y1, z1, mat, { collide: false, ...extra });

const ROOF_TINTS = [0xffffff, 0xf2dccb, 0xffe9d6, 0xe3cbbb, 0xd9d2c4, 0xfff4e0];
const PLASTER_TINTS = [0xffffff, 0xfff1dc, 0xffe7cf, 0xf6efe4, 0xffe0c0, 0xfbf3e8, 0xf3e2c8];

interface CasaOpts {
  /** Faces com janelas, ex. 'nw'. */
  win?: string;
  /** Faces com porta. */
  door?: string;
  tint?: number;
  /** Telhado colide (dá pra subir). */
  walk?: boolean;
  /** Sem vigas aparentes. */
  noBeams?: boolean;
}

/** Casa de reboco com telhado plano de tábuas, cantos marcados, rodapé, cornija, janelas e vigas. */
function casa(x0: number, z0: number, x1: number, z1: number, h: number, o: CasaOpts = {}): void {
  const tint = o.tint ?? PLASTER_TINTS[Math.floor(rnd() * PLASTER_TINTS.length)];
  box(x0, 0, z0, x1, h, z1, 'plaster', { tint });
  box(x0 - 0.25, h, z0 - 0.25, x1 + 0.25, h + 0.22, z1 + 0.25, 'roof', { collide: !!o.walk, tint: ROOF_TINTS[Math.floor(rnd() * ROOF_TINTS.length)] });
  // coisas no telhado (só visual): chaminé, caixa d'água, caixotes
  if (!o.walk && (x1 - x0) * (z1 - z0) > 50) {
    const n = 1 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      const cx = x0 + 1.2 + rnd() * (x1 - x0 - 2.4), cz = z0 + 1.2 + rnd() * (z1 - z0 - 2.4);
      const kind = rnd();
      const y = h + 0.22;
      if (kind < 0.4) {
        deco(cx - 0.35, y, cz - 0.35, cx + 0.35, y + 1.1, cz + 0.35, 'plaster', { tint });
        deco(cx - 0.45, y + 1.1, cz - 0.45, cx + 0.45, y + 1.22, cz + 0.45, 'trim', { tint });
      } else if (kind < 0.7) {
        deco(cx - 0.6, y, cz - 0.6, cx + 0.6, y + 0.25, cz + 0.6, 'wood');
        deco(cx - 0.5, y + 0.25, cz - 0.5, cx + 0.5, y + 1.25, cz + 0.5, 'paint', { tint: rnd() < 0.5 ? 0x3d6fb5 : 0x8a8f96 });
      } else {
        deco(cx - 0.5, y, cz - 0.5, cx + 0.5, y + 0.9, cz + 0.5, 'crate');
        deco(cx + 0.55, y, cz - 0.3, cx + 1.15, y + 0.6, cz + 0.3, 'crate');
      }
    }
  }
  // parapeito baixo de tábuas na borda do telhado (dá o "contorno" da referência)
  deco(x0 - 0.08, h - 0.4, z0 - 0.08, x1 + 0.08, h, z1 + 0.08, 'trim', { tint });
  deco(x0 - 0.06, 0, z0 - 0.06, x1 + 0.06, 0.45, z1 + 0.06, 'trim', { tint: 0xd8c8b0 });
  const p = 0.42, q = 0.1;
  for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
    const sx = cx === x0 ? -1 : 1, sz = cz === z0 ? -1 : 1;
    deco(cx + sx * q, 0, cz + sz * q, cx - sx * p, h - 0.4, cz - sz * p, 'trim', { tint });
  }
  for (const f of o.win ?? '') {
    janelas(x0, z0, x1, z1, h, f as Facing, (o.door ?? '').includes(f));
    if (!o.noBeams) vigas(x0, z0, x1, z1, h, f as Facing);
  }
  for (const f of o.door ?? '') porta(x0, z0, x1, z1, f as Facing);
}

/** Faz uma caixa "na face" f da casa: u ao longo da parede, sai `out` metros para fora. */
function onFace(x0: number, z0: number, x1: number, z1: number, f: Facing, u0: number, u1: number, y0: number, y1: number, out: number, inset: number, mat: MaterialId, extra: Partial<MapBox> = {}) {
  switch (f) {
    case 'n': deco(u0, y0, z0 - out, u1, y1, z0 + inset, mat, extra); break;
    case 's': deco(u0, y0, z1 - inset, u1, y1, z1 + out, mat, extra); break;
    case 'w': deco(x0 - out, y0, u0, x0 + inset, y1, u1, mat, extra); break;
    case 'e': deco(x1 - inset, y0, u0, x1 + out, y1, u1, mat, extra); break;
  }
}

function faceSpan(x0: number, z0: number, x1: number, z1: number, f: Facing): [number, number] {
  return f === 'n' || f === 's' ? [x0, x1] : [z0, z1];
}

function janelas(x0: number, z0: number, x1: number, z1: number, h: number, f: Facing, hasDoor: boolean): void {
  const [a, b] = faceSpan(x0, z0, x1, z1, f);
  const L = b - a;
  let n = Math.floor((L - 1.6) / 3.4);
  if (n < 1 && L >= 2.4) n = 1;
  const rows: number[] = [1.35];
  if (h >= 5.4) rows.push(3.75);
  if (h >= 7.6) rows.push(6.0);
  const mid = (a + b) / 2;
  for (let i = 0; i < n; i++) {
    const c = a + (L * (i + 0.5)) / n;
    for (const y of rows) {
      if (hasDoor && y < 3 && Math.abs(c - mid) < 1.6) continue;
      if (y + 1.1 > h - 0.6) continue;
      const w = 0.45;
      onFace(x0, z0, x1, z1, f, c - w, c + w, y, y + 1.1, 0.05, 0.02, 'glass');
      onFace(x0, z0, x1, z1, f, c - w - 0.15, c + w + 0.15, y - 0.12, y, 0.16, 0.02, 'wood');
      onFace(x0, z0, x1, z1, f, c - w - 0.12, c + w + 0.12, y + 1.1, y + 1.22, 0.08, 0.02, 'wood');
    }
  }
}

function vigas(x0: number, z0: number, x1: number, z1: number, h: number, f: Facing): void {
  const [a, b] = faceSpan(x0, z0, x1, z1, f);
  const n = Math.max(1, Math.floor((b - a) / 1.8));
  for (let i = 0; i < n; i++) {
    const c = a + ((b - a) * (i + 0.5)) / n;
    onFace(x0, z0, x1, z1, f, c - 0.1, c + 0.1, h - 0.85, h - 0.62, 0.42, 0.02, 'wood');
  }
}

function porta(x0: number, z0: number, x1: number, z1: number, f: Facing): void {
  const [a, b] = faceSpan(x0, z0, x1, z1, f);
  const c = (a + b) / 2;
  onFace(x0, z0, x1, z1, f, c - 0.65, c + 0.65, 0, 2.3, 0.06, 0.02, 'door');
  onFace(x0, z0, x1, z1, f, c - 0.85, c + 0.85, 2.3, 2.5, 0.12, 0.02, 'wood');
}

/** Muro com ameias. Espessura vai de (x0,z0) a (x1,z1). */
function muro(x0: number, z0: number, x1: number, z1: number, h: number, mat: MaterialId = 'wall', ameias = true): void {
  box(x0, 0, z0, x1, h, z1, mat);
  deco(Math.min(x0, x1) - 0.05, 0, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, 0.5, Math.max(z0, z1) + 0.05, 'wallDark');
  if (!ameias) return;
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const a = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const b = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const n = Math.max(1, Math.round((b - a) / 1.5));
  const step = (b - a) / n;
  for (let i = 0; i < n; i++) {
    const c0 = a + i * step + step * 0.22, c1 = a + (i + 1) * step - step * 0.22;
    if (alongX) deco(c0, h, Math.min(z0, z1), c1, h + 0.6, Math.max(z0, z1), mat);
    else deco(Math.min(x0, x1), h, c0, Math.max(x0, x1), h + 0.6, c1, mat);
  }
}

/** Caixote de madeira (s = lado, h = altura). Use h 1.0 (pulável) e 2.0 (subindo de um 1.0). */
function caixote(cx: number, cz: number, s: number, h = s, y = 0): void {
  box(cx - s / 2, y, cz - s / 2, cx + s / 2, y + h, cz + s / 2, 'crate');
}

/** Barril (caixa com cintas). */
function barril(cx: number, cz: number, tint: number): void {
  box(cx - 0.32, 0, cz - 0.32, cx + 0.32, 0.95, cz + 0.32, 'paint', { tint });
  deco(cx - 0.35, 0.18, cz - 0.35, cx + 0.35, 0.26, cz + 0.35, 'metal');
  deco(cx - 0.35, 0.68, cz - 0.35, cx + 0.35, 0.76, cz + 0.35, 'metal');
}

/** Pilha de sacos (cobertura baixa). Ao longo de x se alongX. */
function sacos(cx: number, cz: number, len: number, alongX: boolean, h = 1.0): void {
  const hx = alongX ? len / 2 : 0.45, hz = alongX ? 0.45 : len / 2;
  box(cx - hx, 0, cz - hz, cx + hx, h, cz + hz, 'cloth', { hidden: true });
  const n = Math.max(1, Math.round(len / 0.85));
  const rows = Math.round(h / 0.34);
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 0.42 : 0;
    for (let i = 0; i < n - (r % 2); i++) {
      const c = -len / 2 + off + i * (len / n) + 0.04;
      const c1 = c + len / n - 0.08;
      const y0 = r * 0.34, y1 = y0 + 0.36;
      const t = 0xf4ead8 - Math.floor(rnd() * 3) * 0x0a0a08;
      if (alongX) deco(cx + c, y0, cz - hz + 0.03, cx + c1, y1, cz + hz - 0.03, 'cloth', { tint: t });
      else deco(cx - hx + 0.03, y0, cz + c, cx + hx - 0.03, y1, cz + c1, 'cloth', { tint: t });
    }
  }
}

/** Escada de blocos: sobe de y0 a y1 no sentido `dir` (n = para -z, s = +z, e = +x, w = -x). Degraus ≤ 0.4 m. */
function escada(x0: number, z0: number, x1: number, z1: number, dir: Exclude<Facing, 'u'>, y0: number, y1: number, mat: MaterialId = 'stone'): void {
  const n = Math.ceil((y1 - y0) / 0.4 - 1e-6);
  const rise = (y1 - y0) / n;
  for (let k = 1; k <= n; k++) {
    const t0 = (k - 1) / n, t1 = k / n;
    const top = y0 + k * rise;
    switch (dir) {
      case 'n': box(x0, 0, z1 - (z1 - z0) * t1, x1, top, z1 - (z1 - z0) * t0, mat); break;
      case 's': box(x0, 0, z0 + (z1 - z0) * t0, x1, top, z0 + (z1 - z0) * t1, mat); break;
      case 'e': box(x0 + (x1 - x0) * t0, 0, z0, x0 + (x1 - x0) * t1, top, z1, mat); break;
      case 'w': box(x1 - (x1 - x0) * t1, 0, z0, x1 - (x1 - x0) * t0, top, z1, mat); break;
    }
  }
}

function toldo(a: [number, number], b: [number, number], y: number, face: Exclude<Facing, 'u'>, color: MapAwning['color'], depth = 1.8, drop = 0.6): void {
  awnings.push({ a, b, y, face, depth, drop, color });
}

function palmeira(x: number, z: number, h = 6 + rnd() * 2.5, collide = true): void {
  palms.push({ pos: [x, 0, z], h, yaw: rnd() * Math.PI * 2 });
  if (collide) box(x - 0.22, 0, z - 0.22, x + 0.22, 3, z + 0.22, 'wood', { hidden: true });
}

function placa(x: number, y: number, z: number, face: Facing, w: number, h: number, lines: string[], o: Partial<MapSign> = {}): void {
  signs.push({ pos: [x, y, z], face, w, h, lines, ...o });
}

const CLOTH_TINTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xe67e22, 0x8e44ad, 0xf4ead8];

/** Tapete pendurado na parede (placa com padrão geométrico). */
function tapete(x: number, y: number, z: number, face: Facing, w: number, h: number): void {
  const pal = [['#8e2b1f', '#e7b85a', '#1f3b5c'], ['#1f4e5c', '#e8d5a8', '#a83a22'], ['#5c2a5c', '#f0c75e', '#2a6b4f']];
  const p = pal[Math.floor(rnd() * pal.length)];
  placa(x, y, z, face, w, h, [], { kind: 'rug', bg: p[0], fg: p[1], border: p[2] });
}

/** Jarro de barro (colide). */
function jarro(cx: number, cz: number, s = 1, y = 0): void {
  box(cx - 0.28 * s, y, cz - 0.28 * s, cx + 0.28 * s, y + 0.7 * s, cz + 0.28 * s, 'paint', { tint: 0xc4683a });
  deco(cx - 0.18 * s, y + 0.7 * s, cz - 0.18 * s, cx + 0.18 * s, y + 0.85 * s, cz + 0.18 * s, 'paint', { tint: 0xa85530 });
  deco(cx - 0.3 * s, y + 0.4 * s, cz - 0.3 * s, cx + 0.3 * s, y + 0.48 * s, cz + 0.3 * s, 'paint', { tint: 0xe8d5a8 });
}

/** Banca de feira encostada numa parede ao sul (balcão + toldo + frutas/panos). */
function banca(cx: number, zWall: number, color: MapAwning['color']): void {
  const z0 = zWall - 1.1;
  box(cx - 1.6, 0, z0, cx + 1.6, 1.0, zWall, 'wood');
  deco(cx - 1.7, 1.0, z0 - 0.08, cx + 1.7, 1.08, zWall, 'wood');
  for (let i = 0; i < 4; i++) {
    const t = CLOTH_TINTS[Math.floor(rnd() * 5)];
    deco(cx - 1.4 + i * 0.75, 1.08, z0 + 0.1, cx - 0.85 + i * 0.75, 1.3, z0 + 0.7, 'paint', { tint: t });
  }
  box(cx - 1.65, 0, z0 - 0.1, cx - 1.5, 2.6, z0 + 0.05, 'wood');
  box(cx + 1.5, 0, z0 - 0.1, cx + 1.65, 2.6, z0 + 0.05, 'wood');
  toldo([cx - 1.9, zWall], [cx + 1.9, zWall], 2.9, 'n', color, 1.5, 0.5);
}

/** Varal com panos coloridos (só visual), ao longo de x. */
function varal(x0: number, x1: number, z: number, h: number): void {
  box(x0 - 0.06, 0, z - 0.06, x0 + 0.06, h + 0.1, z + 0.06, 'wood');
  box(x1 - 0.06, 0, z - 0.06, x1 + 0.06, h + 0.1, z + 0.06, 'wood');
  deco(x0, h - 0.02, z - 0.015, x1, h + 0.01, z + 0.015, 'paint', { tint: 0x3a2a1a });
  let x = x0 + 0.3;
  while (x < x1 - 0.6) {
    const w = 0.5 + rnd() * 0.5, d = 0.6 + rnd() * 0.5;
    deco(x, h - d, z - 0.02, x + w, h, z + 0.02, 'paint', { tint: CLOTH_TINTS[Math.floor(rnd() * CLOTH_TINTS.length)] });
    x += w + 0.15 + rnd() * 0.3;
  }
}

/** Carroça de madeira com sacos e feno, ao longo de z. */
function carroca(cx: number, cz: number): void {
  box(cx - 1.0, 0, cz - 1.9, cx + 1.0, 1.3, cz + 1.9, 'wood', { hidden: true });
  deco(cx - 0.95, 0.6, cz - 1.8, cx + 0.95, 0.75, cz + 1.8, 'wood');
  deco(cx - 0.95, 0.75, cz - 1.8, cx - 0.85, 1.25, cz + 1.8, 'wood');
  deco(cx + 0.85, 0.75, cz - 1.8, cx + 0.95, 1.25, cz + 1.8, 'wood');
  deco(cx - 0.95, 0.75, cz + 1.7, cx + 0.95, 1.25, cz + 1.8, 'wood');
  deco(cx - 0.95, 0.75, cz - 1.8, cx + 0.95, 1.25, cz - 1.7, 'wood');
  for (const sx of [-1, 1]) {
    deco(cx + sx * 1.0, 0, cz - 0.55, cx + sx * 1.14, 1.1, cz + 0.55, 'wood', { tint: 0x8a6a50 });
    deco(cx + sx * 1.02, 0.45, cz - 0.08, cx + sx * 1.16, 0.65, cz + 0.08, 'metal');
  }
  deco(cx - 0.08, 0.55, cz - 3.4, cx + 0.08, 0.68, cz - 1.8, 'wood'); // varal de puxar
  deco(cx - 0.7, 0.75, cz - 1.5, cx + 0.1, 1.4, cz - 0.3, 'cloth', { tint: 0xf4ead8 });
  deco(cx - 0.2, 0.75, cz - 0.1, cx + 0.75, 1.5, cz + 1.4, 'paint', { tint: 0xe2c25a }); // feno
  deco(cx - 0.75, 0.75, cz + 0.4, cx - 0.1, 1.2, cz + 1.5, 'crate');
}

/** Piso de pedra (só visual, 6 cm). */
const piso = (x0: number, z0: number, x1: number, z1: number) => deco(x0, 0, z0, x1, 0.06, z1, 'stone');
/** Trilha de areia escura (só visual). */
const trilha = (x0: number, z0: number, x1: number, z1: number) => deco(x0, 0, z0, x1, 0.03, z1, 'sandDark');

// =====================================================================================
// CHÃO E MURALHA
// =====================================================================================
box(-54, -1, -54, 54, 0, 54, 'sand');

const WH = 8;
muro(-54, -54, 54, -52, WH);
muro(-54, 52, 54, 54, WH);
muro(-54, -52, -52, 52, WH);
muro(52, -52, 54, 52, WH);
// torres nos cantos e no meio dos muros norte/sul
for (const [cx, cz] of [[-52, -52], [52, -52], [-52, 52], [52, 52], [0, -53.5], [0, 53.5]]) {
  const s = cx === 0 ? 3 : 4;
  box(cx - s, 0, cz - s, cx + s, WH + 2.2, cz + s, 'wall');
  deco(cx - s - 0.15, WH + 1.6, cz - s - 0.15, cx + s + 0.15, WH + 2.2, cz + s + 0.15, 'wallDark');
  for (let i = 0; i < 4; i++) {
    const t = -s + (i + 0.25) * (2 * s / 4);
    deco(cx + t, WH + 2.2, cz - s, cx + t + s * 0.25, WH + 2.9, cz - s + 0.6, 'wall');
    deco(cx + t, WH + 2.2, cz + s - 0.6, cx + t + s * 0.25, WH + 2.9, cz + s, 'wall');
    deco(cx - s, WH + 2.2, cz + t, cx - s + 0.6, WH + 2.9, cz + t + s * 0.25, 'wall');
    deco(cx + s - 0.6, WH + 2.2, cz + t, cx + s, WH + 2.9, cz + t + s * 0.25, 'wall');
  }
}

// =====================================================================================
// BASE SUL (z 38..52)
// =====================================================================================
trilha(-46, 40, 46, 47);
// fonte
box(-2.2, 0, 42.8, 2.2, 0.7, 43.1, 'stone');
box(-2.2, 0, 46.9, 2.2, 0.7, 47.2, 'stone');
box(-2.2, 0, 43.1, -1.9, 0.7, 46.9, 'stone');
box(1.9, 0, 43.1, 2.2, 0.7, 46.9, 'stone');
box(-1.9, 0, 43.1, 1.9, 0.3, 46.9, 'stone');
deco(-1.9, 0.3, 43.1, 1.9, 0.52, 46.9, 'water');
deco(-2.35, 0.7, 42.65, 2.35, 0.8, 47.35, 'trim');
box(-0.35, 0, 44.65, 0.35, 1.6, 45.35, 'stone');
deco(-0.9, 1.6, 44.1, 0.9, 1.82, 45.9, 'stone');
deco(-0.75, 1.82, 44.25, 0.75, 1.86, 45.75, 'water');
deco(-0.15, 1.82, 44.85, 0.15, 2.3, 45.15, 'stone');

// alojamentos encostados no muro sul
casa(-52, 47.5, -38, 52, 5, { win: 'n', door: 'n' });
casa(36, 47, 52, 52, 5.5, { win: 'n', door: 'n' });
toldo([-50, 47.5], [-40, 47.5], 2.9, 'n', 'green');
toldo([38, 47], [50, 47], 3.0, 'n', 'red');
// guarita com telhado alcançável (caixote 1.0 → 1.9 → telhado 2.6)
casa(18, 47, 25, 52, 2.6, { win: 'nw', walk: true, noBeams: true });
caixote(15.7, 48.4, 1.4, 1.0);
caixote(17.1, 49.3, 1.4, 1.9);
// banca de feira e varal no muro sul
banca(-7, 50.9, 'red');
varal(3, 12, 51.2, 2.5);
tapete(0, 4.6, 51.97, 'n', 3.2, 2.2);
tapete(-24, 3.0, 51.97, 'n', 2.2, 1.6);
jarro(-10.2, 51.2);
jarro(-9.4, 51.5);
// cobertura na base
caixote(-22, 43, 2.2, 2.0);
caixote(-19.7, 43.4, 1.5, 1.0);
caixote(-12, 39.8, 1.4, 1.0);
caixote(11, 40.2, 1.6, 1.0);
caixote(27, 43.5, 2.0, 2.0);
caixote(29, 44, 1.4, 1.0);
sacos(-33, 41.5, 4, true);
sacos(36, 41, 3.4, true);
barril(-50.8, 46, 0x3d6fb5);
barril(-50.8, 46.8, 0xb5453d);
barril(30.8, 51.4, 0x3d8f5a);
palmeira(-15, 50.5);
palmeira(14, 50.8);
palmeira(-30, 39.5);
palmeira(33, 39.5);

// =====================================================================================
// LONGO (oeste, x -52..-44)
// =====================================================================================
trilha(-50.5, -14, -45.5, 38);
// portas do longo (z 24..25.5), vão x -49.5..-46.5
muro(-52, 24, -49.5, 25.5, 4.5);
muro(-46.5, 24, -44, 25.5, 4.5);
box(-49.5, 3.1, 24, -46.5, 4.5, 25.5, 'wall');
deco(-49.5, 0, 22.5, -49.38, 2.95, 24, 'door');
deco(-46.62, 0, 22.5, -46.5, 2.95, 24, 'door');
caixote(-50.6, 14, 1.4, 1.0);
caixote(-46.2, -1.5, 2.0, 2.0);
caixote(-46.6, 0.6, 1.3, 1.0);
caixote(-50.7, -9, 1.2, 1.0);
barril(-51.2, 31, 0x3d6fb5);
barril(-51.2, 31.8, 0x3d6fb5);
barril(-50.4, 31.4, 0xc9a13a);
sacos(-45.2, 33, 2.4, false);
palmeira(-50.6, 6);

// casas entre o longo e o meio (sul)
casa(-44, 26, -30, 38, 6, { win: 'sw', door: 's' });
casa(-30, 28, -14, 38, 4.5, { win: 's' });
casa(-14, 24, -6, 38, 5.5, { win: 'se' });
casa(-44, 10, -30, 26, 7, { win: 'w' });
casa(-30, 10, -14, 28, 5);
casa(-14, 10, -6, 24, 4, { win: 'e' });
toldo([-44, 14], [-44, 20], 3.0, 'w', 'red', 1.6);
toldo([-26, 38], [-18, 38], 2.9, 's', 'blue');
toldo([-6, 28], [-6, 34], 2.9, 'e', 'yellow', 1.4);
// casas entre o longo e A / plataforma
casa(-44, -14, -32, 0, 6.5, { win: 'nw', door: 'n' });
casa(-32, -14, -20, -4, 5, { win: 'n' });
casa(-44, 0, -30, 10, 5.5, { win: 'w' });
casa(-30, -4, -20, 10, 4.5);
casa(-20, -6, -12, 10, 4, { win: 'e', noBeams: true });
casa(-12, 6, -6, 10, 3.5, { win: 'e', noBeams: true });
toldo([-42, -14], [-34, -14], 3.0, 'n', 'green');
toldo([-44, -10], [-44, -3], 3.2, 'w', 'blue', 1.5);
tapete(-26, 3.0, -14.03, 'n', 2.4, 1.8);
varal(-40, -34, -15.6, 2.6);

// =====================================================================================
// TERRAÇO (plataforma alta entre meio e A, y = 2.4)
// =====================================================================================
const PH = 2.4;
box(-20, 0, -22, -6, PH, -6, 'stone');
deco(-20.08, PH - 0.2, -22.08, -5.92, PH, -5.92, 'trim');
// mureta virada pro meio (1.0 m) e pro CT (parcial)
box(-6.4, PH, -21.6, -6, PH + 1.0, -7, 'trim');
box(-20, PH, -22, -14, PH + 1.0, -21.6, 'trim');
// cobertura no terraço: caixotes, sacos e jarros
caixote(-15, -14.5, 1.6, 1.0, PH);
caixote(-16.4, -13.2, 1.1, 0.9, PH);
jarro(-18.8, -7.2, 1, PH);
jarro(-18.1, -7.5, 0.8, PH);
deco(-12.5, PH, -12, -9, PH + 0.02, -8, 'paint', { tint: 0xa83a22 }); // tapete no chão
// pérgola (sombra listrada)
for (const [cx, cz] of [[-19.6, -21.2], [-6.9, -21.2], [-19.6, -6.4], [-6.9, -6.4]]) box(cx - 0.18, PH, cz - 0.18, cx + 0.18, PH + 2.9, cz + 0.18, 'wood');
for (let i = 0; i < 9; i++) {
  const z = -21.4 + i * 1.85;
  deco(-20.2, PH + 2.9, z, -6.3, PH + 3.1, z + 0.22, 'wood');
}
deco(-19.8, PH + 3.1, -21.4, -19.4, PH + 3.3, -6.2, 'wood');
deco(-7.1, PH + 3.1, -21.4, -6.7, PH + 3.3, -6.2, 'wood');
// escada do meio (sobe para o norte, x -12..-6, z 4 → -6)
escada(-12, -6, -6, 4, 'n', 0, PH);
// escada para A (sobe para leste, x -26..-20)
escada(-26, -21, -20, -16, 'e', 0, PH);
// caixote de boost no CT (1.0 → crouch-jump para a plataforma)
caixote(-17, -22.8, 1.6, 1.0);

// =====================================================================================
// MEIO (x -6..6)
// =====================================================================================
trilha(-3, -22, 3, 38);
// portão do meio em z 10..11.2, vão x -1.5..1.5
muro(-6, 10, -1.5, 11.2, 4.2);
muro(1.5, 10, 6, 11.2, 4.2);
box(-1.5, 3.0, 10, 1.5, 4.2, 11.2, 'wall');
deco(-1.62, 0, 9.9, -1.5, 3.0, 11.3, 'wood');
deco(1.5, 0, 9.9, 1.62, 3.0, 11.3, 'wood');
deco(-1.5, 0, 9.9, -1.38, 2.95, 8.6, 'door');
deco(1.38, 0, 9.9, 1.5, 2.95, 8.6, 'door');
tapete(-3.8, 2.4, 11.23, 's', 1.6, 1.4);
caixote(-3.6, 30, 1.6, 1.0);
caixote(4.1, 18, 1.4, 1.0);
caixote(3.9, 15.9, 1.6, 2.0);
caixote(3.4, -3, 1.8, 2.0);
caixote(3.6, -5, 1.2, 1.0);
caixote(-3.4, -16.5, 1.4, 1.0);
sacos(-3.8, 21, 2.6, false);
carroca(4.4, 27);
barril(-5.4, 12, 0xb5453d);
barril(5.4, 8.8, 0x3d6fb5);
jarro(-5.3, 36.8);
jarro(5.3, 2.5, 0.8);

// casas entre meio e túnel
casa(6, -22, 20, -16, 5, { win: 'nw' });
casa(6, -12, 20, 0, 5.5, { win: 'w' });
casa(20, -10, 32, 4, 6, { win: 'n', door: 'n' });
casa(32, -10, 44, 6, 5, { win: 'ne' });
casa(6, 0, 20, 10, 4.5, { win: 'w' });
casa(20, 4, 32, 22, 5.2);
casa(32, 6, 44, 22, 6.5, { win: 'e', noBeams: true });
casa(6, 10, 20, 26, 6, { win: 'w' });
casa(6, 26, 20, 38, 5, { win: 'ws', door: 's' });
casa(20, 22, 34, 38, 4.4, { win: 's' });
casa(34, 22, 44, 38, 5.6, { win: 's', door: 's' });
toldo([6, 14], [6, 22], 3.0, 'w', 'green', 1.5);
toldo([22, 38], [32, 38], 2.8, 's', 'red');
toldo([22, -10], [30, -10], 3.1, 'n', 'blue');
toldo([6, -9], [6, -3], 3.0, 'w', 'yellow', 1.4);

// beco coberto (x 6..20, z -16..-12)
box(6, 3.6, -16.2, 20, 4.0, -11.8, 'roof');
deco(12.8, 3.48, -14.2, 13.2, 3.6, -13.8, 'lamp');
barril(8.8, -15.6, 0x3d6fb5);
barril(9.6, -15.6, 0xb5453d);
jarro(15.2, -15.6);
jarro(16.0, -15.5, 0.8);
varal(7, 19, -12.4, 2.7);

// =====================================================================================
// TÚNEL (leste, x 44..52), coberto em z -2..28, em zigue-zague
// =====================================================================================
trilha(45.5, -10, 50.5, 38);
box(43.6, 4.0, -2, 52, 4.4, 28, 'roof');
for (let z = -1; z < 28; z += 3.6) deco(44, 3.72, z, 52, 4.0, z + 0.3, 'wood');
for (let z = 1; z < 27; z += 7.2) deco(47.8, 3.6, z, 48.3, 3.72, z + 0.6, 'lamp');
box(44, 0, 17, 48.5, 4.0, 18.6, 'wallDark');
box(47.5, 0, 5, 52, 4.0, 6.6, 'wallDark');
caixote(50.8, 24.5, 1.4, 1.0);
caixote(45.2, 1.2, 1.2, 1.0);
caixote(50.9, -6, 1.6, 2.0);
barril(45, 12, 0xc9a13a);
barril(45.8, 12.3, 0x3d6fb5);

// =====================================================================================
// CT — CASA GRANDE (x -20..20, z -52..-22)
// =====================================================================================
piso(-18, -44, 18, -24);
casa(-8, -52, 8, -45, 6, { win: 's', door: 's' });
tapete(0, 4.3, -44.97, 's', 2.6, 1.9);
toldo([-7.5, -45], [7.5, -45], 2.75, 's', 'blue', 1.6, 0.5);
// separadores A|CT e CT|B (arcos em z -40..-35)
muro(-21, -52, -20, -40, 4.5);
muro(-21, -35, -20, -22, 4.5);
box(-21, 3.1, -40, -20, 4.5, -35, 'wall');
muro(20, -52, 21, -40, 4.5);
muro(20, -35, 21, -22, 4.5);
box(20, 3.1, -40, 21, 4.5, -35, 'wall');
deco(20.6, 0, -40, 21.9, 2.95, -39.88, 'door');
deco(20.6, 0, -35.12, 21.9, 2.95, -35, 'door');
caixote(-12, -36, 1.6, 1.0);
caixote(12, -30, 1.8, 2.0);
caixote(13.6, -30.4, 1.3, 1.0);
caixote(-4, -28.5, 1.3, 1.0);
caixote(4.5, -38, 1.4, 1.0);
sacos(-10, -27, 3, true);
jarro(10.5, -44.5);
jarro(11.3, -44.4, 0.8);
palmeira(-15.5, -48.5);
palmeira(15.5, -48.5);
palmeira(-15, -25.5);
deco(-16.4, 0, -49.9, -14.6, 0.6, -47.1, 'stone');
deco(14.6, 0, -49.9, 16.4, 0.6, -47.1, 'stone');

// =====================================================================================
// A — PÁTIO (x -52..-20, z -52..-14)
// =====================================================================================
piso(-48, -48, -24, -18);
placa(-36, 0.07, -33, 'u', 7, 7, ['A'], { kind: 'letter', bg: 'rgba(0,0,0,0)', fg: 'rgba(170,40,30,0.85)' });
placa(-36, 4.6, -51.97, 's', 4, 4, ['A'], { kind: 'letter', bg: '#7a2f1d', fg: '#ffe9c2' });
// palco (0.9 m, degrau 0.45)
box(-52, 0, -52, -42, 0.9, -44, 'stone');
box(-52, 0, -44, -42, 0.45, -43, 'stone');
box(-42, 0, -52, -41, 0.45, -44, 'stone');
deco(-52, 0.9, -44.1, -42, 0.98, -44, 'trim');
// portão de saída (fechado)
deco(-33, 0, -52.06, -27, 4.6, -52, 'door');
deco(-33.3, 4.6, -52.15, -26.7, 5.0, -52, 'wood');
caixote(-36, -34, 2.2, 2.0);
caixote(-33.7, -34.5, 1.5, 1.0);
caixote(-36.5, -31.9, 1.4, 1.0);
caixote(-28, -26, 1.4, 1.0);
caixote(-46, -28, 1.8, 1.0);
caixote(-26, -45, 2.0, 2.0);
caixote(-27.9, -45.4, 1.4, 1.0);
sacos(-42, -20, 3.6, true);
barril(-23, -50.8, 0xb5453d);
barril(-22.2, -50.8, 0xb5453d);
palmeira(-24, -30);
palmeira(-49.5, -24);
palmeira(-40, -50.6);

// =====================================================================================
// B — MERCADO (x 20..52, z -52..-10)
// =====================================================================================
piso(23, -48, 49, -14);
placa(37, 0.07, -30, 'u', 7, 7, ['B'], { kind: 'letter', bg: 'rgba(0,0,0,0)', fg: 'rgba(30,70,150,0.85)' });
placa(30, 4.6, -51.97, 's', 4, 4, ['B'], { kind: 'letter', bg: '#1d3f6e', fg: '#ffe9c2' });
// doca (0.9 m, degrau 0.45)
box(42, 0, -52, 52, 0.9, -44, 'stone');
box(42, 0, -44, 52, 0.45, -43, 'stone');
box(41, 0, -52, 42, 0.45, -44, 'stone');
deco(42, 0.9, -44.1, 52, 0.98, -44, 'trim');
// carroça
carroca(28.5, -24);
caixote(38, -36, 2.2, 2.0);
caixote(40.3, -35.7, 1.6, 1.0);
caixote(36, -33.4, 1.4, 1.0);
caixote(46, -40, 1.4, 1.0, 0.9);
caixote(48, -46, 2.0, 2.0, 0.9);
caixote(36.6, -16, 1.8, 1.0);
sacos(25, -44, 3.6, false);
sacos(44, -24, 3.2, true);
barril(50.9, -13, 0x3d8f5a);
barril(50.9, -13.8, 0x3d8f5a);
palmeira(23.5, -50);
palmeira(31.5, -13);
palmeira(49.8, -30);


// =====================================================================================
// SPAWNS E NAVEGAÇÃO
// =====================================================================================
const look = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
const sp = (x: number, z: number, tx = 0, tz = 0, y = 0): SpawnPoint => ({ pos: [x, y, z], yaw: look(x, z, tx, tz) });

const spawns: SpawnPoint[] = [
  sp(-8, 41.5, -8, 0),
  sp(9, 45, 9, 0),
  sp(-36, 44.5, -48, 30),
  sp(30, 48.5, 48, 30),
  sp(-48, 6, -48, -30),
  sp(0, 26, 0, 0),
  sp(-40, -40, -24, -20),
  sp(-30, -21, -10, -30),
  sp(-10, -32, 0, 0),
  sp(12, -41, 0, 0),
  sp(40, -46, 30, -20),
  sp(33, -18, 20, -40),
  sp(48, 12, 48, -10),
  sp(48.5, 32, 0, 45),
];

const navNodes: Vec3[] = [
  // base dos peões
  [-48, 0, 44], [-36, 0, 42], [-22, 0, 40], [-8, 0, 41.5], [0, 0, 40], [8, 0, 41.5], [20, 0, 42], [34, 0, 45], [48, 0, 42], [0, 0, 50], [-30, 0, 46],
  // longo
  [-48, 0, 32], [-48, 0, 24.75], [-48, 0, 16], [-48, 0, 3], [-48, 0, -12],
  // A
  [-46, 0, -22], [-40, 0, -40], [-30, 0, -47], [-29, 0, -32], [-28, 0, -18.5], [-23, 0, -37.5],
  // sala de reunião (plataforma)
  [-18.5, PH, -18.5], [-9, PH, -18], [-9, PH, -5.2], [-18.5, PH, -9],
  // meio
  [-9, 0, 5], [0, 0, 32], [0, 0, 20], [0, 0, 10.6], [-1, 0, 4], [0, 0, -8], [0, 0, -18],
  // corredor do café
  [8, 0, -14], [18, 0, -14],
  // CT
  [0, 0, -27], [-12, 0, -31], [12, 0, -34], [-17, 0, -37.5], [17, 0, -37.5], [0, 0, -40],
  // B
  [24, 0, -37.5], [24, 0, -16], [30, 0, -32], [34, 0, -46], [44, 0, -36], [38, 0, -19], [48, 0, -14],
  // túnel
  [48, 0, -4], [45.7, 0, 5.8], [48.5, 0, 11], [50.3, 0, 17.8], [48, 0, 30],
];

export const DUST: MapDef = {
  name: 'de_poeira',
  bounds: { min: [-52, 0, -52], max: [52, 12, 52] },
  boxes,
  spawns,
  navNodes,
  signs,
  awnings,
  palms,
  sunDir: [0.55, 1, 0.32],
  fogColor: 0xe9cfa6,
  skyTop: 0x4f97d8,
  skyBottom: 0xf4dcb4,
};
