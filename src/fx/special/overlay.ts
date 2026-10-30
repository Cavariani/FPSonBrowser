/**
 * Overlays em DOM das armas malucas (criados aqui, sem mexer no HUD): cocô de pombo na tela,
 * vinheta de fogo, estrelinhas de atordoado e clarão de choque. O HUD pode ler os mesmos dados
 * em `HudState` (blind/burning/stunned/shocked) e desenhar os dele no lugar, se preferir: é só chamar
 * `SpecialFX.overlayEnabled = false`.
 */

const CSS = `
.sfx{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.sfx>*{position:absolute;inset:0;opacity:0}
.sfx .splat svg{width:100%;height:100%;display:block}
.sfx .splat .drip{animation:sfxdrip 2.6s ease-in forwards}
@keyframes sfxdrip{from{transform:translateY(0)}to{transform:translateY(16px)}}
.sfx .burn{background:radial-gradient(ellipse at 50% 55%,rgba(255,120,0,0) 38%,rgba(255,96,0,.38) 72%,rgba(255,40,0,.78) 100%)}
.sfx .shock{background:radial-gradient(circle at 50% 50%,rgba(210,240,255,.55),rgba(120,200,255,.25) 60%,rgba(255,255,255,.5))}
.sfx .steam{background:radial-gradient(ellipse at 50% 50%,rgba(255,255,255,.55),rgba(236,240,244,.8) 70%,rgba(255,255,255,.9));backdrop-filter:blur(7px) brightness(1.15);-webkit-backdrop-filter:blur(7px) brightness(1.15)}
.sfx .stun{display:flex;justify-content:center;align-items:flex-start}
.sfx .stun .ring{position:relative;width:min(46vw,380px);height:min(10vw,80px);margin-top:3vh}
.sfx .stun .st{position:absolute;left:50%;top:50%;font:700 min(6vw,46px)/1 sans-serif;color:#ffe14a;text-shadow:0 2px 0 #7a5200,0 0 8px #ffb300;transform:translate(-50%,-50%)}
`;

function splatSVG(): string {
  const R = Math.random;
  let s = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">';
  const n = 4 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const cx = 14 + R() * 72, cy = 10 + R() * 58, r = 7 + R() * 11;
    let pts = '';
    const k = 16;
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2;
      const rr = r * (0.72 + R() * 0.5);
      pts += `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr * 0.86).toFixed(1)} `;
    }
    s += `<polygon points="${pts}" fill="#f6f3ea" stroke="#cdc7b3" stroke-width=".7" stroke-linejoin="round"/>`;
    s += `<ellipse cx="${(cx + (R() - 0.5) * r * 0.3).toFixed(1)}" cy="${(cy + (R() - 0.5) * r * 0.3).toFixed(1)}" rx="${(r * 0.3).toFixed(1)}" ry="${(r * 0.2).toFixed(1)}" fill="#8b8873"/>`;
    for (let j = 0; j < 4; j++) {
      const a = R() * 6.28, d = r * (1.0 + R() * 0.7), rr = 1 + R() * 2.4;
      s += `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d).toFixed(1)}" r="${rr.toFixed(1)}" fill="#f6f3ea"/>`;
    }
    for (let j = 0; j < 2; j++) {
      const x = cx + (R() - 0.5) * r * 1.2, y0 = cy + r * 0.5, len = 8 + R() * 22;
      s += `<rect class="drip" x="${(x - 1.1).toFixed(1)}" y="${y0.toFixed(1)}" width="2.2" height="${len.toFixed(1)}" rx="1.1" fill="#f6f3ea" style="animation-delay:${(R() * 0.8).toFixed(2)}s"/>`;
    }
  }
  return s + '</svg>';
}

export class Overlay {
  private root: HTMLDivElement;
  private splat: HTMLDivElement;
  private burn: HTMLDivElement;
  private shock: HTMLDivElement;
  private stun: HTMLDivElement;
  private steam: HTMLDivElement;
  private stars: HTMLElement[] = [];
  private t = 0;
  private burnA = 0;
  private stunA = 0;
  private steamA = 0;
  enabled = true;

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'sfx';
    const mk = (cls: string) => {
      const d = document.createElement('div');
      d.className = cls;
      this.root.appendChild(d);
      return d;
    };
    this.burn = mk('burn');
    this.shock = mk('shock');
    this.splat = mk('splat');
    this.stun = mk('stun');
    this.steam = mk('steam');
    const ring = document.createElement('div');
    ring.className = 'ring';
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = 'st';
      s.textContent = '★';
      ring.appendChild(s);
      this.stars.push(s);
    }
    this.stun.appendChild(ring);
    // por baixo do HUD e do menu (que são adicionados depois no #ui)
    const host = document.getElementById('ui') ?? document.body;
    host.prepend(this.root);
  }

  /** Nova cagada: sorteia o desenho. */
  newSplat(): void {
    this.splat.innerHTML = splatSVG();
  }

  update(dt: number, s: { blind: number; steam: number; burning: boolean; stunned: boolean; shocked: boolean }): void {
    this.t += dt;
    const on = this.enabled;
    this.splat.style.opacity = on ? String(Math.min(1, s.blind)) : '0';
    this.steamA += ((on ? s.steam : 0) - this.steamA) * Math.min(1, dt * 12);
    this.steam.style.opacity = this.steamA < 0.01 ? '0' : Math.min(0.92, this.steamA).toFixed(2);
    this.burnA += ((s.burning ? 1 : 0) - this.burnA) * Math.min(1, dt * 6);
    this.burn.style.opacity = on ? String((this.burnA * (0.75 + Math.random() * 0.25)).toFixed(2)) : '0';
    this.stunA += ((s.stunned ? 1 : 0) - this.stunA) * Math.min(1, dt * 10);
    this.stun.style.opacity = on ? this.stunA.toFixed(2) : '0';
    if (s.stunned) {
      this.stars.forEach((el, i) => {
        const a = this.t * 4.2 + (i / this.stars.length) * Math.PI * 2;
        el.style.transform = `translate(calc(-50% + ${(Math.cos(a) * 46).toFixed(1)}%), calc(-50% + ${(Math.sin(a) * 40).toFixed(1)}%)) scale(${(0.8 + 0.3 * Math.sin(a)).toFixed(2)})`;
      });
    }
    this.shock.style.opacity = on && s.shocked && Math.random() < 0.45 ? (0.08 + Math.random() * 0.22).toFixed(2) : '0';
  }
}
