import { Peer, type DataConnection } from 'peerjs';
import { Vector3 } from 'three';
import { bus, type GameEvents } from '../core/events';
import { settings } from '../core/Settings';
import { ACTOR_COLORS, type Actor } from '../game/Actor';
import type { DamageRequest, MatchEvent } from '../game/Match';
import type { Game } from '../game/Game';
import type { ShopItemId } from '../game/shop';
import { SPECIALS, type SpecialId } from '../game/special/defs';
import type { SpecialMsg } from '../game/special/msgs';
import type { LobbyInfo } from '../ui/types';
import { ICE_SERVERS } from './ice';
import {
  C2H_SIZE, CODE_LEN, F_CROUCH, F_GROUND, H2C_ENTRY, H2C_HEADER, MAX_ACTORS, ROOM_PREFIX, T_C2H, T_H2C,
  dPitch, dSpeed, dYaw, flagWeapon, genCode, normalizeCode, packFlags, qPitch, qSpeed, qYaw, r2, validFace,
  type ActorInfo, type FireMsg, type MeleeMsg, type Mode, type Msg,
} from './protocol';
import type { NetLink } from './types';

export const HOST_ID = 'host';
const MAX_HUMANS = 8;
const TIMEOUT_MS = 10_000;
const HOST_SNAP_MS = 50; // 20 Hz
const CLIENT_SNAP_MS = 33; // 30 Hz
const PING_MS = 2000;

/** Erro com mensagem já amigável (em português) para mostrar no menu. */
export class NetError extends Error {
  constructor(msg: string, readonly retry = false) {
    super(msg);
  }
}

/** Estado de um cliente conectado (visão do host). */
interface ClientPeer {
  conn: DataConnection;
  unrel: RTCDataChannel | null;
  actorId: string | null;
  ready: boolean; // welcome já enviado
  lastSeen: number;
  epoch: number;
  seqInit: boolean;
  lastSeq: number;
  rtt: number;
  // último snapshot bruto recebido (repassado sem passar pela interpolação do host)
  rawValid: boolean;
  rx: number; ry: number; rz: number; ryaw: number; rpitch: number; rspeed: number; rflags: number;
}

function friendlyPeerError(err: any): NetError {
  const t = err?.type as string | undefined;
  switch (t) {
    case 'unavailable-id':
      return new NetError('Código de sala já em uso.', true);
    case 'peer-unavailable':
      return new NetError('Sala não encontrada. Confira o código.');
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return new NetError('Servidor de salas indisponível. Verifique sua internet e tente de novo.');
    case 'browser-incompatible':
      return new NetError('Seu navegador não suporta WebRTC.');
    case 'webrtc':
    case 'disconnected':
      return new NetError('Não foi possível conectar (rede bloqueando P2P?)');
    default:
      return new NetError('Não foi possível conectar (rede bloqueando P2P?)');
  }
}

/** Abre um Peer no broker (PeerJS Cloud). Rejeita com NetError. */
function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const opts = { config: { iceServers: ICE_SERVERS }, debug: 1 };
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    const timer = setTimeout(() => {
      peer.destroy();
      reject(new NetError('Servidor de salas não respondeu (10s). Tente de novo.'));
    }, 10_000);
    peer.once('open', () => {
      clearTimeout(timer);
      peer.off('error', onErr);
      resolve(peer);
    });
    const onErr = (err: any) => {
      clearTimeout(timer);
      peer.destroy();
      reject(friendlyPeerError(err));
    };
    peer.on('error', onErr);
  });
}

export class Net implements NetLink {
  readonly isHost: boolean;
  localId: string;
  readonly code: string;
  status: LobbyInfo['status'] = 'connecting';
  errorMsg: string | undefined;

  /** Alguém entrou/saiu/ping mudou: atualizar o lobby da UI. */
  onLobbyChange: (() => void) | null = null;
  /** Conexão caiu (cliente) — a UI deve voltar ao menu. */
  onDisconnect: ((msg: string) => void) | null = null;

  private game: Game | null = null;
  private closed = false;
  private _mode: Mode = 'gungame';
  private lastModeSent: Mode = 'gungame';
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubs: (() => void)[] = [];
  private inbox: { p: ClientPeer | null; m: Msg }[] = [];
  private emitting = false;
  private impacts: GameEvents['weapon:impact'][] = [];
  private nextSnapAt = 0;
  private nextPingAt = 0;
  private seq = 0;

  // numeração de rede (índice u8 de cada actor nos snapshots binários)
  private nums = new Map<string, number>();
  private numToId: (string | undefined)[] = new Array(256);
  private nextNum = 1;

  // host
  private clients = new Map<string, ClientPeer>(); // por peer id do broker
  private byActor = new Map<string, ClientPeer>();
  private nextClientN = 1;
  private out = new ArrayBuffer(H2C_HEADER + MAX_ACTORS * H2C_ENTRY);
  private outDv = new DataView(this.out);
  private outViews: Uint8Array[] = [];

  // cliente
  private hostConn: DataConnection | null = null;
  private hostUnrel: RTCDataChannel | null = null;
  private welcome: Extract<Msg, { k: 'welcome' }> | null = null;
  private handshakeFail: ((e: NetError) => void) | null = null;
  private epoch = 0;
  private lastRx = 0;
  private lastHostSeq = -1;
  private inBuf = new ArrayBuffer(C2H_SIZE);
  private inDv = new DataView(this.inBuf);
  private inView = new Uint8Array(this.inBuf);

  private constructor(private peer: Peer, isHost: boolean, code: string, private name: string) {
    this.isHost = isHost;
    this.code = code;
    this.localId = isHost ? HOST_ID : '';
    this._mode = settings.mode;
    this.lastModeSent = settings.mode;
    peer.on('error', (err) => {
      if (this.handshakeFail) this.handshakeFail(friendlyPeerError(err));
      else console.warn('[net] erro do peer', err);
    });
    peer.on('disconnected', () => {
      // perdeu o broker; P2P já estabelecido segue funcionando. Host tenta voltar pra aceitar novos jogadores.
      if (!this.closed && this.isHost) {
        try { peer.reconnect(); } catch { /* ignora */ }
      }
    });
    if (isHost) peer.on('connection', (c) => this.onIncoming(c));
    this.unsubs.push(bus.on('weapon:fire', (e) => this.onLocalFire(e)));
    this.unsubs.push(bus.on('weapon:impact', (i) => {
      if (this.emitting) return;
      if (this.impacts.length > 24) this.impacts.shift();
      this.impacts.push(i);
    }));
    this.unsubs.push(bus.on('weapon:melee', (e) => this.onLocalMelee(e)));
    this.timer = setInterval(() => this.pump(), 50);
  }

  // ------------------------------------------------------------------ entrada

  /** Cria a sala. O peer ID do host é `fpsdoclt-<CODIGO>`. */
  static async host(name: string): Promise<Net> {
    for (let i = 0; i < 6; i++) {
      const code = genCode();
      try {
        const peer = await openPeer(ROOM_PREFIX + code);
        const net = new Net(peer, true, code, name);
        net.status = 'connected';
        return net;
      } catch (e) {
        if (e instanceof NetError && e.retry) continue; // ID ocupado: sorteia outro código
        throw e;
      }
    }
    throw new NetError('Não foi possível criar a sala (códigos ocupados). Tente de novo.');
  }

  /** Entra numa sala. Resolve só depois do welcome do host. */
  static async join(rawCode: string, name: string): Promise<Net> {
    const code = normalizeCode(rawCode);
    if (!code) throw new NetError(`Código inválido (são ${CODE_LEN} letras).`);
    const peer = await openPeer();
    const net = new Net(peer, false, code, name);
    try {
      await net.connectToHost();
    } catch (e) {
      net.close();
      throw e instanceof NetError ? e : new NetError('Não foi possível conectar (rede bloqueando P2P?)');
    }
    net.status = 'connected';
    return net;
  }

  private connectToHost(): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const fail = (e: NetError) => {
        if (done) return;
        done = true;
        this.handshakeFail = null;
        timers.forEach(clearTimeout);
        reject(e);
      };
      this.handshakeFail = fail;
      const conn = this.peer.connect(ROOM_PREFIX + this.code, { label: 'rel', reliable: true, serialization: 'raw' });
      this.hostConn = conn;
      timers.push(setTimeout(() => fail(new NetError('Não foi possível conectar (rede bloqueando P2P?)')), 15_000));
      conn.on('open', () => {
        this.lastRx = performance.now();
        // 2º canal, não confiável e sem ordem, no mesmo RTCPeerConnection (sem novo handshake).
        try {
          const pc = (conn as any).peerConnection as RTCPeerConnection;
          const dc = pc.createDataChannel('unrel', { ordered: false, maxRetransmits: 0 });
          dc.binaryType = 'arraybuffer';
          dc.onmessage = (ev) => this.onClientBinary(ev.data);
          dc.onclose = () => { if (this.hostUnrel === dc) this.hostUnrel = null; };
          this.hostUnrel = dc;
        } catch (err) {
          console.warn('[net] canal não confiável indisponível, usando o confiável', err);
        }
        this.sendJSON(conn, { k: 'hello', name: this.name, v: 1, face: settings.face });
        timers.push(setTimeout(() => fail(new NetError('A sala não respondeu. Tente novamente.')), 8000));
      });
      conn.on('data', (d) => {
        this.lastRx = performance.now();
        if (typeof d !== 'string') return this.onClientBinary(d as ArrayBuffer);
        const m = parse(d);
        if (!m) return;
        if (!done) {
          if (m.k === 'welcome') {
            done = true;
            this.handshakeFail = null;
            timers.forEach(clearTimeout);
            this.welcome = m;
            this.localId = m.id;
            this._mode = m.mode;
            this.epoch = m.ep;
            resolve();
          } else if (m.k === 'full') {
            fail(new NetError('Sala cheia.'));
          } else if (m.k === 'bye') {
            fail(new NetError(m.msg));
          }
          return;
        }
        this.onClientMsg(m);
      });
      conn.on('close', () => {
        if (!done) fail(new NetError('Não foi possível conectar (a sala fechou a conexão).'));
        else this.disconnect('O host saiu da sala.');
      });
      conn.on('error', (err) => {
        if (!done) fail(friendlyPeerError(err));
      });
    });
  }

  // ------------------------------------------------------------------ NetLink

  get mode(): Mode {
    return this.isHost ? settings.mode : this._mode;
  }

  /** Chamado por Game.startSession depois de criar o actor local. */
  attach(game: Game): void {
    this.game = game;
    if (this.isHost) {
      for (const a of game.actors.values()) this.numFor(a.id);
      game.onActorAdd = (a) => {
        if (this.closed) return;
        this.numFor(a.id);
        this.broadcastStr(JSON.stringify({ k: 'join', a: this.info(a) } satisfies Msg));
      };
      game.onActorRemove = (id) => {
        if (this.closed) return;
        this.broadcastStr(JSON.stringify({ k: 'leave', id } satisfies Msg));
        this.freeNum(id);
      };
    } else {
      game.onActorAdd = null;
      game.onActorRemove = null;
      const w = this.welcome!;
      this.welcome = null;
      for (const i of w.actors) this.applyInfo(i);
      game.sp.pickups.applyList(w.pk ?? []);
    }
    const pending = this.inbox;
    this.inbox = [];
    for (const { p, m } of pending) {
      if (this.isHost) { if (p) this.onHostMsg(p, m); } else this.onClientMsg(m);
    }
    this.onLobbyChange?.();
  }

  sendDamage(r: DamageRequest): void {
    if (this.hostConn?.open) this.sendJSON(this.hostConn, { k: 'dmg', r });
  }

  sendSpecial(m: SpecialMsg): void {
    if (this.closed) return;
    const str = JSON.stringify({ k: 'sp', m } satisfies Msg);
    if (this.isHost) this.broadcastStr(str);
    else if (this.hostConn?.open) this.hostConn.send(str);
  }

  requestPickup(id: number): void {
    if (this.hostConn?.open) this.sendJSON(this.hostConn, { k: 'pk', id });
  }

  requestSpecialEnd(kind: SpecialId): void {
    if (this.hostConn?.open) this.sendJSON(this.hostConn, { k: 'spx', w: kind });
  }

  requestBuy(item: ShopItemId): void {
    if (this.hostConn?.open) this.sendJSON(this.hostConn, { k: 'buy', item });
  }

  broadcastMatch(e: MatchEvent): void {
    if (!this.isHost) return;
    if (e.t === 'spawn') {
      const p = this.byActor.get(e.id);
      if (p) { p.epoch = (p.epoch + 1) & 255; p.rawValid = false; }
    }
    this.broadcastStr(JSON.stringify({ k: 'ev', e } satisfies Msg));
  }

  update(_dt: number): void {
    this.pump();
  }

  lobby(): LobbyInfo {
    const players: LobbyInfo['players'] = [];
    if (this.game) {
      for (const a of this.game.actors.values()) {
        if (a.isBot) continue;
        players.push({ name: a.name, ping: Math.round(a.ping), isHost: a.id === HOST_ID, isLocal: a.isLocal });
      }
    }
    return { status: this.status, code: this.code, isHost: this.isHost, players, error: this.errorMsg };
  }

  close(): void {
    if (this.closed) return;
    if (this.isHost) this.broadcastStr(JSON.stringify({ k: 'bye', msg: 'O host encerrou a sala.' } satisfies Msg));
    this.closed = true;
    if (this.status !== 'error') this.status = 'offline';
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    if (this.game) {
      this.game.onActorAdd = null;
      this.game.onActorRemove = null;
    }
    const peer = this.peer;
    const conns = [...this.clients.values()].map((p) => p.conn);
    if (this.hostConn) conns.push(this.hostConn);
    this.clients.clear();
    this.byActor.clear();
    // deixa o 'bye' sair antes de derrubar o peer
    setTimeout(() => {
      for (const c of conns) { try { c.close(); } catch { /* ignora */ } }
      try { peer.destroy(); } catch { /* ignora */ }
    }, this.isHost ? 150 : 0);
  }

  private disconnect(msg: string): void {
    if (this.closed) return;
    this.status = 'error';
    this.errorMsg = msg;
    this.close();
    this.onDisconnect?.(msg);
  }

  // ------------------------------------------------------------------ loop (wall-clock)

  private pump(): void {
    if (this.closed || !this.game) return;
    const now = performance.now();
    if (this.isHost) {
      for (const p of this.clients.values()) {
        if (now - p.lastSeen > TIMEOUT_MS) this.dropClient(p);
      }
      if (settings.mode !== this.lastModeSent) {
        this.lastModeSent = settings.mode;
        this.broadcastStr(JSON.stringify({ k: 'mode', m: settings.mode } satisfies Msg));
        this.onLobbyChange?.();
      }
      if (now >= this.nextPingAt) {
        this.nextPingAt = now + PING_MS;
        this.broadcastStr(JSON.stringify({ k: 'ping', t: now } satisfies Msg));
      }
      if (now >= this.nextSnapAt) {
        this.nextSnapAt = now - this.nextSnapAt > 250 ? now + HOST_SNAP_MS : this.nextSnapAt + HOST_SNAP_MS;
        this.sendAggregate();
      }
    } else {
      if (now - this.lastRx > TIMEOUT_MS) return this.disconnect('Conexão com o host perdida (sem resposta por 10s).');
      if (now >= this.nextSnapAt) {
        this.nextSnapAt = now - this.nextSnapAt > 250 ? now + CLIENT_SNAP_MS : this.nextSnapAt + CLIENT_SNAP_MS;
        this.sendLocalSnap();
      }
    }
  }

  // ------------------------------------------------------------------ snapshots

  private sendLocalSnap(): void {
    const a = this.game?.local;
    const conn = this.hostConn;
    if (!a || !conn?.open) return;
    const dv = this.inDv;
    dv.setUint8(0, T_C2H);
    dv.setUint8(1, this.epoch);
    dv.setUint16(2, this.seq++ & 0xffff, true);
    dv.setFloat32(4, a.pos.x, true);
    dv.setFloat32(8, a.pos.y, true);
    dv.setFloat32(12, a.pos.z, true);
    dv.setInt16(16, qYaw(a.yaw), true);
    dv.setInt16(18, qPitch(a.pitch), true);
    dv.setUint8(20, qSpeed(a.speed));
    dv.setUint8(21, packFlags(a.crouched, a.grounded, a.weapon));
    this.sendBin(conn, this.hostUnrel, this.inView);
  }

  private sendAggregate(): void {
    const game = this.game!;
    let any = false;
    for (const p of this.clients.values()) if (p.ready) { any = true; break; }
    if (!any) return;
    const dv = this.outDv;
    let off = H2C_HEADER;
    let n = 0;
    for (const a of game.actors.values()) {
      const num = this.nums.get(a.id);
      if (num === undefined) continue;
      if (n >= MAX_ACTORS) break;
      const p = a.isLocal ? undefined : this.byActor.get(a.id);
      dv.setUint8(off, num);
      if (p && p.rawValid) {
        dv.setFloat32(off + 1, p.rx, true);
        dv.setFloat32(off + 5, p.ry, true);
        dv.setFloat32(off + 9, p.rz, true);
        dv.setInt16(off + 13, p.ryaw, true);
        dv.setInt16(off + 15, p.rpitch, true);
        dv.setUint8(off + 17, p.rspeed);
        dv.setUint8(off + 18, p.rflags);
      } else {
        dv.setFloat32(off + 1, a.pos.x, true);
        dv.setFloat32(off + 5, a.pos.y, true);
        dv.setFloat32(off + 9, a.pos.z, true);
        dv.setInt16(off + 13, qYaw(a.yaw), true);
        dv.setInt16(off + 15, qPitch(a.pitch), true);
        dv.setUint8(off + 17, qSpeed(a.speed));
        dv.setUint8(off + 18, packFlags(a.crouched, a.grounded, a.weapon));
      }
      dv.setUint16(off + 19, Math.min(65535, Math.round(a.ping)), true);
      off += H2C_ENTRY;
      n++;
    }
    dv.setUint8(0, T_H2C);
    dv.setUint8(1, n);
    dv.setUint16(2, this.seq++ & 0xffff, true);
    const view = this.outViews[n] ?? (this.outViews[n] = new Uint8Array(this.out, 0, H2C_HEADER + n * H2C_ENTRY));
    for (const p of this.clients.values()) if (p.ready) this.sendBin(p.conn, p.unrel, view);
  }

  /** Host: snapshot de um cliente. */
  private onC2H(p: ClientPeer, dv: DataView): void {
    const game = this.game;
    if (this.closed || !game || !p.ready || !p.actorId || dv.byteLength < C2H_SIZE) return;
    if (dv.getUint8(1) !== p.epoch) return; // snapshot de antes do último respawn
    const seq = dv.getUint16(2, true);
    if (p.seqInit) {
      const d = (seq - p.lastSeq) & 0xffff;
      if (d === 0 || d > 0x8000) return; // velho/duplicado
    }
    p.seqInit = true;
    p.lastSeq = seq;
    p.rx = dv.getFloat32(4, true);
    p.ry = dv.getFloat32(8, true);
    p.rz = dv.getFloat32(12, true);
    p.ryaw = dv.getInt16(16, true);
    p.rpitch = dv.getInt16(18, true);
    p.rspeed = dv.getUint8(20);
    p.rflags = dv.getUint8(21);
    p.rawValid = true;
    // NaN/Infinity ou fora do mundo: descarta
    if (!(Number.isFinite(p.rx + p.ry + p.rz) && Math.abs(p.rx) < 500 && Math.abs(p.ry) < 500 && Math.abs(p.rz) < 500)) { p.rawValid = false; return; }
    const a = game.actors.get(p.actorId);
    if (!a) return;
    a.weapon = flagWeapon(p.rflags);
    game.pushSnap(p.actorId, {
      pos: new Vector3(p.rx, p.ry, p.rz), yaw: dYaw(p.ryaw), pitch: dPitch(p.rpitch),
      crouched: !!(p.rflags & F_CROUCH), speed: dSpeed(p.rspeed), grounded: !!(p.rflags & F_GROUND),
    });
  }

  /** Cliente: agregado do host. */
  private onH2C(dv: DataView): void {
    const game = this.game;
    if (!game || dv.byteLength < H2C_HEADER) return;
    const seq = dv.getUint16(2, true);
    if (this.lastHostSeq >= 0) {
      const d = (seq - this.lastHostSeq) & 0xffff;
      if (d === 0 || d > 0x8000) return;
    }
    this.lastHostSeq = seq;
    const count = Math.min(dv.getUint8(1), Math.floor((dv.byteLength - H2C_HEADER) / H2C_ENTRY));
    let off = H2C_HEADER;
    for (let i = 0; i < count; i++, off += H2C_ENTRY) {
      const id = this.numToId[dv.getUint8(off)];
      if (!id) continue;
      const a = game.actors.get(id);
      if (!a) continue;
      a.ping = dv.getUint16(off + 19, true);
      if (a.isLocal) continue;
      const flags = dv.getUint8(off + 18);
      a.weapon = flagWeapon(flags);
      game.pushSnap(id, {
        pos: new Vector3(dv.getFloat32(off + 1, true), dv.getFloat32(off + 5, true), dv.getFloat32(off + 9, true)),
        yaw: dYaw(dv.getInt16(off + 13, true)), pitch: dPitch(dv.getInt16(off + 15, true)),
        crouched: !!(flags & F_CROUCH), speed: dSpeed(dv.getUint8(off + 17)), grounded: !!(flags & F_GROUND),
      });
    }
  }

  private onClientBinary(d: ArrayBuffer): void {
    this.lastRx = performance.now();
    if (!(d instanceof ArrayBuffer) || d.byteLength < 1) return;
    const dv = new DataView(d);
    if (dv.getUint8(0) === T_H2C) this.onH2C(dv);
  }

  private sendBin(conn: DataConnection, dc: RTCDataChannel | null, view: Uint8Array): void {
    if (dc && dc.readyState === 'open') {
      if (dc.bufferedAmount < 65536) dc.send(view as any);
    } else if (conn.open) {
      conn.send(view.slice().buffer); // fallback: canal confiável
    }
  }

  // ------------------------------------------------------------------ host: conexões

  private onIncoming(conn: DataConnection): void {
    if (this.closed) { conn.close(); return; }
    if (conn.label !== 'rel') { conn.close(); return; }
    const old = this.clients.get(conn.peer);
    if (old) this.dropClient(old);
    const p: ClientPeer = {
      conn, unrel: null, actorId: null, ready: false, lastSeen: performance.now(), epoch: 0, seqInit: false, lastSeq: 0, rtt: 0,
      rawValid: false, rx: 0, ry: 0, rz: 0, ryaw: 0, rpitch: 0, rspeed: 0, rflags: 0,
    };
    this.clients.set(conn.peer, p);
    // O 2º canal (snapshots) chega no mesmo RTCPeerConnection; o PeerJS o confundiria com o 1º, então interceptamos.
    const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
    if (pc) {
      const orig = pc.ondatachannel;
      pc.ondatachannel = (ev: RTCDataChannelEvent) => {
        if (ev.channel.label === 'unrel') {
          const dc = ev.channel;
          dc.binaryType = 'arraybuffer';
          dc.onmessage = (m) => this.onHostData(p, m.data);
          dc.onclose = () => { if (p.unrel === dc) p.unrel = null; };
          p.unrel = dc;
        } else orig?.call(pc, ev);
      };
    }
    conn.on('data', (d) => this.onHostData(p, d));
    conn.on('close', () => this.dropClient(p));
    conn.on('error', (e) => console.warn('[net] erro de conexão com cliente', e));
  }

  private onHostData(p: ClientPeer, d: unknown): void {
    p.lastSeen = performance.now();
    if (typeof d === 'string') {
      const m = parse(d);
      if (m) this.onHostMsg(p, m);
    } else if (d instanceof ArrayBuffer && d.byteLength >= 1) {
      const dv = new DataView(d);
      if (dv.getUint8(0) === T_C2H) this.onC2H(p, dv);
    }
  }

  private onHostMsg(p: ClientPeer, m: Msg): void {
    if (this.closed) return;
    if (!this.game) { this.inbox.push({ p, m }); return; } // ainda sem sessão: guarda
    if (m.k === 'hello') return this.handleHello(p, m.name, m.face);
    if (!p.ready || !p.actorId) return;
    switch (m.k) {
      case 'dmg': {
        const r = m.r;
        if (!r || typeof r !== 'object' || !Number.isFinite(r.dmg) || !Array.isArray(r.dir) || r.dir.length !== 3) return;
        r.dmg = Math.max(0, Math.min(r.dmg, 300));
        // Só o próprio atirador pede dano... exceto queda depois de empurrão: quem pede é a vítima (dir zerado)
        const ownShot = r.attacker === p.actorId;
        // (ventilador: queda)
        const pushFall = r.victim === p.actorId && r.attacker !== r.victim && r.weapon === 'ventilador'
          && r.dir[0] === 0 && r.dir[1] === 0 && r.dir[2] === 0 && r.dmg <= 150;
        if (!ownShot && !pushFall) return;
        this.game.hostApplyDamage(r);
        break;
      }
      case 'sp':
        if (!m.m || m.m.a !== p.actorId) return; // só o próprio atirador
        this.broadcastStr(JSON.stringify(m), p);
        this.game.sp.onMsg(m.m);
        break;
      case 'pk':
        this.game.sp.hostPickupRequest(p.actorId, Number(m.id));
        break;
      case 'spx':
        this.game.sp.hostSpecialEnd(p.actorId, m.w);
        break;
      case 'buy':
        this.game.hostBuy(p.actorId, m.item);
        break;
      case 'pong': {
        const rtt = performance.now() - m.t;
        p.rtt = p.rtt ? p.rtt * 0.6 + rtt * 0.4 : rtt;
        const a = this.game.actors.get(p.actorId);
        if (a) a.ping = Math.round(p.rtt);
        this.onLobbyChange?.();
        break;
      }
      case 'f':
        if (m.a !== p.actorId) return;
        this.broadcastStr(JSON.stringify(m), p);
        this.emitFire(m);
        break;
      case 'm':
        if (m.a !== p.actorId) return;
        this.broadcastStr(JSON.stringify(m), p);
        this.emitMelee(m);
        break;
    }
  }

  private handleHello(p: ClientPeer, rawName: string, rawFace?: unknown): void {
    const game = this.game!;
    if (p.actorId) return;
    let humans = 0;
    for (const a of game.actors.values()) if (!a.isBot) humans++;
    if (humans >= MAX_HUMANS) {
      this.sendJSON(p.conn, { k: 'full' });
      setTimeout(() => this.dropClient(p), 300);
      return;
    }
    const name = String(rawName ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20) || 'Jogador';
    const id = `p${this.nextClientN++}`;
    p.actorId = id;
    this.byActor.set(id, p);
    // cor menos usada
    const use = ACTOR_COLORS.map((c) => { let n = 0; for (const a of game.actors.values()) if (a.color === c) n++; return n; });
    const color = ACTOR_COLORS[use.indexOf(Math.min(...use))];
    // addRemoteActor → hook avisa os outros (p ainda não está ready) → match.join publica level/spawn
    game.addRemoteActor(id, name, color, validFace(rawFace));
    const actors: ActorInfo[] = [];
    for (const a of game.actors.values()) actors.push(this.info(a));
    this.sendJSON(p.conn, { k: 'welcome', id, hostId: HOST_ID, mode: settings.mode, ep: p.epoch, actors, pk: game.sp.pickups.list() });
    p.ready = true;
    this.onLobbyChange?.();
  }

  private dropClient(p: ClientPeer): void {
    if (this.clients.get(p.conn.peer) === p) this.clients.delete(p.conn.peer);
    const id = p.actorId;
    p.ready = false;
    p.actorId = null;
    try { p.conn.close(); } catch { /* ignora */ }
    if (id) {
      this.byActor.delete(id);
      this.game?.removeActor(id); // hook → actor-leave
      this.onLobbyChange?.();
    }
  }

  // ------------------------------------------------------------------ cliente: mensagens

  private onClientMsg(m: Msg): void {
    if (this.closed) return;
    if (!this.game) { this.inbox.push({ p: null, m }); return; }
    const game = this.game;
    switch (m.k) {
      case 'join':
        this.applyInfo(m.a);
        this.onLobbyChange?.();
        break;
      case 'leave':
        game.removeActor(m.id);
        this.freeNum(m.id);
        this.onLobbyChange?.();
        break;
      case 'ev':
        if (m.e.t === 'spawn' && m.e.id === this.localId) this.epoch = (this.epoch + 1) & 255;
        game.applyMatchEvent(m.e);
        break;
      case 'f': this.emitFire(m); break;
      case 'm': this.emitMelee(m); break;
      case 'sp': game.sp.onMsg(m.m); break;
      case 'ping':
        if (this.hostConn?.open) this.sendJSON(this.hostConn, { k: 'pong', t: m.t });
        break;
      case 'mode':
        this._mode = m.m;
        this.onLobbyChange?.();
        break;
      case 'bye':
        this.disconnect(m.msg);
        break;
    }
  }

  /** Cria/atualiza um actor a partir do estado enviado pelo host. */
  private applyInfo(i: ActorInfo): void {
    const g = this.game!;
    let a = g.actors.get(i.id);
    if (a?.isLocal) {
      a.name = i.name;
      a.color = i.c;
    } else {
      a = g.addActor(i.id, i.name, !!i.b, false, i.c, validFace(i.f));
    }
    this.setNum(i.id, i.n);
    a.kills = i.kl;
    a.deaths = i.de;
    a.level = i.lv;
    a.money = i.mo;
    a.weapon = i.w;
    a.special = i.sp ?? null;
    if (i.al) {
      if (a.isLocal) {
        g.applyMatchEvent({ t: 'spawn', id: i.id, pos: [i.x, i.y, i.z], yaw: i.yaw, weapon: i.w });
        // o 'spawn' limpa a arma maluca: devolve a que o host disse que estava na mão
        if (i.sp && SPECIALS[i.sp]) g.applyMatchEvent({ t: 'special', actor: i.id, kind: i.sp, ammo: SPECIALS[i.sp].ammo });
      } else {
        a.pos.set(i.x, i.y, i.z);
        a.yaw = i.yaw;
        a.alive = true;
        a.snaps.length = 0;
        a.model?.respawn();
        if (a.model) a.model.root.visible = true;
      }
      a.hp = i.hp;
    } else {
      a.alive = false;
      a.hp = 0;
    }
  }

  // ------------------------------------------------------------------ efeitos de tiro

  private onLocalFire(e: GameEvents['weapon:fire']): void {
    const game = this.game;
    if (this.closed || !game || this.emitting) return;
    const isBot = this.isHost && !!game.actors.get(e.actorId)?.isBot;
    if (!e.local && !isBot) return;
    const flat: number[] = [];
    const s: (string | number)[] = [];
    for (const end of e.ends) {
      flat.push(r2(end.x), r2(end.y), r2(end.z));
      let tag: string | number = 0;
      for (const imp of this.impacts) {
        if (imp.point === end) { tag = imp.surface === 'flesh' ? 1 : (imp.material ?? 0); break; }
      }
      s.push(tag);
    }
    this.impacts.length = 0;
    const msg: FireMsg = {
      k: 'f', a: e.local ? this.localId : e.actorId, w: e.weapon,
      o: [r2(e.origin.x), r2(e.origin.y), r2(e.origin.z)], e: flat, s,
    };
    this.relayOwn(msg);
  }

  private onLocalMelee(e: GameEvents['weapon:melee']): void {
    const game = this.game;
    if (this.closed || !game || this.emitting) return;
    const isBot = this.isHost && !!game.actors.get(e.actorId)?.isBot;
    if (!e.local && !isBot) return;
    const msg: MeleeMsg = {
      k: 'm', a: e.local ? this.localId : e.actorId, w: e.weapon, hit: e.hit, hv: e.heavy,
      o: [r2(e.origin.x), r2(e.origin.y), r2(e.origin.z)],
    };
    this.relayOwn(msg);
  }

  /** Evento originado nesta máquina: host manda pra todos, cliente manda pro host (que retransmite). */
  private relayOwn(msg: FireMsg | MeleeMsg): void {
    const str = JSON.stringify(msg);
    if (this.isHost) this.broadcastStr(str);
    else if (this.hostConn?.open) this.hostConn.send(str);
  }

  private emitFire(m: FireMsg): void {
    const game = this.game;
    if (!game || m.a === this.localId) return;
    if (!Array.isArray(m.o) || !Array.isArray(m.e) || !m.o.every(Number.isFinite)) return;
    const origin = new Vector3(m.o[0], m.o[1], m.o[2]);
    const ends: Vector3[] = [];
    const dirs: Vector3[] = [];
    const n = Math.min(m.e.length, 3 * 12); // no máximo 12 chumbos
    for (let i = 0; i + 2 < n; i += 3) {
      const e = new Vector3(m.e[i], m.e[i + 1], m.e[i + 2]);
      if (!Number.isFinite(e.x + e.y + e.z)) continue;
      ends.push(e);
      dirs.push(e.clone().sub(origin).normalize());
    }
    if (!ends.length) return;
    this.emitting = true;
    try {
      bus.emit('weapon:fire', { actorId: m.a, local: false, weapon: m.w, origin, dirs, ends });
      for (let i = 0; i < ends.length; i++) {
        const tag = m.s[i];
        const normal = origin.clone().sub(ends[i]).normalize();
        if (tag === 1) bus.emit('weapon:impact', { point: ends[i], normal, surface: 'flesh' });
        else bus.emit('weapon:impact', { point: ends[i], normal, surface: 'world', material: typeof tag === 'string' ? tag : undefined });
      }
    } finally {
      this.emitting = false;
    }
    game.actors.get(m.a)?.model?.onFire();
  }

  private emitMelee(m: MeleeMsg): void {
    if (!this.game || m.a === this.localId) return;
    this.emitting = true;
    try {
      bus.emit('weapon:melee', {
        actorId: m.a, local: false, weapon: m.w, hit: m.hit, heavy: m.hv, origin: new Vector3(m.o[0], m.o[1], m.o[2]),
      });
    } finally {
      this.emitting = false;
    }
  }

  // ------------------------------------------------------------------ util

  private info(a: Actor): ActorInfo {
    return {
      id: a.id, n: this.numFor(a.id), name: a.name, c: a.color, b: a.isBot ? 1 : 0, hp: a.hp, al: a.alive ? 1 : 0,
      kl: a.kills, de: a.deaths, lv: a.level, mo: a.money, w: a.weapon,
      x: r2(a.pos.x), y: r2(a.pos.y), z: r2(a.pos.z), yaw: Math.round(a.yaw * 1000) / 1000,
      f: a.face,
      sp: a.special ?? undefined,
    };
  }

  private numFor(id: string): number {
    let n = this.nums.get(id);
    if (n === undefined) {
      for (let i = 0; i < 255; i++) {
        const c = ((this.nextNum + i - 1) % 255) + 1;
        if (!this.numToId[c]) { n = c; this.nextNum = (c % 255) + 1; break; }
      }
      if (n === undefined) n = 255;
      this.setNum(id, n);
    }
    return n;
  }

  private setNum(id: string, n: number): void {
    const old = this.nums.get(id);
    if (old !== undefined && old !== n) this.numToId[old] = undefined;
    this.nums.set(id, n);
    this.numToId[n] = id;
  }

  private freeNum(id: string): void {
    const n = this.nums.get(id);
    if (n === undefined) return;
    this.nums.delete(id);
    if (this.numToId[n] === id) this.numToId[n] = undefined;
  }

  private sendJSON(conn: DataConnection, m: Msg): void {
    if (conn.open) conn.send(JSON.stringify(m));
  }

  private broadcastStr(str: string, except?: ClientPeer): void {
    for (const p of this.clients.values()) {
      if (!p.ready || p === except || !p.conn.open) continue;
      p.conn.send(str);
    }
  }
}

function parse(s: string): Msg | null {
  try {
    const m = JSON.parse(s);
    return m && typeof m.k === 'string' ? (m as Msg) : null;
  } catch {
    return null;
  }
}
