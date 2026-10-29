import { DUST } from '../maps/dust';
import type { MapDef } from '../maps/types';
import { SPECIALS } from '../game/special/defs';
import type { HudState } from './types';

/** Raio de visão do radar (m). */
const RADIUS = 45;
/** Período do sweep (s). */
const PERIOD = 2.5;
/** Largura angular do rastro (rad). */
const TRAIL = (75 * Math.PI) / 180;
/** Pixels por metro da camada estática. */
const PPM = 6;
const PAD = 2;
const TAU = Math.PI * 2;

interface Reveal { x: number; z: number; t: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgb = (r: number, g: number, b: number) => `rgb(${r | 0},${g | 0},${b | 0})`;

/**
 * Minimapa com radar: um único canvas 2D, centrado no jogador, girando com o yaw.
 * Camada estática pré-renderizada; sweep constante revela inimigos que ficam
 * parados no ponto da passagem e somem até a próxima volta.
 */
export class Minimap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // camada estática (mapa)
  private layer: HTMLCanvasElement;
  private lx: number; private lz: number; private lw: number; private lh: number;

  // sprites dependentes do tamanho
  private overlay: HTMLCanvasElement;
  private trail: HTMLCanvasElement;
  private size = 0;
  private dpr = 1;

  private reveals = new Map<string, Reveal>();
  private prevPhi = NaN;
  private dead = false;

  constructor(parent: HTMLElement, map: MapDef = DUST) {
    this.el = document.createElement('div');
    this.el.className = 'mm';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    this.layer = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.trail = document.createElement('canvas');

    this.lx = map.bounds.min[0] - PAD; this.lz = map.bounds.min[2] - PAD;
    this.lw = map.bounds.max[0] - map.bounds.min[0] + PAD * 2;
    this.lh = map.bounds.max[2] - map.bounds.min[2] + PAD * 2;
    this.buildLayer(map);

    new ResizeObserver(() => this.resize()).observe(this.canvas);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /* ---------------------------------------------------------- camada estática */

  private buildLayer(map: MapDef): void {
    const c = this.layer;
    c.width = Math.ceil(this.lw * PPM); c.height = Math.ceil(this.lh * PPM);
    const g = c.getContext('2d')!;
    g.fillStyle = '#12151c';
    g.fillRect(0, 0, c.width, c.height);
    g.scale(PPM, PPM);
    g.translate(-this.lx, -this.lz);

    const list = map.boxes
      .filter((b) => {
        if (b.collide === false) return false;
        if (b.min[1] > 2.2) return false; // telhados/vigas altas: deixa o interior visível
        const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
        if (Math.max(w, d) < 0.35) return false; // postes, detalhes
        if (Math.min(w, d) < 0.12) return false; // finas demais
        return true;
      })
      .sort((a, b) => a.max[1] - b.max[1]);

    g.lineJoin = 'miter';
    for (const b of list) {
      const top = b.max[1];
      const k = Math.min(1, top / 6);
      let r = lerp(40, 168, k), gg = lerp(36, 160, k), bl = lerp(28, 134, k);
      if (b.mat === 'water') { r = 38; gg = 70; bl = 92; }
      g.fillStyle = rgb(r, gg, bl);
      const x = b.min[0], z = b.min[2], w = b.max[0] - x, d = b.max[2] - z;
      g.fillRect(x, z, w, d);
      if (top > 1) {
        g.lineWidth = 0.18;
        g.strokeStyle = rgb(r * 0.62, gg * 0.62, bl * 0.62);
        g.strokeRect(x + 0.09, z + 0.09, w - 0.18, d - 0.18);
      }
    }
  }

  /* ---------------------------------------------------------- tamanho / sprites */

  private resize(): void {
    const css = this.canvas.clientWidth;
    if (css <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(css * dpr);
    if (px === this.size && dpr === this.dpr) return;
    this.size = px; this.dpr = dpr;
    this.canvas.width = px; this.canvas.height = px;
    this.buildOverlay();
    this.buildTrail();
  }

  /** Vinheta, anéis de alcance, eixos e cone de visão (tudo fixo na tela). */
  private buildOverlay(): void {
    const s = this.size, h = s / 2, d = this.dpr;
    const c = this.overlay; c.width = s; c.height = s;
    const g = c.getContext('2d')!;
    // cone de visão (jogador sempre olha para cima)
    const cone = g.createRadialGradient(h, h, 0, h, h, h);
    cone.addColorStop(0, 'rgba(255,255,255,0.20)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath(); g.moveTo(h, h);
    g.arc(h, h, h, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    g.closePath(); g.fill();
    // vinheta
    const v = g.createRadialGradient(h, h, h * 0.55, h, h, h);
    v.addColorStop(0, 'rgba(6,12,10,0)');
    v.addColorStop(1, 'rgba(6,12,10,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, s, s);
    // anéis e eixos
    g.strokeStyle = 'rgba(95,227,138,0.22)';
    g.lineWidth = Math.max(1, d * 0.8);
    for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(h, h, h * f, 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(95,227,138,0.12)';
    g.beginPath(); g.moveTo(h, 0); g.lineTo(h, s); g.moveTo(0, h); g.lineTo(s, h); g.stroke();
  }

  /** Rastro do sweep: cunha com alpha crescente até a linha (ângulo 0, para a direita). */
  private buildTrail(): void {
    const s = this.size, h = s / 2;
    const c = this.trail; c.width = s; c.height = s;
    const g = c.getContext('2d')!;
    const N = 30;
    g.fillStyle = '#5fe38a';
    for (let i = 0; i < N; i++) {
      const a0 = -TRAIL + (TRAIL * i) / N, a1 = -TRAIL + (TRAIL * (i + 1)) / N + 0.004;
      const u = (i + 1) / N;
      g.globalAlpha = 0.34 * u * u;
      g.beginPath(); g.moveTo(h, h); g.arc(h, h, h, a0, a1); g.closePath(); g.fill();
    }
    g.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- update */

  update(s: HudState, nowMs: number): void {
    const size = this.size;
    if (size <= 0) { this.resize(); if (this.size <= 0) return; }
    const ctx = this.ctx, d = this.dpr, h = this.size / 2;
    const k = this.size / (2 * RADIUS); // px por metro
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);

    if (s.dead !== this.dead) { this.dead = s.dead; this.el.classList.toggle('dead', s.dead); }

    // ---- sweep (ângulo do MUNDO, cresce no sentido horário na tela)
    const phi = (nowMs / 1000 / PERIOD) * TAU;
    let prev = this.prevPhi;
    if (!(prev === prev)) prev = phi;
    prev = Math.max(prev, phi - 1.0); // evita saltos após pausa
    this.prevPhi = phi;
    const span = phi - prev;

    // revela inimigos cruzados entre prev e phi
    if (!s.dead && span > 0) {
      const radar = s.radar;
      for (let i = 0; i < radar.length; i++) {
        const e = radar[i];
        if (!e.alive) continue;
        const dx = e.x - s.posX, dz = e.z - s.posZ;
        let da = Math.atan2(dz, dx) - prev;
        da -= Math.floor(da / TAU) * TAU;
        if (da > span) continue;
        let r = this.reveals.get(e.id);
        if (!r) { r = { x: 0, z: 0, t: 0 }; this.reveals.set(e.id, r); }
        r.x = e.x; r.z = e.z; r.t = nowMs;
      }
    }

    // ---- mapa estático
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.setTransform(cy * k, sy * k, -sy * k, cy * k, h, h);
    ctx.drawImage(this.layer, this.lx - s.posX, this.lz - s.posZ, this.lw, this.lh);

    // ---- overlay fixo
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.overlay, 0, 0);

    // ---- rastro + linha do sweep (ângulo na tela = phi + yaw)
    const a = phi + s.yaw, ca = Math.cos(a), sa = Math.sin(a);
    ctx.setTransform(ca, sa, -sa, ca, h, h);
    ctx.drawImage(this.trail, -h, -h);
    ctx.fillStyle = 'rgba(190,255,210,0.9)';
    ctx.fillRect(0, -0.7 * d, h, 1.4 * d);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // ---- blips revelados
    const life = PERIOD * 1000;
    const edge = h - 6 * d;
    for (const [id, r] of this.reveals) {
      const age = nowMs - r.t;
      if (age >= life) { this.reveals.delete(id); continue; }
      const f = 1 - age / life;
      const dx = r.x - s.posX, dz = r.z - s.posZ;
      let bx = (dx * cy - dz * sy) * k, by = (dx * sy + dz * cy) * k;
      const dist = Math.hypot(bx, by);
      let rad = 3.6 * d;
      if (dist > edge) { const m = edge / dist; bx *= m; by *= m; rad = 2.3 * d; }
      const al = f * f * 0.85 + 0.15 * f;
      // halo de impacto logo após a passagem
      if (age < 350) {
        ctx.globalAlpha = (1 - age / 350) * 0.6;
        ctx.strokeStyle = '#ff6a5c';
        ctx.lineWidth = d;
        ctx.beginPath(); ctx.arc(h + bx, h + by, rad + (age / 350) * 6 * d, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = al;
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath(); ctx.arc(h + bx, h + by, rad, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- pickups de armas malucas (sempre visíveis, pulsando)
    const pk = s.pickups;
    if (pk && pk.length) {
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 220);
      for (let i = 0; i < pk.length; i++) {
        const q = pk[i];
        const dx = q.x - s.posX, dz = q.z - s.posZ;
        let bx = (dx * cy - dz * sy) * k, by = (dx * sy + dz * cy) * k;
        const dist = Math.hypot(bx, by);
        let rad = (3.6 + 1.2 * pulse) * d;
        if (dist > edge) { const m = edge / dist; bx *= m; by *= m; rad *= 0.75; }
        const col = '#' + (SPECIALS[q.kind]?.color ?? 0xffd23f).toString(16).padStart(6, '0');
        const x = h + bx, y = h + by;
        ctx.globalAlpha = 0.25 + 0.35 * pulse;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x, y, rad * 1.9, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(x, y - rad * 1.25); ctx.lineTo(x + rad * 1.25, y); ctx.lineTo(x, y + rad * 1.25); ctx.lineTo(x - rad * 1.25, y); ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = d; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
    }

    // ---- norte (-Z) preso na borda
    const nx = h + (sy) * (h - 9 * d), ny = h - cy * (h - 9 * d);
    ctx.fillStyle = 'rgba(217,201,160,0.85)';
    ctx.font = `${9 * d}px monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    // ---- jogador (seta branca no centro)
    const u = d * 5.5;
    ctx.beginPath();
    ctx.moveTo(h, h - u * 1.15);
    ctx.lineTo(h + u * 0.75, h + u * 0.8);
    ctx.lineTo(h, h + u * 0.35);
    ctx.lineTo(h - u * 0.75, h + u * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = d;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.stroke();
  }
}
