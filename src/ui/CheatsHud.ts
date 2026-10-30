import './cheats.css';
import { bus } from '../core/events';
import { CHEAT_DEFS, CHEAT_ORDER, type CheatId, type CheatsHud as CheatsState } from '../game/Cheats';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const FX_LOG: Record<CheatId, string[]> = {
  wallhack: ['> inject wallhack.dll', '> hook glDepthFunc ... OK', '> esp.draw(enemies) ...', '> wallhack.exe running...'],
  aimbot: ['> inject aimbot.dll', '> hook Player::look ... OK', '> target = head ...', '> aimbot.exe running...'],
  noclip: ['> inject noclip.dll', '> collision.enabled = false', '> gravity = 0', '> noclip.exe running...'],
};

const HP_HI = '#3dff5a', HP_MID = '#ffd83a', HP_LO = '#ff3030';

/**
 * Killstreaks-cheat no HUD: ESP (um canvas 2D, sem alocação por frame), notificações estilo terminal,
 * cheats guardados num canto, timer do ativo e efeito de tela "hack".
 */
export class CheatsHud {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private w = 0; private hgt = 0; private dpr = 1;
  private drewEsp = false;
  private fx: HTMLDivElement; private fxLog: HTMLPreElement;
  private toasts: HTMLDivElement;
  private store: HTMLDivElement; private storeRows: HTMLDivElement; private storeStreak: HTMLDivElement;
  private run: HTMLDivElement; private runTxt: HTMLElement; private runTime: HTMLElement; private runBar: HTMLElement;
  private sig = { store: '\0', active: '\0', t: -1, bar: -1 };

  constructor(parent: HTMLElement) {
    this.canvas = h('canvas', 'ch-esp');
    this.ctx = this.canvas.getContext('2d');
    this.fx = h('div', 'ch-fx');
    this.fxLog = h('pre', 'ch-log');
    this.fx.append(h('div', 'ch-scan'), this.fxLog);
    this.toasts = h('div', 'ch-toasts');
    this.store = h('div', 'ch-store');
    this.storeRows = h('div', 'rows');
    this.storeStreak = h('div', 'streak');
    this.store.append(h('div', 'hd', '> CHEATS'), this.storeRows, this.storeStreak);
    this.run = h('div', 'ch-run');
    this.runTxt = h('span', 'txt');
    this.runTime = h('span', 'tm');
    this.runBar = h('b');
    const bar = h('div', 'ch-bar');
    bar.append(this.runBar);
    const top = h('div', 'ln');
    top.append(this.runTxt, this.runTime);
    this.run.append(top, bar);
    parent.append(this.canvas, this.fx, this.toasts, this.store, this.run);

    bus.on('cheat:ready', (e) => this.toast(e.id));
    bus.on('match:start', () => { this.toasts.textContent = ''; });
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = innerWidth; this.hgt = innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.hgt * this.dpr);
    this.drewEsp = false;
  }

  private toast(id: CheatId): void {
    while (this.toasts.children.length >= 3) this.toasts.firstElementChild!.remove();
    const d = CHEAT_DEFS[id];
    const text = `> ${d.name} DISPONÍVEL — aperte [V]`;
    const el = h('div', 'ch-toast', text);
    el.style.setProperty('--n', String(text.length));
    this.toasts.append(el);
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4000);
  }

  update(c: CheatsState): void {
    this.updateStore(c);
    this.updateRun(c);
    this.drawEsp(c);
  }

  private updateStore(c: CheatsState): void {
    const sig = `${c.streak}|${c.nextAt}|${c.stored.join(',')}`;
    if (sig === this.sig.store) return;
    this.sig.store = sig;
    this.store.classList.toggle('on', c.streak > 0 || c.stored.length > 0);
    this.storeRows.textContent = '';
    // o primeiro (de maior nível) é o que o V ativa
    let best = -1;
    for (let i = 0; i < c.stored.length; i++) {
      if (best < 0 || CHEAT_ORDER.indexOf(c.stored[i]) > CHEAT_ORDER.indexOf(c.stored[best])) best = i;
    }
    for (let i = 0; i < c.stored.length; i++) {
      const row = h('div', i === best ? 'row best' : 'row');
      row.textContent = `${i === best ? '[V]' : '   '} ${CHEAT_DEFS[c.stored[i]].exe}`;
      this.storeRows.append(row);
    }
    this.storeStreak.textContent = c.nextAt === null ? `streak ${c.streak}` : `streak ${c.streak} | proximo em ${c.nextAt}`;
  }

  private updateRun(c: CheatsState): void {
    const s = this.sig;
    const id = c.active ?? '';
    if (id !== s.active) {
      s.active = id;
      this.run.classList.toggle('on', !!c.active);
      this.fx.classList.toggle('on', !!c.active);
      this.fx.dataset.cheat = id;
      this.run.dataset.cheat = id;
      if (c.active) {
        this.runTxt.textContent = `> ${CHEAT_DEFS[c.active].exe} running...`;
        this.fxLog.textContent = FX_LOG[c.active].join('\n');
      }
      s.t = -1; s.bar = -1;
    }
    if (!c.active) return;
    const t = Math.ceil(c.timeLeft * 10);
    if (t !== s.t) { s.t = t; this.runTime.textContent = (t / 10).toFixed(1) + 's'; }
    const b = Math.round((c.timeLeft / c.duration) * 100);
    if (b !== s.bar) { s.bar = b; this.runBar.style.transform = `scaleX(${b / 100})`; }
  }

  private drawEsp(c: CheatsState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const on = c.active === 'wallhack' && c.espCount > 0;
    if (!on) {
      if (this.drewEsp) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.drewEsp = false; }
      return;
    }
    const W = this.w, H = this.hgt;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 2;
    ctx.font = '12px Consolas, monospace';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    for (let i = 0; i < c.espCount; i++) {
      const b = c.esp[i];
      const x = Math.round(b.x0 * W), y = Math.round(b.y0 * H);
      const w = Math.max(4, Math.round((b.x1 - b.x0) * W)), hh = Math.max(4, Math.round((b.y1 - b.y0) * H));
      if (w > W * 4 || hh > H * 4) continue;
      ctx.fillStyle = 'rgba(255, 0, 0, 0.07)';
      ctx.fillRect(x, y, w, hh);
      ctx.strokeStyle = '#ff1414';
      ctx.strokeRect(x, y, w, hh);
      // barra de vida na esquerda
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 6, y - 1, 4, hh + 2);
      ctx.fillStyle = b.hp > 0.6 ? HP_HI : b.hp > 0.3 ? HP_MID : HP_LO;
      const fh = Math.round(hh * b.hp);
      ctx.fillRect(x - 5, y + hh - fh, 2, fh);
      // nome + distância
      ctx.fillStyle = '#000';
      ctx.fillText(b.label, x + 1, y - 2);
      ctx.fillStyle = '#ff5a5a';
      ctx.fillText(b.label, x, y - 3);
    }
    this.drewEsp = true;
  }
}
