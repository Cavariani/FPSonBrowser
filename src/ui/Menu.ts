import './menu.css';
import { saveSettings, settings } from '../core/Settings';
import type { Settings } from '../core/Settings';
import { ACTOR_COLORS } from '../game/Actor';
import { FacePicker } from './FacePicker';
import { FacePreview } from './FacePreview';
import type { LobbyInfo, MenuCallbacks } from './types';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

type NumKey = 'sensitivity' | 'fov' | 'volume' | 'pixelSize' | 'botCount' | 'botDifficulty';

interface SettingsPanel {
  el: HTMLElement;
  sync(): void;
  setHost(v: boolean): void;
}

const PIXEL_TXT = ['', 'NÍTIDO', 'LEVE', 'RETRÔ', 'BEM RETRÔ'];

function buildSettings(): SettingsPanel {
  const el = h('div', 'set');
  const syncs: (() => void)[] = [];

  const slider = (parent: HTMLElement, key: NumKey, label: string, min: number, max: number, step: number, o: { scale?: number; text?: (v: number) => string } = {}) => {
    const scale = o.scale ?? 1;
    const row = h('div', 'srow');
    const lab = h('label', '', label);
    const r = h('input'); r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
    row.append(lab, r);
    let num: HTMLInputElement | null = null;
    let txt: HTMLElement | null = null;
    if (o.text) { txt = h('div', 'txt'); row.append(txt); }
    else {
      num = h('input', 'val'); num.type = 'number'; num.min = String(min * scale); num.max = String(max * scale); num.step = String(step * scale);
      row.append(num);
    }
    const apply = (v: number) => {
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      v = Math.round(v * 1000) / 1000;
      saveSettings({ [key]: v } as Partial<Settings>);
      sync();
    };
    const sync = () => {
      const v = settings[key] as number;
      r.value = String(v);
      if (num && document.activeElement !== num) num.value = String(Math.round(v * scale * 100) / 100);
      if (txt && o.text) txt.textContent = o.text(v);
    };
    r.addEventListener('input', () => apply(parseFloat(r.value)));
    num?.addEventListener('change', () => { const v = parseFloat(num!.value); if (isFinite(v)) apply(v / scale); else sync(); });
    num?.addEventListener('blur', sync);
    syncs.push(sync);
    parent.appendChild(row);
    return row;
  };

  slider(el, 'sensitivity', 'Sensibilidade', 0.3, 8, 0.05);
  slider(el, 'fov', 'Campo de visão', 60, 110, 1);
  slider(el, 'volume', 'Volume', 0, 1, 0.01, { scale: 100 });
  slider(el, 'pixelSize', 'Pixelização', 1, 4, 1, { text: (v) => `${v} · ${PIXEL_TXT[v] ?? ''}` });

  const inv = h('label', 'chk');
  const invI = h('input'); invI.type = 'checkbox';
  inv.append(invI, document.createTextNode('Inverter eixo Y (mouse)'));
  invI.addEventListener('change', () => saveSettings({ invertY: invI.checked }));
  syncs.push(() => { invI.checked = settings.invertY; });
  el.appendChild(inv);

  const host = h('div', 'hostonly');
  host.append(h('span', 'lbl', 'REGRAS DA PARTIDA (SÓ O ANFITRIÃO)'));
  slider(host, 'botCount', 'Qtd. de bots', 0, 10, 1);
  slider(host, 'botDifficulty', 'Dificuldade', 0, 1, 0.05, { scale: 100 });
  const modeRow = h('div', 'srow');
  modeRow.append(h('label', '', 'Modo'));
  const seg = h('div', 'seg');
  const modes: [Settings['mode'], string][] = [['gungame', 'GUN GAME'], ['treino', 'TREINO']];
  const segBtns = modes.map(([m, t]) => {
    const b = h('button', '', t); b.type = 'button';
    b.addEventListener('click', () => { saveSettings({ mode: m }); sync(); });
    seg.appendChild(b);
    return b;
  });
  modeRow.append(seg, h('div'));
  host.appendChild(modeRow);
  host.append(h('div', 'hint', 'Bots, dificuldade e modo valem para a partida em andamento ou a próxima.'));
  el.appendChild(host);
  const sync = () => {
    segBtns.forEach((b, i) => b.classList.toggle('on', settings.mode === modes[i][0]));
    for (const s of syncs) s();
  };
  syncs.push(() => segBtns.forEach((b, i) => b.classList.toggle('on', settings.mode === modes[i][0])));

  return { el, sync, setHost: (v) => { host.style.display = v ? '' : 'none'; } };
}

function controlsList(): HTMLElement {
  const wrap = h('div', 'keys');
  const items: [string, string][] = [
    ['W A S D', 'Andar'], ['ESPAÇO', 'Pular'], ['CTRL / C', 'Agachar'], ['SHIFT', 'Andar devagar'],
    ['R', 'Recarregar'], ['MOUSE ESQ.', 'Atirar'], ['MOUSE DIR.', 'Zoom / golpe forte'], ['TAB', 'Placar'],
    ['1 - 6', 'Trocar arma (treino)'], ['ESC', 'Pausar'],
  ];
  for (const [k, d] of items) {
    const row = h('div');
    row.append(h('kbd', '', k), h('span', '', d));
    wrap.appendChild(row);
  }
  return wrap;
}

function card(title: string, ...kids: (HTMLElement | null)[]): HTMLElement {
  const c = h('div', 'card');
  const inn = h('div', 'in');
  inn.append(h('h2', '', title));
  for (const k of kids) if (k) inn.appendChild(k);
  c.appendChild(inn);
  return c;
}

/** Painel de sala reutilizável (código, copiar link, lista de jogadores). */
class RoomPanel {
  el = h('div', 'room');
  private codeEl = h('div', 'code');
  private copyBtn = h('button', 'btn small ghost', 'COPIAR LINK');
  private list = h('div', 'plist');
  private extra = h('div');
  private code = '';
  private timer = 0;

  constructor() {
    const head = h('div', 'rhead');
    const left = h('div');
    left.append(h('span', 'lbl', 'CÓDIGO DA SALA'), this.codeEl);
    this.copyBtn.type = 'button';
    this.copyBtn.addEventListener('click', () => this.copy());
    head.append(left, this.copyBtn);
    this.el.append(head, this.list, this.extra);
  }

  get extraSlot(): HTMLElement { return this.extra; }

  show(code: string | null, players: LobbyInfo['players']): void {
    this.code = code ?? '';
    this.el.classList.toggle('show', !!code);
    if (!code) return;
    this.codeEl.textContent = code;
    this.list.textContent = '';
    for (const p of players) {
      const row = h('div', 'p' + (p.isLocal ? ' me' : ''));
      row.append(h('span', 'n', p.name || '???'));
      if (p.isHost) row.append(h('span', 'tg', 'ANFITRIÃO'));
      if (p.isLocal) row.append(h('span', 'tg', 'VOCÊ'));
      row.append(h('span', 'pg', p.isLocal ? '' : `${Math.round(p.ping)}ms`));
      this.list.appendChild(row);
    }
  }

  private async copy(): Promise<void> {
    if (!this.code) return;
    const link = location.origin + location.pathname + '#' + this.code;
    let ok = false;
    try { await navigator.clipboard.writeText(link); ok = true; } catch { /* fallback */ }
    if (!ok) {
      try {
        const t = document.createElement('textarea');
        t.value = link; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
        ok = document.execCommand('copy'); t.remove();
      } catch { /* ignora */ }
    }
    this.copyBtn.textContent = ok ? 'COPIADO!' : 'COPIE: ' + link;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.copyBtn.textContent = 'COPIAR LINK'; }, ok ? 1600 : 6000);
  }
}

/** Menu principal / pausa. */
export class Menu {
  private el: HTMLDivElement;
  private state: 'main' | 'pause' | 'hidden' = 'hidden';
  private lobby: LobbyInfo | null = null;

  // principal
  private nameIn!: HTMLInputElement;
  private btnOff!: HTMLButtonElement; private btnCreate!: HTMLButtonElement; private btnJoin!: HTMLButtonElement;
  private codeIn!: HTMLInputElement;
  private status!: HTMLElement;
  private mainRoom = new RoomPanel();
  private mainEnter!: HTMLButtonElement;
  private busy = false;
  private mainSettings = buildSettings();
  private facePicker = new FacePicker();
  private facePreview = new FacePreview(ACTOR_COLORS[0]);
  private inRoom = false;

  // pausa
  private pauseRoom = new RoomPanel();
  private pauseStatus!: HTMLElement;
  private pauseSettings = buildSettings();
  private btnLeave!: HTMLButtonElement;

  constructor(root: HTMLElement, private cb: MenuCallbacks) {
    this.el = h('div', 'menu');
    this.el.innerHTML = '<div class="m-bg"></div>';
    const wrap = h('div', 'wrap');
    wrap.append(this.buildMain(), this.buildPause());
    this.el.appendChild(wrap);
    root.appendChild(this.el);
    addEventListener('hashchange', () => this.applyHash());
    this.applyHash();
  }

  /* -------------------------------------------------------------- build */

  private buildMain(): HTMLElement {
    const sec = h('section', 'm-main');

    const hero = h('div', 'hero');
    const tb = h('div', 'titlebox');
    tb.innerHTML = '<h1>CLT<span>fps</span>.html</h1><div class="sub">Tiroteio multiplayer no navegador</div>';
    hero.appendChild(tb);
    sec.appendChild(hero);

    // nome
    const nameBox = h('div');
    nameBox.append(h('span', 'lbl', 'NOME'));
    this.nameIn = h('input'); this.nameIn.type = 'text'; this.nameIn.maxLength = 16;
    this.nameIn.placeholder = 'Seu nome'; this.nameIn.spellcheck = false; this.nameIn.autocomplete = 'off';
    this.nameIn.value = settings.name;
    this.nameIn.addEventListener('input', () => saveSettings({ name: this.nameIn.value.trim() }));
    nameBox.appendChild(this.nameIn);

    // offline
    this.btnOff = h('button', 'btn primary', 'JOGAR OFFLINE'); this.btnOff.type = 'button';
    this.btnOff.addEventListener('click', () => { saveSettings({ name: this.nameIn.value.trim() }); this.cb.playOffline(); });

    // multiplayer
    this.btnCreate = h('button', 'btn', 'CRIAR SALA'); this.btnCreate.type = 'button';
    this.btnCreate.addEventListener('click', () => this.create());
    this.codeIn = h('input', 'code-in'); this.codeIn.type = 'text'; this.codeIn.placeholder = 'Código da sala'; this.codeIn.autocomplete = 'off'; this.codeIn.spellcheck = false;
    this.codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join(); });
    this.btnJoin = h('button', 'btn green', 'ENTRAR'); this.btnJoin.type = 'button';
    this.btnJoin.addEventListener('click', () => this.join());
    const joinRow = h('div', 'row'); joinRow.append(this.codeIn, this.btnJoin);
    this.status = h('div', 'stat');

    this.mainEnter = h('button', 'btn primary', 'CONTINUAR'); this.mainEnter.type = 'button';
    this.mainEnter.addEventListener('click', () => this.cb.resume());
    this.mainRoom.extraSlot.appendChild(this.mainEnter);

    const sep = h('div', 'sep', 'MULTIPLAYER');
    const main = card('JOGAR', nameBox, this.btnOff, sep, this.btnCreate, joinRow, this.status, this.mainRoom.el);

    // preview 3D do boneco + foto
    const stage = h('div', 'face-stage');
    stage.appendChild(this.facePreview.canvas);
    const faceCard = card('SEU BONECO', stage, this.facePicker.el);
    faceCard.classList.add('face-card');
    faceCard.addEventListener('facedrag', (e) => faceCard.classList.toggle('drag', !!(e as CustomEvent<boolean>).detail));
    this.facePicker.setFace(settings.face);
    this.facePreview.setFace(settings.face);
    this.facePicker.onChange = (face) => { saveSettings({ face }); this.facePreview.setFace(face); };
    const duo = h('div', 'duo');
    duo.append(main, faceCard);
    sec.appendChild(duo);

    // config + controles
    this.mainSettings.setHost(true);
    sec.appendChild(card('CONFIGURAÇÕES', this.mainSettings.el));
    sec.appendChild(card('CONTROLES', controlsList()));
    return sec;
  }

  private buildPause(): HTMLElement {
    const sec = h('section', 'm-pause');
    const t = h('div', 'ptitle');
    t.innerHTML = '<h1>PAUSADO</h1>';
    sec.appendChild(t);

    const back = h('button', 'btn primary', 'CONTINUAR'); back.type = 'button';
    back.addEventListener('click', () => this.cb.resume()); // gesto do usuário -> pointer lock no callback
    this.pauseStatus = h('div', 'stat');
    sec.appendChild(card('PARTIDA', back, this.pauseStatus, this.pauseRoom.el));

    sec.appendChild(card('CONFIGURAÇÕES', this.pauseSettings.el));
    sec.appendChild(card('CONTROLES', controlsList()));

    this.btnLeave = h('button', 'btn danger', 'SAIR DA SALA'); this.btnLeave.type = 'button';
    this.btnLeave.addEventListener('click', () => this.cb.leave());
    sec.appendChild(this.btnLeave);
    return sec;
  }

  /* -------------------------------------------------------------- ações */

  private setBusy(b: boolean): void {
    this.busy = b;
    this.btnCreate.disabled = b; this.btnJoin.disabled = b; this.btnOff.disabled = b;
    this.updateFaceLock();
  }

  /** A foto vai no hello/join: trava a troca enquanto conecta ou já está numa sala. */
  private updateFaceLock(): void {
    const lock = this.busy || this.inRoom;
    this.facePicker.setLocked(lock, 'Saia da sala para trocar a foto.');
  }

  private setStatus(text: string, kind: '' | 'err' | 'ok' = ''): void {
    this.status.textContent = text;
    this.status.className = 'stat' + (kind ? ' ' + kind : '');
  }

  private async create(): Promise<void> {
    if (this.busy) return;
    saveSettings({ name: this.nameIn.value.trim() });
    this.setBusy(true);
    this.mainRoom.show(null, []);
    this.setStatus('Conectando…');
    try {
      const code = await this.cb.createRoom();
      this.setStatus('Sala criada! Envie o link para os amigos.', 'ok');
      this.mainRoom.show(code, this.lobby?.players ?? [{ name: settings.name || 'Você', ping: 0, isHost: true, isLocal: true }]);
    } catch (e) {
      this.setStatus(errMsg(e), 'err');
    } finally {
      this.setBusy(false);
    }
  }

  private async join(): Promise<void> {
    if (this.busy) return;
    const code = this.codeIn.value.trim().replace(/^#/, '');
    if (!code) { this.setStatus('Digite o código da sala.', 'err'); this.codeIn.focus(); return; }
    saveSettings({ name: this.nameIn.value.trim() });
    this.setBusy(true);
    this.mainRoom.show(null, []);
    this.setStatus('Entrando na sala…');
    try {
      await this.cb.joinRoom(code);
      this.setStatus('Conectado!', 'ok');
      this.mainRoom.show(code, this.lobby?.players ?? []);
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      this.setStatus(errMsg(e), 'err');
    } finally {
      this.setBusy(false);
    }
  }

  private applyHash(): void {
    const code = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
    if (!code) { this.btnJoin?.classList.remove('hl'); return; }
    this.codeIn.value = code;
    this.btnJoin.classList.add('hl');
  }

  /* -------------------------------------------------------------- API pública */

  showMain(): void {
    this.state = 'main';
    this.el.className = 'menu on main';
    this.nameIn.value = settings.name;
    this.mainSettings.sync();
    this.facePicker.setFace(settings.face);
    this.facePreview.setFace(settings.face);
    this.facePreview.start();
    this.mainRoom.show(null, []);
    this.setStatus('');
    this.inRoom = false;
    this.setBusy(false);
    this.applyHash();
    this.el.scrollTop = 0;
  }

  showPause(lobby: LobbyInfo): void {
    this.state = 'pause';
    this.facePreview.stop();
    this.el.className = 'menu on pause';
    this.pauseSettings.sync();
    this.setLobby(lobby);
    this.el.scrollTop = 0;
  }

  setLobby(lobby: LobbyInfo): void {
    this.lobby = lobby;
    if (this.state === 'pause') {
      this.pauseSettings.setHost(lobby.isHost || lobby.status === 'offline');
      this.pauseRoom.show(lobby.code, lobby.players);
      this.pauseRoom.el.classList.toggle('show', !!lobby.code);
      const msg =
        lobby.status === 'offline' ? 'Modo offline.'
        : lobby.status === 'connecting' ? 'Conectando…'
        : lobby.status === 'error' ? (lobby.error ?? 'Erro de conexão.')
        : lobby.isHost ? 'Você é o anfitrião da sala.' : 'Conectado à sala.';
      this.pauseStatus.textContent = msg;
      this.pauseStatus.className = 'stat' + (lobby.status === 'error' ? ' err' : lobby.status === 'connected' ? ' ok' : '');
      this.btnLeave.textContent = lobby.status === 'offline' ? 'SAIR DA PARTIDA' : 'SAIR DA SALA';
    } else if (this.state === 'main') {
      this.inRoom = lobby.status === 'connected' || lobby.status === 'connecting';
      this.updateFaceLock();
      if (lobby.status === 'connected' && lobby.code) this.mainRoom.show(lobby.code, lobby.players);
      else if (lobby.status === 'error' && lobby.error) this.setStatus(lobby.error, 'err');
    }
  }

  hide(): void {
    this.state = 'hidden';
    this.facePreview.stop();
    this.el.className = 'menu';
  }
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m || 'Algo deu errado.';
}
