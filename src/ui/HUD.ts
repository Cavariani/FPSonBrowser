import { MAX_HP } from '../game/Actor';
import './hud.css';
import { bus } from '../core/events';
import { PRICE } from '../game/shop';
import { SPECIALS } from '../game/special/defs';
import type { SpecialId } from '../game/special/defs';
import type { WeaponId } from '../game/weaponDefs';
import type { HudState, ScoreRow } from './types';
import { CheatsHud } from './CheatsHud';
import { hex, icon, wInfo } from './icons';
import { shopName } from './ShopHud';
import { Minimap } from './Minimap';
import { ShopHud } from './ShopHud';
import { ScorePopup } from './ScorePopup';

/* ------------------------------------------------------------------ util */

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

interface DmgInd { el: HTMLDivElement; dx: number; dz: number; born: number; angle: number }

const SVG_HIT =
  '<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="square">' +
  '<path d="M4 4 L12 12 M32 4 L24 12 M4 32 L12 24 M32 32 L24 24"/></svg>';
const SVG_HEART =
  '<svg viewBox="0 0 8 7" fill="currentColor" shape-rendering="crispEdges"><path d="M1 0h2v1h2V0h2v1h1v2H7v1H6v1H5v1H4v1H3V6H2V5H1V4H0V1h1z"/></svg>';

/* ------------------------------------------------------------------ HUD */

/** HUD em HTML por cima do canvas. Atualiza o DOM só quando o valor muda. */
export class HUD {
  private root: HTMLDivElement;

  // mira
  private xT!: HTMLElement; private xB!: HTMLElement; private xL!: HTMLElement; private xR!: HTMLElement;
  private gap = -1;
  private vh = innerHeight;
  private hitm!: HTMLDivElement;
  private hitAnim: Animation | null = null;
  private dmgWrap!: HTMLDivElement;
  private dmgInds: DmgInd[] = [];

  // vida / munição
  private hpBox!: HTMLElement; private hpNum!: HTMLElement; private hpBar!: HTMLElement;
  private ammoBox!: HTMLElement; private wName!: HTMLElement; private ammoCur!: HTMLElement; private ammoMag!: HTMLElement; private relBar!: HTMLElement;
  private feed!: HTMLDivElement;
  private golacoEl!: HTMLDivElement;
  private msgs!: HTMLDivElement;
  private death!: HTMLElement; private deathBy!: HTMLElement; private deathCd!: HTMLElement;
  private deathFace!: HTMLImageElement;
  private endb!: HTMLDivElement; private endH!: HTMLElement; private endP!: HTMLElement;
  private cashEl!: HTMLElement; private goalEl!: HTMLElement; private leaderEl!: HTMLElement;
  private shop!: ShopHud;
  private armEl!: HTMLElement;
  private ctaEl!: HTMLElement; private ctaSub!: HTMLElement;
  private fpsEl!: HTMLElement;
  private chargeEl!: HTMLElement; private chargeBar!: HTMLElement;
  private spHint!: HTMLElement; private spPips!: HTMLElement; private spBar!: HTMLElement; private spTag!: HTMLElement;
  private hintAnim: Animation | null = null;
  private minimap!: Minimap;
  private cheats!: CheatsHud;
  private adsOn = false;
  private sbBody!: HTMLTableSectionElement; private sbDate!: HTMLElement;

  // cache
  private p = {
    hp: -1, wid: '' as string, ammo: -2, mag: -2, rel: false, relP: -1, sw: false, mode: '' as string, cash: -1, goal: '', armor: -1,
    leader: '\0', sid: '' as string, sact: false, sammo: -1, charge: -1, dead: false, cd: '', fps: -1, sb: '', sbShow: false, zoomed: false, lowAmmo: false,
  };
  private feedRows: { el: HTMLElement; die: number }[] = [];
  private score!: ScorePopup;
  private streak = 0; private lastKillerId = ''; private anyKill = false;
  private lastHit: { x: number; z: number; t: number } | null = null;
  private px = 0; private pz = 0;
  private nowMs = 0;
  private lastTrainingShown = false;

  constructor(parent: HTMLElement) {
    this.root = h('div', 'hud');
    this.build();
    parent.appendChild(this.root);
    this.listen();
    addEventListener('resize', () => this.onResize());
    this.onResize();
  }

  /** Mostra/esconde SÓ o HUD (nunca o root #ui, que também hospeda o menu). */
  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
  }

  /* -------------------------------------------------------------- build */

  private build(): void {
    const r = this.root;
    r.innerHTML = `
      <div class="lowvig"></div>
      <div class="scope"><div class="sd"></div></div>
      <div class="xhair"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i><i class="stapler"></i></div>
      <div class="charge"><b></b></div>
      <div class="hitm">${SVG_HIT}</div>
      <div class="dmg-wrap"></div>
      <div class="fps">-- fps</div>
      <div class="top">
        <div class="box money"><b class="cash">$0</b><span class="goal"></span><span class="key">[B] LOJA</span></div>
        <div class="leader"></div>
        <div class="sptag"></div>
        <div class="training">MODO TREINO: 1-6 troca arma</div>
      </div>
      <div class="feed"></div>
      <div class="msgs"></div>
      <div class="golaco"></div>
      <div class="box hp"><span class="lbl">VIDA <b class="arm"></b></span><div class="row"><div class="ico">${SVG_HEART}</div><div class="num">${MAX_HP}</div></div><div class="bar"><b></b></div></div>
      <div class="sphint"></div>
      <div class="shopcta"><kbd>B</kbd><span class="t">ABRIR LOJA</span><small class="d"></small></div>
      <div class="box ammo">
        <span class="lbl">MUNIÇÃO</span>
        <div class="wname"></div>
        <div class="nums"><span class="cur">0</span><span class="mag">/0</span></div>
        <div class="sppips"></div>
        <div class="bar spbar"><b></b></div>
        <div class="melee-txt">CLIQUE: GRAMPEAR</div>
        <div class="rel">RECARREGANDO...</div>
        <div class="bar"><b></b></div>
      </div>
      <div class="death"><div class="letter">
        <h2>VOCÊ MORREU</h2><img class="kface" alt="" style="display:none"><div class="by"></div>
        <div class="cd">Renascendo em <b>0.0</b>s</div></div></div>
      <div class="endb"><h1></h1><p></p></div>
      <div class="sb"><div class="paper">
        <h3>PLACAR</h3><div class="sub"></div>
        <table><thead><tr><th>JOGADOR</th><th>ARMA</th><th>NÍVEL</th><th>$</th><th>ABATES</th><th>MORTES</th><th>PING</th></tr></thead><tbody></tbody></table>
      </div></div>`;
    const q = <T extends HTMLElement>(s: string) => r.querySelector(s) as T;
    this.xT = q('.xhair .t'); this.xB = q('.xhair .b'); this.xL = q('.xhair .l'); this.xR = q('.xhair .r');
    this.hitm = q('.hitm'); this.dmgWrap = q('.dmg-wrap');
    this.hpBox = q('.hp'); this.hpNum = q('.hp .num'); this.hpBar = q('.hp .bar b');
    this.ammoBox = q('.ammo'); this.wName = q('.ammo .wname'); this.ammoCur = q('.ammo .cur'); this.ammoMag = q('.ammo .mag'); this.relBar = q('.ammo .bar b');
    this.feed = q('.feed'); this.msgs = q('.msgs'); this.golacoEl = q('.golaco');
    this.death = q('.death'); this.deathBy = q('.death .by'); this.deathCd = q('.death .cd b');
    this.deathFace = q('.death .kface') as HTMLImageElement;
    this.endb = q('.endb'); this.endH = q('.endb h1'); this.endP = q('.endb p');
    this.armEl = q('.hp .arm');
    this.ctaEl = q('.shopcta'); this.ctaSub = q('.shopcta .d');
    this.cashEl = q('.money .cash'); this.goalEl = q('.money .goal'); this.leaderEl = q('.leader');
    this.chargeEl = q('.charge'); this.chargeBar = q('.charge b');
    this.spHint = q('.sphint'); this.spPips = q('.sppips'); this.spBar = q('.spbar b'); this.spTag = q('.sptag');
    this.fpsEl = q('.fps'); this.sbBody = q('.sb tbody'); this.sbDate = q('.sb .sub');
    this.dmgWrap.style.setProperty('--R', 'min(24vmin, 230px)');
    this.minimap = new Minimap(r);
    this.cheats = new CheatsHud(r);
    this.shop = new ShopHud(r);
    this.score = new ScorePopup(r);
  }

  private onResize(): void {
    this.vh = innerHeight;
    this.gap = -1;
    this.root.style.setProperty('--r', Math.round(Math.min(innerWidth, innerHeight) * 0.46) + 'px');
  }

  /* -------------------------------------------------------------- eventos */

  private listen(): void {
    bus.on('hit:confirm', (e) => {
      this.lastHit = { x: e.point.x, z: e.point.z, t: performance.now() };
      this.onHit(e.damage, e.headshot, e.killed);
    });
    bus.on('player:damage', (e) => {
      if (!e.fromDir) return;
      this.addDamageInd(e.fromDir.x, e.fromDir.z);
    });
    bus.on('kill', (e) => this.onKill(e));
    bus.on('shop:buy', (e) => {
      if (e.local) this.msg(`${shopName(e.item).toUpperCase()}!`, 'up');
    });
    bus.on('ladder:level', (e) => this.msg(`NÍVEL ${e.level + 1}/${e.total} → ${wInfo(e.weapon).name.toUpperCase()}`, 'up', undefined, wInfo(e.weapon).color !== null ? hex(wInfo(e.weapon).color!) : undefined));
    bus.on('shop:money', (e) => this.msg(`+$${e.delta}`, 'up', undefined, '#7dff8a'));
    bus.on('shop:deny', (e) => this.msg('SEM GRANA', 'down', `faltam $${e.missing}`));
    bus.on('match:end', (e) => {
      this.endb.classList.toggle('me', e.winnerIsLocal);
      this.endH.textContent = e.winnerIsLocal ? 'VITÓRIA' : `${e.winner.toUpperCase()} VENCEU`;
      this.endP.textContent = e.winnerIsLocal ? 'Você venceu a partida.' : 'Nova partida em instantes.';
      this.endb.classList.add('show');
    });
    bus.on('match:start', () => {
      this.endb.classList.remove('show');
      this.anyKill = false; this.streak = 0; this.lastKillerId = ''; this.lastHit = null;
      this.score.reset();
    });
    bus.on('special:pickup', (e) => {
      if (!e.local) return;
      const d = SPECIALS[e.kind];
      this.msg(`${d.name.toUpperCase()}!`, 'spk', undefined, hex(d.color));
    });
    bus.on('special:golaco', (e) => {
      const localId = (window as any).game?.local?.id ?? 'local';
      const kmh = Math.round((e.speed || 0) * 3.6);
      if (e.local) this.golaco('GOLAÇO!', kmh ? `${kmh} km/h` : '', true);
      else if (e.victimId === localId) this.golaco('TOMOU UM GOLAÇO', kmh ? `${kmh} km/h na cabeça` : '', false);
    });
    bus.on('player:death', () => { this.streak = 0; });
    bus.on('player:respawn', () => { this.msgs.textContent = ''; });
  }

  private onHit(dmg: number, hs: boolean, killed: boolean): void {
    const big = killed;
    this.hitm.style.color = killed ? '#ff3b30' : hs ? '#ffd23f' : '#fff';
    this.hitAnim?.cancel();
    const s0 = big ? 1.7 : 1.35, s1 = big ? 1.2 : 1;
    this.hitAnim = this.hitm.animate(
      [
        { opacity: 1, transform: `scale(${s0})` },
        { opacity: 1, transform: `scale(${s1})`, offset: 0.25 },
        { opacity: 0, transform: `scale(${s1 * 0.9})` },
      ],
      { duration: big ? 480 : 240, easing: 'ease-out' },
    );
    // dano flutuante
    if (this.root.querySelectorAll('.dnum').length > 8) return;
    const n = h('div', 'dnum' + (killed ? ' kill' : hs ? ' hs' : ''), String(Math.round(dmg)));
    const dx = (Math.random() - 0.5) * 70 + 28;
    this.root.appendChild(n);
    const a = n.animate(
      [
        { opacity: 1, transform: `translate(${dx}px,-10px) scale(1.4)` },
        { opacity: 1, transform: `translate(${dx}px,-34px) scale(1)`, offset: 0.2 },
        { opacity: 0, transform: `translate(${dx + 8}px,-80px) scale(0.9)` },
      ],
      { duration: 700, easing: 'ease-out' },
    );
    a.onfinish = () => n.remove();
  }

  private onKill(e: { killerId: string; victimId: string; killer: string; victim: string; weapon: WeaponId | SpecialId; headshot: boolean; localKiller: boolean; localVictim: boolean }): void {
    const def = wInfo(e.weapon);
    const row = h('div', 'row' + (e.localKiller || e.localVictim ? ' me' : ''));
    row.append(h('span', 'k', e.killer));
    if (e.headshot) row.append(h('span', 'hs', 'HS'));
    const w = h('span', 'w');
    if (def.color !== null) w.style.color = hex(def.color);
    w.innerHTML = `${icon(e.weapon).replace('<svg', '<svg style="width:2em;height:.8em;fill:currentColor;display:inline-block;vertical-align:middle;margin-right:.5em"')}`;
    w.append(def.short);
    row.append(w, h('span', 'v', e.victim));
    this.feed.appendChild(row);
    this.feedRows.push({ el: row, die: performance.now() + 5000 });
    while (this.feedRows.length > 5) this.feedRows.shift()!.el.remove();

    // pontos (só visual)
    const firstBlood = !this.anyKill;
    this.anyKill = true;
    if (e.localVictim) {
      this.lastKillerId = e.killerId === e.victimId ? '' : e.killerId;
      this.streak = 0;
    } else if (e.localKiller) {
      const now = performance.now();
      this.streak++;
      const rs: { pts: number; label: string }[] = [{ pts: 100, label: 'Abate' }];
      if (e.headshot) rs.push({ pts: 50, label: 'Headshot' });
      if (e.weapon === 'knife') rs.push({ pts: 50, label: 'Faca' });
      if (this.lastKillerId && e.victimId === this.lastKillerId) { rs.push({ pts: 50, label: 'Vingança' }); this.lastKillerId = ''; }
      const lh = this.lastHit;
      if (lh && now - lh.t < 1500 && Math.hypot(lh.x - this.px, lh.z - this.pz) > 35) rs.push({ pts: 25, label: 'Longa distância' });
      if (firstBlood) rs.push({ pts: 25, label: 'Primeiro sangue' });
      if (this.streak >= 2) rs.push({ pts: 25 * (this.streak - 1), label: `Sequência x${this.streak}` });
      this.lastHit = null;
      this.score.add(rs, now);
    }
  }

  /** Banner gigante de gol: rotação/escala exageradas, raios e confete. */
  private golaco(text: string, sub: string, mine: boolean): void {
    const el = this.golacoEl;
    el.textContent = '';
    el.className = 'golaco ' + (mine ? 'mine' : 'victim');
    el.append(h('div', 'rays'), h('div', 'gtxt', text));
    if (sub) el.append(h('div', 'gsub', sub));
    const txt = el.querySelector('.gtxt') as HTMLElement;
    txt.animate(
      [
        { transform: 'scale(0.1) rotate(-25deg)', opacity: 0 },
        { transform: 'scale(1.7) rotate(6deg)', opacity: 1, offset: 0.14 },
        { transform: 'scale(0.9) rotate(-3deg)', offset: 0.26 },
        { transform: 'scale(1.12) rotate(2deg)', offset: 0.4 },
        { transform: 'scale(1) rotate(-1deg)', offset: 0.55 },
        { transform: 'scale(1.06) rotate(1deg)', opacity: 1, offset: 0.85 },
        { transform: 'scale(1.5) rotate(0deg)', opacity: 0 },
      ],
      { duration: mine ? 2600 : 2200, easing: 'ease-out' },
    );
    const rays = el.querySelector('.rays') as HTMLElement;
    rays.animate(
      [{ transform: 'rotate(0deg) scale(0.3)', opacity: 0 }, { opacity: 0.9, offset: 0.15 }, { opacity: 0.8, offset: 0.8 }, { transform: 'rotate(120deg) scale(1.2)', opacity: 0 }],
      { duration: 2600, easing: 'linear' },
    );
    if (mine) {
      for (let i = 0; i < 26; i++) {
        const c = h('i', 'conf');
        c.style.background = i % 2 ? '#2fd45a' : '#ffd23f';
        el.appendChild(c);
        const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 260;
        const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.7;
        c.animate(
          [
            { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
            { transform: `translate(${x}px,${y}px) rotate(${Math.random() * 720 - 360}deg) scale(1)`, opacity: 1, offset: 0.6 },
            { transform: `translate(${x * 1.05}px,${y + 90}px) rotate(${Math.random() * 720}deg) scale(.6)`, opacity: 0 },
          ],
          { duration: 1500 + Math.random() * 800, easing: 'cubic-bezier(.1,.7,.3,1)', delay: Math.random() * 150 },
        );
      }
    }
    clearTimeout(this.golacoT);
    this.golacoT = window.setTimeout(() => { el.className = 'golaco'; el.textContent = ''; }, 2800);
  }
  private golacoT = 0;

  private msg(text: string, kind: string, sub?: string, color?: string): void {
    while (this.msgs.children.length >= 3) this.msgs.firstElementChild!.remove();
    const m = h('div', `msg ${kind}`, text);
    if (color) m.style.color = color;
    if (sub) m.append(h('small', '', sub));
    this.msgs.appendChild(m);
    const long = kind === 'up' || kind === 'down' || kind === 'spk';
    const dur = long ? 2400 : 1500;
    const a = m.animate(
      [
        { opacity: 0, transform: 'scale(2.2) rotate(-5deg)' },
        { opacity: 1, transform: 'scale(1) rotate(-2deg)', offset: 0.12 },
        { opacity: 1, transform: 'scale(1) rotate(-2deg)', offset: 0.78 },
        { opacity: 0, transform: 'translateY(-24px) scale(0.95) rotate(-2deg)' },
      ],
      { duration: dur, easing: 'ease-out' },
    );
    a.onfinish = () => m.remove();
  }

  private addDamageInd(dx: number, dz: number): void {
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    dx /= len; dz /= len;
    const yaw = this.yaw();
    const ang = this.relAngle(dx, dz, yaw);
    let ind = this.dmgInds.find((i) => Math.abs(angDiff(i.angle, ang)) < 0.35);
    if (!ind) {
      if (this.dmgInds.length >= 5) { this.dmgInds.shift()!.el.remove(); }
      const el = h('div', 'dmg-arc');
      this.dmgWrap.appendChild(el);
      ind = { el, dx, dz, born: 0, angle: ang };
      this.dmgInds.push(ind);
    }
    ind.dx = dx; ind.dz = dz; ind.born = performance.now();
  }

  private yaw(): number {
    return (window as any).game?.player?.yaw ?? 0;
  }

  /** Ângulo (rad, horário a partir do topo) da direção mundo XZ relativa ao jogador. */
  private relAngle(dx: number, dz: number, yaw: number): number {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
  }

  /* -------------------------------------------------------------- update */

  update(s: HudState, dt: number): void {
    const p = this.p;
    const root = this.root;
    this.nowMs = performance.now();
    this.px = s.posX; this.pz = s.posZ;
    this.score.update(this.nowMs);

    // fps
    if (s.fps !== p.fps) { p.fps = s.fps; this.fpsEl.textContent = `${s.fps} fps`; }

    // modo
    if (s.mode !== p.mode) { p.mode = s.mode; root.classList.toggle('treino', s.mode === 'treino'); }

    // arma
    const melee = !!s.weapon.melee;
    if (s.weapon.id !== p.wid) {
      p.wid = s.weapon.id;
      this.wName.textContent = s.weapon.name;
      this.ammoMag.textContent = melee ? '' : s.special && s.special.unit === 'sec' ? `/${s.special.maxAmmo}s` : '/' + s.weapon.mag;
      root.classList.toggle('melee', melee);
      p.ammo = -2;
    }
    if (s.ammo !== p.ammo) {
      p.ammo = s.ammo;
      this.ammoCur.textContent = String(s.ammo);
      const empty = !melee && s.ammo === 0;
      const lowA = !melee && s.ammo > 0 && s.ammo <= Math.ceil(s.weapon.mag * 0.25);
      this.ammoBox.classList.toggle('empty', empty);
      this.ammoBox.classList.toggle('lowa', lowA);
    }
    if (s.reloading !== p.rel) {
      p.rel = s.reloading;
      this.ammoBox.classList.toggle('reloading', s.reloading);
      if (!s.reloading) { p.relP = -1; this.relBar.style.transform = 'scaleX(0)'; }
    }
    if (s.reloading) {
      const rp = Math.round(s.reloadProgress * 50) / 50;
      if (rp !== p.relP) { p.relP = rp; this.relBar.style.transform = `scaleX(${rp})`; }
    }
    if (s.switching !== p.sw) { p.sw = s.switching; this.ammoBox.classList.toggle('switching', s.switching); }

    this.updateSpecial(s);

    // vida
    const hp = Math.max(0, Math.ceil(s.health));
    if (hp !== p.hp) {
      p.hp = hp;
      this.hpNum.textContent = String(hp);
      this.hpBar.style.transform = `scaleX(${Math.min(1, hp / MAX_HP)})`;
      const low = hp <= MAX_HP * 0.3 && hp > 0;
      this.hpBox.classList.toggle('low', low);
      this.hpBox.classList.toggle('mid', hp > MAX_HP * 0.3 && hp <= MAX_HP * 0.6);
      root.classList.toggle('low', low);
    }

    // zoom
    if (s.zoomed !== p.zoomed) { p.zoomed = s.zoomed; root.classList.toggle('zoomed', s.zoomed); }

    // mira some no ADS (a faca não tem ADS); minimapa/radar
    const ads = !melee && s.ads > 0.5;
    if (ads !== this.adsOn) { this.adsOn = ads; root.classList.toggle('ads', ads); }
    this.minimap.update(s, this.nowMs);
    this.cheats.update(s.cheats);

    // mira dinâmica
    if (!melee && !s.zoomed && !s.dead) {
      const fovRad = (s.fov * Math.PI) / 360;
      let gap = (Math.tan(s.spread) / Math.tan(fovRad)) * (this.vh / 2);
      gap = Math.min(160, Math.max(3, Math.round(gap * 2) / 2));
      if (gap !== this.gap) {
        this.gap = gap;
        this.xT.style.transform = `translateY(${-gap - 9}px)`;
        this.xB.style.transform = `translateY(${gap}px)`;
        this.xL.style.transform = `translateX(${-gap - 9}px)`;
        this.xR.style.transform = `translateX(${gap}px)`;
      }
    }

    // gun game
    this.updateMoney(s);
    this.shop.update(s.shop, s.money);

    // morte
    if (s.dead !== p.dead) {
      p.dead = s.dead;
      root.classList.toggle('dead', s.dead);
      if (s.dead) {
        this.deathBy.textContent = s.killerName ? `morto por ${s.killerName}` : '';
        // Foto de quem te matou (se ele subiu uma)
        if (s.killerFace) {
          this.deathFace.src = s.killerFace;
          this.deathFace.style.display = '';
        } else {
          this.deathFace.removeAttribute('src');
          this.deathFace.style.display = 'none';
        }
        p.cd = '';
      }
    }
    if (s.dead) {
      const cd = s.respawnIn.toFixed(1);
      if (cd !== p.cd) { p.cd = cd; this.deathCd.textContent = cd; }
    }

    // placar
    if (s.showScoreboard !== p.sbShow) {
      p.sbShow = s.showScoreboard;
      root.classList.toggle('sbshow', s.showScoreboard);
      p.sb = '';
    }
    if (s.showScoreboard) this.updateScoreboard(s);

    // indicadores de dano
    if (this.dmgInds.length) this.tickDamage();

    // kill feed
    if (this.feedRows.length) {
      const now = this.nowMs;
      while (this.feedRows.length && this.feedRows[0].die <= now) {
        const r = this.feedRows.shift()!;
        r.el.classList.add('out');
        setTimeout(() => r.el.remove(), 380);
      }
    }
    void dt;
  }

  private updateSpecial(s: HudState): void {
    const p = this.p;
    const sp = s.special;
    const sid = sp ? sp.id : '';
    if (sid !== p.sid) {
      p.sid = sid; p.sammo = -1;
      this.root.classList.toggle('special', !!sp);
      this.root.classList.toggle('spsec', !!sp && sp.unit === 'sec');
      this.root.classList.toggle('spshot', !!sp && sp.unit === 'shot');
      if (sp) {
        const c = hex(sp.color);
        this.ammoBox.style.setProperty('--sp', c);
        this.spHint.style.setProperty('--sp', c);
        this.spTag.style.setProperty('--sp', c);
        this.wName.style.color = c;
        this.spTag.innerHTML = `${icon(sp.id)}<span>+ ESPECIAL: ${sp.short}</span>`;
        this.spPips.textContent = '';
        if (sp.unit === 'shot') for (let i = 0; i < Math.min(12, sp.maxAmmo); i++) this.spPips.append(h('i'));
        this.spHint.textContent = sp.hint;
        this.hintAnim?.cancel();
        this.hintAnim = this.spHint.animate(
          [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none', offset: 0.06 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
          { duration: 5000, fill: 'both' },
        );
      } else {
        this.wName.style.color = '';
        this.ammoBox.style.removeProperty('--sp');
        this.spPips.textContent = '';
        this.hintAnim?.cancel();
        this.hintAnim = null;
        this.spHint.style.opacity = '0';
      }
    }
    const act = !!sp && sp.active;
    if (act !== p.sact) { p.sact = act; this.ammoBox.classList.toggle('active', act); }
    if (sp) {
      if (sp.ammo !== p.sammo) {
        p.sammo = sp.ammo;
        if (sp.unit === 'sec') this.spBar.style.transform = `scaleX(${Math.max(0, Math.min(1, sp.ammo / sp.maxAmmo))})`;
        else {
          const kids = this.spPips.children;
          for (let i = 0; i < kids.length; i++) (kids[i] as HTMLElement).className = i < sp.ammo ? 'on' : '';
        }
      }
    }
    // estilingue: barra de carga perto da mira
    const ch = Math.round(Math.max(0, Math.min(1, s.charge)) * 50) / 50;
    if (ch !== p.charge) {
      const was = p.charge > 0;
      p.charge = ch;
      this.chargeBar.style.transform = `scaleX(${ch})`;
      if ((ch > 0) !== was) this.chargeEl.classList.toggle('on', ch > 0);
      this.chargeEl.classList.toggle('full', ch >= 0.95);
    }
  }

  private tickDamage(): void {
    const yaw = this.yaw();
    const now = this.nowMs;
    for (let i = this.dmgInds.length - 1; i >= 0; i--) {
      const d = this.dmgInds[i];
      const age = (now - d.born) / 1000;
      if (age > 2) { d.el.remove(); this.dmgInds.splice(i, 1); continue; }
      const ang = this.relAngle(d.dx, d.dz, yaw);
      d.angle = ang;
      d.el.style.transform = `rotate(${ang.toFixed(3)}rad)`;
      d.el.style.opacity = String(Math.min(1, (2 - age) * 0.9).toFixed(2));
    }
  }

  private updateMoney(s: HudState): void {
    const p = this.p;
    if (s.mode === 'treino') return;
    if (s.money !== p.cash) {
      p.cash = s.money; this.cashEl.textContent = '$' + s.money;
      this.ctaSub.textContent = '$' + s.money;
      // pulsa forte quando já dá pra comprar alguma coisa
      this.ctaEl.classList.toggle('can', s.money >= PRICE.pistol);
    }
    this.ctaEl.classList.toggle('off', s.shop.open);
    const last = s.ladder.length - 1;
    const next = s.level < last ? ` → ${wInfo(s.ladder[s.level + 1]).short}` : ' · ÚLTIMA!';
    const goal = `NÍVEL ${s.level + 1}/${s.ladder.length}${next}`;
    if (s.armor !== p.armor) { p.armor = s.armor; this.armEl.textContent = s.armor > 0 ? `COLETE ${Math.ceil(s.armor)}` : ''; }
    if (goal !== p.goal) { p.goal = goal; this.goalEl.textContent = goal; }
    const lk = s.leader ? `${s.leader.name}|${s.leader.level}|${s.leader.isLocal}` : '';
    if (lk !== p.leader) {
      p.leader = lk;
      this.leaderEl.classList.toggle('me', !!s.leader?.isLocal);
      this.leaderEl.textContent = !s.leader ? '' : s.leader.isLocal ? 'VOCÊ LIDERA' : `LÍDER: ${s.leader.name} (nível ${s.leader.level + 1})`;
    }
  }

  private updateScoreboard(s: HudState): void {
    const sig = s.scoreboard.map((r) => `${r.id}|${r.name}|${r.weapon}|${r.level}|${r.money}|${r.kills}|${r.deaths}|${r.ping}|${r.alive ? 1 : 0}`).join(';');
    if (sig === this.p.sb) return;
    this.p.sb = sig;
    this.sbDate.textContent = s.mode === 'gungame' ? `Escada de ${s.ladder.length} armas + loja` : 'Treino';
    const body = this.sbBody;
    body.textContent = '';
    for (const r of s.scoreboard as ScoreRow[]) {
      const tr = document.createElement('tr');
      if (r.isLocal) tr.className = 'me';
      else if (!r.alive) tr.className = 'dead';
      const nm = h('td', 'nm');
      const sw = h('span', 'sw'); sw.style.background = hex(r.color);
      nm.append(sw, document.createTextNode(r.name));
      if (r.isBot) nm.append(h('span', 'bot', '[BOT]'));
      tr.append(
        nm,
        h('td', 'wp', wInfo(r.weapon).short),
        h('td', '', String(r.level + 1)),
        h('td', '', '$' + r.money),
        h('td', '', String(r.kills)),
        h('td', '', String(r.deaths)),
        h('td', '', r.isBot || r.isLocal && r.ping <= 0 ? '—' : `${Math.round(r.ping)}ms`),
      );
      body.appendChild(tr);
    }
  }
}

function angDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}
