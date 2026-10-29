import type * as THREE from 'three';
import { bus } from '../core/events';
import { onSettingsChange, settings } from '../core/Settings';
import { hashStr, mulberry32 } from './dsp';
import { RECIPES, VOICE_COUNT, type Recipe } from './recipes';

/**
 * Som do jogo: 100% procedural (Web Audio). Os sons são gerados como AudioBuffers
 * no unlock() (em fatias, sem travar o frame) e tocados com BufferSource + variação
 * de pitch/volume. Eventos do barramento -> sons; atores remotos são posicionais.
 *
 *  fontes -> sfx -> compressor/limiter -> master(volume) -> saída
 *            envio -> convolver (eco/reverb de deserto) -> compressor
 */

const MAX_VOICES = 24;
const MAX_LOOPS = 6;
const AMBIENT_WIND = true;

interface Pos { x: number; y: number; z: number }

interface PlayOpts {
  vol?: number;
  volVar?: number;
  rate?: number;
  rateVar?: number;
  /** Atraso em segundos (agendado no relógio do contexto). */
  delay?: number;
  /** Prioridade de voz: voz nova só corta voz de prioridade menor ou igual. */
  prio?: number;
  /** Envio para o reverb (0..1). */
  wet?: number;
  /** Aumenta o envio com a distância (som distante = mais eco). */
  wetDist?: boolean;
  pos?: Pos;
  ref?: number;
  rolloff?: number;
  maxDist?: number;
  /** Escala da perda de agudos com a distância (m). */
  lpScale?: number;
  hrtf?: boolean;
  /** Som de mecânica de arma agendado: cancelado ao trocar de arma/morrer. */
  mech?: boolean;
  variant?: number;
}

interface Loop {
  actor: string;
  kind: string;
  out: GainNode;
  panner: PannerNode | null;
  layers: { src: AudioBufferSourceNode; gain: GainNode; base: number }[];
  last: number;
  crackT: number;
  hit: boolean;
  pos?: Pos;
  nodes: AudioNode[];
}

const BEAM_LAYERS: Record<string, [string, number][]> = {
  lorenzetti: [['zapLoop', 1]],
  rexona: [['sprayLoop', 0.7], ['fireLoop', 1]],
  ventilador: [['fanLoop', 1], ['windLoop', 0.9]],
};

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  prio: number;
  mech: boolean;
  nodes: AudioNode[];
}

const SHOT: Record<string, { name: string; vol: number; ref: number; rolloff: number; wet: number; hrtf: boolean }> = {
  smg: { name: 'shot_smg', vol: 0.95, ref: 10, rolloff: 1.0, wet: 0.25, hrtf: false },
  rifle: { name: 'shot_rifle', vol: 1, ref: 12, rolloff: 1.0, wet: 0.35, hrtf: false },
  shotgun: { name: 'shot_shotgun', vol: 1, ref: 14, rolloff: 0.9, wet: 0.4, hrtf: true },
  sniper: { name: 'shot_sniper', vol: 1, ref: 18, rolloff: 0.8, wet: 0.5, hrtf: true },
  pistol: { name: 'shot_pistol', vol: 0.95, ref: 9, rolloff: 1.0, wet: 0.22, hrtf: false },
};

const IMPACT_BY_MATERIAL: Record<string, string> = {
  sand: 'impSand', sandDark: 'impSand',
  stone: 'impStone', wall: 'impStone', wallDark: 'impStone', plaster: 'impStone', trim: 'impStone', roof: 'impStone',
  wood: 'impWood', crate: 'impWood', door: 'impWood',
  metal: 'impMetal', glass: 'impGlass', cloth: 'impCloth',
};

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private sfx!: GainNode;
  private master!: GainNode;
  private reverbIn!: GainNode;
  private bank = new Map<string, AudioBuffer[]>();
  private queue: Recipe[] = [];
  private voices: Voice[] = [];
  private lx = 0; private ly = 0; private lz = 0;
  private lastAt = new Map<string, number>();
  private hurtVoice = new Map<string, { v: Voice; t: number }>();
  private impactWinStart = 0;
  private impactWinCount = 0;
  private lastSniperShot = -9;
  private resumeTimer = 0;

  constructor() {
    this.wire();
    this.wireSpecials();
    onSettingsChange(() => this.applyVolume());
  }

  // ------------------------------------------------------------------ ciclo de vida

  /** Chamar num gesto do usuário (clique) — navegadores exigem. Idempotente. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ctx = ctx;
    ctx.resume().catch(() => {});

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 10;
    comp.ratio.value = 10;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;

    this.master = ctx.createGain();
    this.applyVolume(true);
    comp.connect(this.master).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(comp);

    // Reverb "de deserto": cauda curta e escura gerada (sem arquivos).
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(ctx);
    const ret = ctx.createGain();
    ret.gain.value = 0.55;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(conv).connect(ret).connect(comp);

    this.startSynth(ctx.sampleRate);
  }

  /** Atualiza o "ouvido" (câmera) para som posicional. */
  update(dt: number, camera: THREE.Camera): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.resumeTimer += dt;
    if (this.resumeTimer > 1) {
      this.resumeTimer = 0;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
    }
    this.updateLoops(dt);
    camera.updateWorldMatrix(true, false);
    const e = camera.matrixWorld.elements;
    this.lx = e[12]; this.ly = e[13]; this.lz = e[14];
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = e[12]; l.positionY.value = e[13]; l.positionZ.value = e[14];
      l.forwardX.value = -e[8]; l.forwardY.value = -e[9]; l.forwardZ.value = -e[10];
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      (l as any).setPosition(e[12], e[13], e[14]);
      (l as any).setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  private applyVolume(immediate = false): void {
    if (!this.ctx || !this.master) return;
    const v = Math.pow(clamp(settings.volume, 0, 1.5), 1.5);
    if (immediate) this.master.gain.value = v;
    else this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  // ------------------------------------------------------------------ geração de buffers

  /** Síntese num Worker (fora da thread principal); se não der, gera em fatias pequenas. */
  private startSynth(sr: number): void {
    try {
      const w = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
      const total = RECIPES.reduce((n, r) => n + r.variants, 0);
      let received = 0;
      w.onmessage = (ev: MessageEvent<{ name: string; variant: number; data: Float32Array }>) => {
        const { name, variant, data } = ev.data;
        this.addBuffer(name, variant, data);
        if (++received >= total) w.terminate();
      };
      w.onerror = () => {
        w.terminate();
        this.fallbackSynth();
      };
      w.postMessage({ sr });
    } catch {
      this.fallbackSynth();
    }
  }

  private fallbackSynth(): void {
    if (this.queue.length || this.bank.size) return;
    this.queue = RECIPES.slice();
    this.pump();
  }

  private pump = (): void => {
    const sr = this.ctx!.sampleRate;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < 4) {
      const r = this.queue[0];
      try {
        const v = this.pumpVariant++;
        this.addBuffer(r.name, v, r.build(mulberry32(hashStr(r.name) + v * 7919), sr, v));
        if (this.pumpVariant >= r.variants) { this.queue.shift(); this.pumpVariant = 0; }
      } catch (err) {
        console.error('[audio] falha ao gerar', r.name, err);
        this.queue.shift();
        this.pumpVariant = 0;
      }
    }
    if (this.queue.length) setTimeout(this.pump, 12);
  };

  private pumpVariant = 0;

  private addBuffer(name: string, variant: number, data: Float32Array): void {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.getChannelData(0).set(data);
    let list = this.bank.get(name);
    if (!list) this.bank.set(name, (list = []));
    list[variant] = buf;
    if (name === 'wind' && AMBIENT_WIND) this.startWind(buf);
  }

  private startWind(buf: AudioBuffer): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.1, ctx.currentTime + 0.1, 2.5);
    src.connect(g).connect(this.sfx);
    src.start();
  }

  private makeImpulse(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.round(1.5 * sr);
    const buf = ctx.createBuffer(2, len, sr);
    const rng = mulberry32(1337);
    const pre = Math.round(0.012 * sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let y = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const f = 700 + 5000 * Math.exp(-t / 0.18);
        const a = Math.exp((-2 * Math.PI * f) / sr);
        y = a * y + (1 - a) * (rng() * 2 - 1);
        const env = Math.exp(-t / 0.4) * Math.min(1, t / 0.006);
        d[i] = y * env;
      }
    }
    return buf;
  }

  // ------------------------------------------------------------------ reprodução

  private killVoice(v: Voice): void {
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(0, t, 0.008);
      v.src.stop(t + 0.04);
    } catch {
      /* já parado */
    }
  }

  private makeRoom(prio: number): boolean {
    if (this.voices.length < MAX_VOICES) return true;
    let vi = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.prio > prio) continue;
      if (vi < 0) { vi = i; continue; }
      const b = this.voices[vi];
      if (v.prio < b.prio || (v.prio === b.prio && v.start < b.start)) vi = i;
    }
    if (vi < 0) return false;
    this.killVoice(this.voices[vi]);
    return true;
  }

  private stopMech(): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].mech) this.killVoice(this.voices[i]);
  }

  private play(name: string, o: PlayOpts = {}): Voice | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const bufs = this.bank.get(name);
    if (!bufs || bufs.length === 0) return null;

    let dist = 0;
    if (o.pos) {
      const dx = o.pos.x - this.lx, dy = o.pos.y - this.ly, dz = o.pos.z - this.lz;
      dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > (o.maxDist ?? 100)) return null;
    }
    const prio = o.prio ?? (o.pos ? 1 : 2);
    if (!this.makeRoom(prio)) return null;

    const buf = o.variant !== undefined ? bufs[o.variant % bufs.length] : bufs[(Math.random() * bufs.length) | 0];
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rv = o.rateVar ?? 0.06;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * rv);
    const gain = ctx.createGain();
    const vv = o.volVar ?? 0.1;
    gain.gain.value = (o.vol ?? 1) * (1 + (Math.random() * 2 - 1) * vv);
    src.connect(gain);

    const nodes: AudioNode[] = [src, gain];
    let tail: AudioNode = gain;
    if (o.pos) {
      if (dist > 12) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 0.5;
        lp.frequency.value = Math.max(1500, 18000 / (1 + (dist - 12) / (o.lpScale ?? 30)));
        tail.connect(lp);
        tail = lp;
        nodes.push(lp);
      }
      const p = ctx.createPanner();
      p.panningModel = o.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = o.ref ?? 4;
      p.rolloffFactor = o.rolloff ?? 1.3;
      p.coneInnerAngle = 360;
      if (p.positionX) {
        p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z;
      } else {
        (p as any).setPosition(o.pos.x, o.pos.y, o.pos.z);
      }
      tail.connect(p);
      tail = p;
      nodes.push(p);
    }
    tail.connect(this.sfx);
    if (o.wet) {
      const wet = o.wetDist ? o.wet * Math.min(2.2, 1 + dist / 45) : o.wet;
      const send = ctx.createGain();
      send.gain.value = Math.min(1, wet);
      tail.connect(send).connect(this.reverbIn);
      nodes.push(send);
    }

    const start = ctx.currentTime + Math.max(0, o.delay ?? 0);
    const voice: Voice = { src, gain, start, prio, mech: !!o.mech, nodes };
    this.voices.push(voice);
    src.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      for (const n of nodes) n.disconnect();
    };
    src.start(start);
    return voice;
  }

  /** true se passou `gap` s desde a última vez desta chave. */
  private throttle(key: string, gap: number): boolean {
    const now = this.ctx!.currentTime;
    const last = this.lastAt.get(key) ?? -9;
    if (now - last < gap) return false;
    this.lastAt.set(key, now);
    return true;
  }

  // ------------------------------------------------------------------ armas malucas (pickups)

  private loops = new Map<string, Loop>();
  private lastPos = new Map<string, Pos>();

  private remember(id: string, p: Pos): void {
    let o = this.lastPos.get(id);
    if (!o) this.lastPos.set(id, (o = { x: 0, y: 0, z: 0 }));
    o.x = p.x; o.y = p.y; o.z = p.z;
  }

  /** Loop (ou atualização de um loop existente). Remotos são posicionais; `pos` é copiado. */
  private loopSet(key: string, actor: string, kind: string, layers: [string, number][], pos?: Pos): Loop | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return null;
    const now = ctx.currentTime;
    let lp = this.loops.get(key);
    if (lp) {
      lp.last = now;
      if (pos) this.setLoopPos(lp, pos);
      return lp;
    }
    if (this.loops.size >= MAX_LOOPS) return null;
    if (pos) {
      const dx = pos.x - this.lx, dy = pos.y - this.ly, dz = pos.z - this.lz;
      if (dx * dx + dy * dy + dz * dz > 70 * 70) return null;
    }
    const bufs: AudioBuffer[] = [];
    for (const [name] of layers) {
      const b = this.bank.get(name)?.[0];
      if (!b) return null;
      bufs.push(b);
    }
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(1, now, 0.02);
    const nodes: AudioNode[] = [out];
    let panner: PannerNode | null = null;
    if (pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 6;
      panner.rolloffFactor = 1.1;
      out.connect(panner).connect(this.sfx);
      nodes.push(panner);
    } else {
      out.connect(this.sfx);
    }
    const made: Loop = { actor, kind, out, panner, layers: [], last: now, crackT: 0, hit: false, pos: pos ? { ...pos } : undefined, nodes };
    layers.forEach(([, base], i) => {
      const src = ctx.createBufferSource();
      src.buffer = bufs[i];
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = base;
      src.connect(g).connect(out);
      src.start(0, Math.random() * bufs[i].duration);
      made.layers.push({ src, gain: g, base });
      nodes.push(src, g);
    });
    if (pos) this.setLoopPos(made, pos);
    this.loops.set(key, made);
    return made;
  }

  private setLoopPos(lp: Loop, pos: Pos): void {
    if (lp.pos) { lp.pos.x = pos.x; lp.pos.y = pos.y; lp.pos.z = pos.z; }
    const p = lp.panner;
    if (!p) return;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else (p as any).setPosition(pos.x, pos.y, pos.z);
  }

  private stopLoop(key: string): void {
    const lp = this.loops.get(key);
    const ctx = this.ctx;
    if (!lp || !ctx) return;
    this.loops.delete(key);
    const t = ctx.currentTime;
    lp.out.gain.cancelScheduledValues(t);
    lp.out.gain.setTargetAtTime(0, t, 0.025);
    for (const l of lp.layers) {
      try { l.src.stop(t + 0.15); } catch { /* já parado */ }
    }
    lp.layers[0].src.onended = () => { for (const n of lp.nodes) n.disconnect(); };
  }

  private stopLoopsOf(actor: string): void {
    for (const [key, lp] of [...this.loops]) if (lp.actor === actor) this.stopLoop(key);
  }

  private stopAllLoops(): void {
    for (const key of [...this.loops.keys()]) this.stopLoop(key);
  }

  /** Watchdog (loop sem evento por 0.45 s = parou) + estalos aleatórios do Lorenzetti. */
  private updateLoops(dt: number): void {
    if (this.loops.size === 0) return;
    const now = this.ctx!.currentTime;
    for (const [key, lp] of [...this.loops]) {
      if (now - lp.last > 0.45) { this.stopLoop(key); continue; }
      if (lp.kind === 'lorenzetti') {
        lp.crackT -= dt;
        if (lp.crackT <= 0) {
          lp.crackT = 0.06 + Math.random() * 0.18;
          this.play('zapCrack', lp.pos ? { pos: lp.pos, ref: 5, rolloff: 1.2, maxDist: 60, prio: 1, vol: 1.2 } : { prio: 2, vol: 1.2 });
        }
      }
    }
  }

  private wireSpecials(): void {
    const who = (local: boolean, id: string) => (local ? 'local' : id);
    const near = (pos: Pos): PlayOpts => ({ pos, ref: 6, rolloff: 1.1, maxDist: 80, prio: 2 });

    // --- Loops: raio / jato / vento
    bus.on('special:beam', (e) => {
      const id = who(e.local, e.actorId);
      const key = id + ':' + e.kind;
      if (!e.on) { this.stopLoop(key); return; }
      if (!e.local) this.remember(e.actorId, e.origin);
      const lp = this.loopSet(key, id, e.kind, BEAM_LAYERS[e.kind], e.local ? undefined : e.origin);
      if (lp && lp.kind === 'lorenzetti' && lp.hit !== e.hit && this.ctx) {
        lp.hit = e.hit;
        lp.layers[0].gain.gain.setTargetAtTime(e.hit ? 1 : 0.7, this.ctx.currentTime, 0.04);
      }
    });

    // --- Estilingue esticando: pitch sobe com a carga
    bus.on('special:charge', (e) => {
      const id = who(e.local, e.actorId);
      const key = id + ':charge';
      if (e.charge <= 0.01) { this.stopLoop(key); return; }
      let pos: Pos | undefined;
      if (!e.local) { pos = this.lastPos.get(e.actorId); if (!pos) return; }
      const lp = this.loopSet(key, id, 'charge', [['stretchLoop', 1]], pos);
      if (lp && this.ctx) {
        const t = this.ctx.currentTime;
        lp.layers[0].src.playbackRate.setTargetAtTime(0.7 + e.charge * 1.6, t, 0.03);
        lp.layers[0].gain.gain.setTargetAtTime(0.25 + 0.75 * e.charge, t, 0.03);
      }
    });

    bus.on('special:fire', (e) => {
      const id = who(e.local, e.actorId);
      if (!e.local) this.remember(e.actorId, e.origin);
      const base: PlayOpts = e.local ? { prio: 3 } : near(e.origin);
      switch (e.kind) {
        case 'estilingue': {
          const c = e.charge ?? 0.5;
          this.stopLoop(id + ':charge');
          this.play('twang', { ...base, rate: 0.85 + 0.4 * c, vol: 0.6 + 0.5 * c });
          break;
        }
        case 'dolly': this.play('swing', { ...base, rate: 0.85, vol: 0.8 }); break;
        case 'panela': this.play('swingHeavy', { ...base, rate: 1.1, vol: 0.6 }); break;
        case 'tijolo': this.play('swingHeavy', { ...base, rate: 0.75, vol: 1.1 }); break;
        case 'pombo': this.play('pomboFire', base); break;
        case 'chinelo': this.play('chineloFwip', base); break;
        case 'coxinha':
          this.play('plopGun', { ...base, vol: 1.1, wet: 0.15 });
          for (let i = 0; i < 6; i++) {
            this.play('plop', { ...base, prio: 1, delay: 0.02 + i * 0.025 + Math.random() * 0.02, rate: 0.8 + Math.random() * 0.5, vol: 0.6, rateVar: 0 });
          }
          break;
        default: break;
      }
    });

    // --- Chiado crescente (panela) / chacoalhar (garrafa)
    bus.on('special:hiss', (e) => {
      const p = clamp(e.progress, 0, 1);
      const o: PlayOpts = { pos: e.pos, ref: 7, rolloff: 1.1, maxDist: 80, prio: 1, rateVar: 0.08 };
      if (e.kind === 'panela') this.play('hissPanela', { ...o, rate: 0.8 + p, vol: 0.35 + 0.65 * p });
      else this.play('hissBottle', { ...o, rate: 0.9 + p * 0.5, vol: 0.5 + 0.5 * p });
    });

    bus.on('special:explode', (e) => {
      this.play(e.kind === 'dolly' ? 'dollyBoom' : 'panelaBang', {
        pos: e.pos, ref: 14, rolloff: 0.9, maxDist: 300, prio: 4, wet: 0.4, wetDist: true, hrtf: true, lpScale: 70, rateVar: 0.04,
      });
    });

    bus.on('special:hit', (e) => {
      this.remember(e.victimId, e.pos);
      const o: PlayOpts = { ...near(e.pos), prio: 3 };
      switch (e.kind) {
        case 'stone': this.play('toc', o); break;
        case 'brick': this.play('tonk', e.headshot ? { ...o, vol: 1.2, rate: 0.85 } : o); break;
        case 'pombo': this.play('pomboHit', o); break;
        case 'chinelo': this.play('plaft', o); break;
        case 'coxinha': this.play('plop', { ...o, vol: 0.8 }); break;
        case 'panela': this.play('clang', o); break;
        default: break;
      }
    });

    bus.on('special:bounce', (e) => {
      if (e.speed < 2 || !this.ctx || !this.throttle('bounce:' + e.kind, 0.05)) return;
      const v = clamp(e.speed / 14, 0.25, 1.2);
      const o: PlayOpts = { pos: e.pos, ref: 5, rolloff: 1.2, maxDist: 60, prio: 1 };
      switch (e.kind) {
        case 'stone': this.play('toc', { ...o, vol: v }); break;
        case 'brick': this.play('tonk', { ...o, vol: v * 0.7 }); break;
        case 'bottle': this.play('impGlass', { ...o, vol: v * 1.5 }); break;
        case 'panela': this.play('clang', { ...o, vol: v * 0.8 }); break;
        case 'coxinha': this.play('plop', { ...o, vol: v * 0.5 }); break;
        case 'chinelo': this.play('plaft', { ...o, vol: 0.5, rate: 1.4 }); break;
        default: break;
      }
    });

    bus.on('special:stick', (e) => {
      if (!this.ctx || !this.throttle('stick', 0.04)) return;
      this.play('plop', { pos: e.pos, ref: 5, rolloff: 1.2, maxDist: 50, prio: 1, vol: 0.7, rate: 0.7 });
    });

    // --- Status
    bus.on('status:apply', (e) => {
      if (!this.ctx) return;
      const gap = e.kind === 'burn' ? 0.8 : 0.45;
      if (!this.throttle(`st:${who(e.local, e.actorId)}:${e.kind}`, gap)) return;
      let o: PlayOpts;
      if (e.local) o = { prio: 4 };
      else {
        const pos = this.lastPos.get(e.actorId);
        if (!pos) return;
        o = { ...near(pos), maxDist: 70 };
      }
      switch (e.kind) {
        case 'burn': this.play('burn', o); break;
        case 'shock': this.play('zap', o); break;
        case 'blind': this.play('splat', { ...o, vol: e.local ? 1.1 : 1 }); break;
        case 'stun': this.play('stunBirds', { ...o, vol: 0.9 }); break;
      }
    });

    // --- Pickups
    bus.on('special:spawn', (e) => {
      this.play('spawn', { pos: e.pos, ref: 4, rolloff: 1.5, maxDist: 45, prio: 0, rateVar: 0.1 });
    });
    bus.on('special:pickup', (e) => {
      this.stopLoopsOf(who(e.local, e.actorId));
      if (e.local) this.play('pickup', { prio: 4, rateVar: 0.02 });
      else {
        this.remember(e.actorId, e.pos);
        this.play('pickup', { ...near(e.pos), vol: 0.8, rateVar: 0.02 });
      }
    });

    // --- Parar loops direito
    bus.on('special:end', (e) => this.stopLoopsOf(who(e.local, e.actorId)));
    bus.on('player:death', () => this.stopLoopsOf('local'));
    bus.on('actor:death', (e) => this.stopLoopsOf(e.actorId));
    bus.on('weapon:switch', () => this.stopLoopsOf('local'));
    bus.on('match:end', () => this.stopAllLoops());
    bus.on('actor:hurt', (e) => this.remember(e.actorId, e.pos));
    bus.on('actor:footstep', (e) => this.remember(e.actorId, e.pos));
  }

  // ------------------------------------------------------------------ eventos

  private wire(): void {
    bus.on('weapon:fire', (e) => {
      const prof = SHOT[e.weapon];
      if (!prof || !this.ctx) return;
      if (e.local) {
        this.play(prof.name, { vol: prof.vol, prio: 3, wet: prof.wet, rateVar: 0.05, volVar: 0.06 });
        if (e.weapon === 'shotgun') this.play('pump', { delay: 0.42, prio: 3, mech: true, vol: 0.9 });
        else if (e.weapon === 'sniper') {
          this.lastSniperShot = this.ctx.currentTime;
          this.play('bolt', { delay: 0.55, prio: 3, mech: true, vol: 0.9 });
        }
      } else {
        this.play(prof.name, {
          vol: prof.vol * 0.9, pos: e.origin, ref: prof.ref, rolloff: prof.rolloff, maxDist: 450,
          prio: 2, wet: prof.wet, wetDist: true, hrtf: prof.hrtf, lpScale: 70, rateVar: 0.05,
        });
      }
    });

    bus.on('weapon:dryfire', () => this.play('dryfire', { prio: 3, rateVar: 0.04 }));

    bus.on('weapon:reload', (e) => {
      this.stopMech();
      const d = e.duration;
      const P = (name: string, frac: number, vol = 1) =>
        this.play(name, { delay: d * frac, prio: 3, mech: true, vol, rateVar: 0.04 });
      switch (e.weapon) {
        case 'shotgun':
          for (let i = 0; i < 4; i++) P('shellIn', 0.12 + i * 0.17);
          P('pump', 0.9);
          break;
        case 'sniper':
          P('boltOpen', 0.1); P('magOut', 0.3); P('magIn', 0.6); P('boltClose', 0.85);
          break;
        case 'pistol':
          P('magOut', 0.18); P('magIn', 0.62); P('charge', 0.9);
          break;
        default:
          P('magOut', 0.15); P('magIn', 0.6); P('charge', 0.88);
      }
    });

    bus.on('weapon:switch', (e) => {
      this.stopMech();
      const heavy = e.to === 'shotgun' || e.to === 'sniper' || e.to === 'rifle';
      this.play('switch', { prio: 2, rate: heavy ? 0.85 : 1, vol: 0.9 });
    });

    bus.on('weapon:zoom', (e) => {
      if (!this.ctx) return;
      if (e.active) this.play('zoomIn', { prio: 3 });
      else if (this.ctx.currentTime - this.lastSniperShot > 0.25) this.play('zoomOut', { prio: 3 });
    });

    bus.on('weapon:melee', (e) => {
      const pos = e.local ? undefined : e.origin;
      const base: PlayOpts = pos ? { pos, ref: 5, rolloff: 1.2, maxDist: 80, prio: 2 } : { prio: 3 };
      this.play(e.heavy ? 'swingHeavy' : 'swing', { ...base });
      if (e.hit) this.play('meleeHit', { ...base, delay: e.heavy ? 0.14 : 0.07, rate: e.heavy ? 0.85 : 1, vol: e.heavy ? 1.1 : 1 });
    });

    bus.on('weapon:impact', (e) => {
      const ctx = this.ctx;
      if (!ctx) return;
      // No máximo ~4 impactos por janela de 50 ms (escopeta = 10 pellets).
      const now = ctx.currentTime;
      if (now - this.impactWinStart > 0.05) { this.impactWinStart = now; this.impactWinCount = 0; }
      if (++this.impactWinCount > 4) return;
      const name = e.surface === 'flesh' ? 'impFlesh' : IMPACT_BY_MATERIAL[e.material ?? 'sand'] ?? 'impStone';
      this.play(name, { pos: e.point, ref: 6, rolloff: 1.0, maxDist: 70, lpScale: 40, prio: 1, rateVar: 0.1, vol: 1.4 });
    });

    // --- Feedback de acerto (o mais importante pro feel)
    bus.on('hit:confirm', (e) => {
      if (e.killed) {
        this.play('kill', { prio: 4, rateVar: 0.02, volVar: 0.04 });
        if (e.headshot) this.play('ding', { prio: 4, vol: 0.45, rate: 0.85, rateVar: 0.01 });
        return;
      }
      const rate = 0.92 + (Math.min(e.damage, 120) / 120) * 0.3;
      this.play('tick', { prio: 4, rate, rateVar: 0.03, vol: e.headshot ? 0.7 : 1 });
      if (e.headshot) this.play('ding', { prio: 4, rateVar: 0.01, volVar: 0.03 });
    });

    // --- Jogador local
    bus.on('player:footstep', (e) => {
      this.play('footstep', { vol: clamp(0.5 + e.speed * 0.07, 0.6, 1.1), prio: 0, rateVar: 0.12, volVar: 0.15 });
    });
    bus.on('player:jump', () => this.play('jump', { prio: 0 }));
    bus.on('player:land', (e) => {
      if (e.impact < 3) return;
      const k = clamp((e.impact - 3) / 12, 0.1, 1.2);
      this.play('land', { vol: 0.25 + 0.75 * k, rate: 1.15 - 0.3 * clamp(k, 0, 1), prio: 1, rateVar: 0.05 });
    });
    bus.on('player:damage', (e) => {
      if (!this.ctx) return;
      this.play('hurtThump', { prio: 3, vol: clamp(e.amount / 35, 0.5, 1.2) });
      if (this.throttle('ugh', 0.3)) this.play('ugh', { prio: 3, vol: clamp(0.6 + e.amount / 60, 0.6, 1), rateVar: 0.08 });
    });
    bus.on('player:death', () => {
      this.stopMech();
      this.play('deathHit', { prio: 4, rateVar: 0, volVar: 0, delay: 0.05 });
    });
    bus.on('player:respawn', () => this.play('respawn', { prio: 2, rateVar: 0 }));
    bus.on('match:start', () => this.play('matchStart', { prio: 2, rateVar: 0 }));

    // --- Outros atores (posicionais)
    bus.on('actor:footstep', (e) => {
      this.play('footstep', { pos: e.pos, ref: 4, rolloff: 1.2, maxDist: 40, prio: 0, vol: 0.9, rateVar: 0.12, volVar: 0.15 });
    });
    bus.on('actor:hurt', (e) => {
      const ctx = this.ctx;
      if (!ctx || !this.throttle('hurt:' + e.actorId, 0.2)) return;
      const v = this.play('oof', {
        variant: hashStr(e.actorId) % VOICE_COUNT, pos: e.pos, ref: 6, rolloff: 1.1, maxDist: 90, prio: 2,
        rate: e.headshot ? 1.1 : 1, rateVar: 0.05,
      });
      if (v) this.hurtVoice.set(e.actorId, { v, t: ctx.currentTime });
    });
    bus.on('actor:death', (e) => {
      const ctx = this.ctx;
      if (!ctx) return;
      // Se acabou de dar um "oof" nele, corta: a morte tem o grito dela.
      const h = this.hurtVoice.get(e.actorId);
      if (h && ctx.currentTime - h.t < 0.2) this.killVoice(h.v);
      this.hurtVoice.delete(e.actorId);
      this.play('deathGrunt', {
        variant: hashStr(e.actorId) % VOICE_COUNT, pos: e.pos, ref: 7, rolloff: 1.0, maxDist: 110, prio: 3,
        hrtf: true, rate: e.headshot ? 1.08 : 1, rateVar: 0.04,
      });
      this.play('bodyFall', { pos: e.pos, ref: 5, rolloff: 1.3, maxDist: 70, prio: 1, delay: 0.5 });
    });

    // --- Modo / partida
    bus.on('gungame:level', (e) => {
      this.play(e.up ? 'levelUp' : 'levelDown', { prio: 4, delay: e.up ? 0.45 : 0.3, rateVar: 0, volVar: 0 });
    });
    bus.on('match:end', (e) => {
      this.play(e.winnerIsLocal ? 'fanfareWin' : 'fanfareLose', { prio: 4, delay: 0.5, rateVar: 0, volVar: 0 });
    });
  }
}
