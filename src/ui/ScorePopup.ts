/**
 * Popup de pontos estilo Call of Duty, perto da mira.
 * Visual apenas: número total grande + lista (máx. 4) com o motivo de cada soma.
 * Anima só com transform/opacity; o texto da contagem muda no máximo ~30x/s e só enquanto conta.
 */

const HOLD_MS = 2500;      // sem novos pontos até começar a sumir
const FADE_MS = 450;       // duração do fade/slide
const MAX_LINES = 4;
const TICK_MS = 33;        // ~30 atualizações/s da contagem

type State = 'idle' | 'show' | 'out';

export class ScorePopup {
  private el: HTMLDivElement;
  private totalEl: HTMLDivElement;
  private linesEl: HTMLDivElement;
  private total = 0;        // alvo
  private shown = 0;        // valor exibido na contagem
  private lastTick = 0;
  private state: State = 'idle';
  private expireAt = 0;
  private outEnd = 0;
  private popAnim: Animation | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sp';
    this.totalEl = document.createElement('div');
    this.totalEl.className = 'sp-total';
    this.totalEl.textContent = '+0';
    this.linesEl = document.createElement('div');
    this.linesEl.className = 'sp-lines';
    this.el.append(this.totalEl, this.linesEl);
    parent.appendChild(this.el);
  }

  /** Soma pontos de um evento. `reasons` aparecem como linhas (novas no topo). */
  add(reasons: { pts: number; label: string }[], now = performance.now()): void {
    if (!reasons.length) return;
    let sum = 0;
    reasons.forEach((r, i) => {
      sum += r.pts;
      this.pushLine(r.pts, r.label, i);
    });
    this.total += sum;
    this.expireAt = now + HOLD_MS;
    if (this.state !== 'show') {
      this.state = 'show';
      this.el.classList.remove('out');
      this.el.classList.add('on');
    }
    this.pop();
  }

  /** Chamar a cada frame (barato: só trabalha enquanto conta ou ao expirar). */
  update(now: number): void {
    if (this.state === 'idle') return;
    if (this.state === 'show') {
      if (this.shown !== this.total && now - this.lastTick >= TICK_MS) {
        this.lastTick = now;
        const left = this.total - this.shown;
        this.shown += Math.max(1, Math.ceil(left * 0.35));
        if (this.shown > this.total) this.shown = this.total;
        this.totalEl.textContent = '+' + this.shown;
      }
      if (now >= this.expireAt && this.shown === this.total) {
        this.state = 'out';
        this.outEnd = now + FADE_MS;
        this.el.classList.remove('on');
        this.el.classList.add('out');
      } else if (now >= this.expireAt) {
        this.expireAt = now + 300; // ainda contando: segura um pouco
      }
    } else if (now >= this.outEnd) {
      this.reset();
    }
  }

  /** Limpa tudo (nova partida etc). */
  reset(): void {
    this.state = 'idle';
    this.total = 0; this.shown = 0;
    this.totalEl.textContent = '+0';
    this.linesEl.textContent = '';
    this.el.classList.remove('on', 'out');
    this.popAnim?.cancel();
    this.popAnim = null;
  }

  private pushLine(pts: number, label: string, i: number): void {
    const ln = document.createElement('div');
    ln.className = 'sp-line';
    const p = document.createElement('b');
    p.textContent = '+' + pts;
    ln.append(p, ' ' + label);
    this.linesEl.prepend(ln);
    while (this.linesEl.children.length > MAX_LINES) this.linesEl.lastElementChild!.remove();
    ln.animate(
      [
        { opacity: 0, transform: 'translateY(-10px) scale(1.25)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ],
      { duration: 160, delay: i * 60, easing: 'ease-out', fill: 'backwards' },
    );
  }

  private pop(): void {
    this.popAnim?.cancel();
    this.popAnim = this.totalEl.animate(
      [{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }],
      { duration: 200, easing: 'cubic-bezier(.2,1.6,.4,1)' },
    );
  }
}
