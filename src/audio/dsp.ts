/**
 * Kit de síntese offline (cálculo direto de samples, sem Web Audio).
 * Tudo aqui roda uma vez, na geração dos buffers; em runtime só se toca BufferSource.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_PI = Math.PI * 2;

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ------------------------------------------------------------------ filtros

export type FilterType = 'lp' | 'hp' | 'bp';

/** Biquad RBJ. O estado é mantido ao trocar os coeficientes (permite varrer a frequência). */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;

  set(type: FilterType, freq: number, q: number, sr: number): void {
    const f = Math.min(Math.max(freq, 20), sr * 0.45);
    const w = (TWO_PI * f) / sr;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(q, 0.05));
    let b0: number, b1: number, b2: number;
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0; this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export interface FiltSpec {
  type: FilterType;
  f: number;
  /** Frequência final (varredura ao longo da camada). */
  to?: number;
  q?: number;
  shape?: 'lin' | 'fast' | 'bell' | 'slow';
}

function shapeFn(s: FiltSpec['shape'], u: number): number {
  switch (s) {
    case 'fast': return 1 - Math.pow(1 - u, 3);
    case 'bell': return Math.sin(Math.PI * u);
    case 'slow': return u * u;
    default: return u;
  }
}

class FilterChain {
  private bq: Biquad[];
  readonly dynamic: boolean;
  constructor(private specs: FiltSpec[], private sr: number) {
    this.bq = specs.map(() => new Biquad());
    this.dynamic = specs.some((s) => s.to !== undefined);
    this.update(0);
  }
  update(u: number): void {
    for (let i = 0; i < this.specs.length; i++) {
      const s = this.specs[i];
      const f = s.to === undefined ? s.f : s.f * Math.pow(s.to / s.f, shapeFn(s.shape, u));
      this.bq[i].set(s.type, f, s.q ?? 0.707, this.sr);
    }
  }
  process(x: number): number {
    for (let i = 0; i < this.bq.length; i++) x = this.bq[i].process(x);
    return x;
  }
}

// ------------------------------------------------------------------ buffer

export class Sample {
  readonly data: Float32Array;
  constructor(readonly sr: number, seconds: number) {
    this.data = new Float32Array(Math.max(1, Math.ceil(seconds * sr)));
  }
}

function polyBlep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// ------------------------------------------------------------------ ruído

export interface NoiseOpts {
  t?: number;
  dur: number;
  gain?: number;
  attack?: number;
  /** Constante de tempo do decaimento exponencial (s). */
  decay?: number;
  color?: 'white' | 'pink' | 'brown';
  filters?: FiltSpec[];
}

export function addNoise(s: Sample, rng: Rng, o: NoiseOpts): void {
  const sr = s.sr;
  const i0 = Math.round((o.t ?? 0) * sr);
  const n = Math.min(Math.round(o.dur * sr), s.data.length - i0);
  if (n <= 0) return;
  const chain = new FilterChain(o.filters ?? [], sr);
  const att = Math.max(o.attack ?? 0.001, 0.0003) * sr;
  const decayMul = Math.exp(-1 / ((o.decay ?? o.dur / 4) * sr));
  const rel = Math.min(0.008 * sr, n * 0.25);
  const gain = o.gain ?? 1;
  const color = o.color ?? 'white';
  let e = 1;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  const d = s.data;
  for (let i = 0; i < n; i++) {
    if (chain.dynamic && (i & 15) === 0) chain.update(i / n);
    const w = rng() * 2 - 1;
    let x = w;
    if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else if (color === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      x = brown * 3.5;
    }
    x = chain.process(x);
    const a = i < att ? i / att : 1;
    const r = i > n - rel ? (n - i) / rel : 1;
    d[i0 + i] += x * gain * a * r * e;
    e *= decayMul;
  }
}

// ------------------------------------------------------------------ osciladores

export interface ToneOpts {
  t?: number;
  dur: number;
  f0: number;
  /** Frequência final (a queda de f0 -> f1 segue `pitchTau`, exponencial). */
  f1?: number;
  pitchTau?: number;
  gain?: number;
  attack?: number;
  decay?: number;
  wave?: 'sine' | 'tri' | 'saw' | 'square';
  width?: number;
  lp?: number;
  drive?: number;
  vibrato?: { rate: number; depth: number };
}

export function addTone(s: Sample, o: ToneOpts): void {
  const sr = s.sr;
  const i0 = Math.round((o.t ?? 0) * sr);
  const n = Math.min(Math.round(o.dur * sr), s.data.length - i0);
  if (n <= 0) return;
  const f1 = o.f1 ?? o.f0;
  const pm = o.pitchTau ? Math.exp(-1 / (o.pitchTau * sr)) : 1;
  const att = Math.max(o.attack ?? 0.001, 0.0003) * sr;
  const decayMul = Math.exp(-1 / ((o.decay ?? o.dur / 4) * sr));
  const rel = Math.min(0.008 * sr, n * 0.25);
  const gain = o.gain ?? 1;
  const wave = o.wave ?? 'sine';
  const width = o.width ?? 0.5;
  let lp: Biquad | null = null;
  if (o.lp) { lp = new Biquad(); lp.set('lp', o.lp, 0.707, sr); }
  const drive = o.drive ?? 0;
  const vib = o.vibrato;
  let vibPh = 0;
  let phase = 0, pe = 1, e = 1;
  const d = s.data;
  for (let i = 0; i < n; i++) {
    let f = f1 + (o.f0 - f1) * pe;
    pe *= pm;
    if (vib) { f *= 1 + vib.depth * Math.sin(vibPh); vibPh += (TWO_PI * vib.rate) / sr; }
    const dt = f / sr;
    phase += dt;
    if (phase >= 1) phase -= Math.floor(phase);
    let v: number;
    switch (wave) {
      case 'tri': v = 4 * Math.abs(phase - 0.5) - 1; break;
      case 'saw': v = 2 * phase - 1 - polyBlep(phase, dt); break;
      case 'square': v = (phase < width ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase - width + 1) % 1, dt); break;
      default: v = Math.sin(TWO_PI * phase);
    }
    if (lp) v = lp.process(v);
    if (drive) v = Math.tanh(v * drive);
    const a = i < att ? i / att : 1;
    const r = i > n - rel ? (n - i) / rel : 1;
    d[i0 + i] += v * gain * a * r * e;
    e *= decayMul;
  }
}

/** Sino metálico: parciais inarmônicas com decaimentos distintos. */
export function addBell(s: Sample, o: { t?: number; f: number; gain?: number; tau?: number; dur?: number; bright?: number }): void {
  const tau = o.tau ?? 0.3;
  const dur = o.dur ?? tau * 5;
  const g = o.gain ?? 1;
  const br = o.bright ?? 1;
  const parts: [number, number, number][] = [[1, 1, 1], [2.756, 0.38 * br, 0.5], [5.404, 0.14 * br, 0.25], [8.93, 0.05 * br, 0.12]];
  for (const [r, a, k] of parts) {
    if (o.f * r > s.sr * 0.42) continue;
    addTone(s, { t: o.t, dur, f0: o.f * r, gain: g * a, attack: 0.0006, decay: tau * k });
  }
  // "plink" do impacto
  addNoise(s, () => Math.random() * 2 - 1, {
    t: o.t, dur: 0.012, gain: g * 0.25 * br, decay: 0.003, attack: 0.0004,
    filters: [{ type: 'hp', f: Math.min(o.f * 2, 9000) }],
  });
}

// ------------------------------------------------------------------ metais (trombone/trompete)

export interface BrassOpts {
  t?: number;
  dur: number;
  f0: number;
  /** Glissando (parabólico: desliza mais no final). */
  f1?: number;
  gain?: number;
  cutLo: number;
  cutHi: number;
  /** wah: abre e fecha; open: abre rápido e fica; close: começa aberto e fecha. */
  cut?: 'wah' | 'open' | 'close';
  q?: number;
  attack?: number;
  release?: number;
  vibrato?: { rate: number; depth: number; ramp?: number };
  detune?: number;
}

export function addBrass(s: Sample, o: BrassOpts): void {
  const sr = s.sr;
  const i0 = Math.round((o.t ?? 0) * sr);
  const n = Math.min(Math.round(o.dur * sr), s.data.length - i0);
  if (n <= 0) return;
  const f1 = o.f1 ?? o.f0;
  const det = 1 + (o.detune ?? 0.004);
  const att = Math.max(o.attack ?? 0.03, 0.001) * sr;
  const rel = Math.max(o.release ?? 0.06, 0.002) * sr;
  const lp = new Biquad();
  const gain = o.gain ?? 1;
  const vib = o.vibrato;
  let ph1 = 0, ph2 = 0.37, vibPh = 0;
  const d = s.data;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 15) === 0) {
      let k: number;
      if (o.cut === 'open') k = Math.min(1, u * 4);
      else if (o.cut === 'close') k = 1 - u;
      else k = Math.sin(Math.PI * Math.pow(u, 0.6));
      lp.set('lp', o.cutLo * Math.pow(o.cutHi / o.cutLo, k), o.q ?? 1.4, sr);
    }
    let f = o.f0 + (f1 - o.f0) * u * u;
    if (vib) {
      const depth = vib.depth * (vib.ramp ? Math.min(1, (i / sr) / vib.ramp) : 1);
      f *= 1 + depth * Math.sin(vibPh);
      vibPh += (TWO_PI * vib.rate) / sr;
    }
    const dt = f / sr;
    ph1 += dt; if (ph1 >= 1) ph1 -= 1;
    ph2 += dt * det; if (ph2 >= 1) ph2 -= 1;
    const v = (2 * ph1 - 1 - polyBlep(ph1, dt) + (2 * ph2 - 1 - polyBlep(ph2, dt * det))) * 0.5;
    const a = i < att ? i / att : 1;
    const r = i > n - rel ? (n - i) / rel : 1;
    d[i0 + i] += lp.process(v) * gain * a * r * (1 - 0.2 * u);
  }
}

// ------------------------------------------------------------------ voz (formantes)

export const VOWELS = {
  a: [800, 1200, 2600], e: [450, 1900, 2600], i: [300, 2300, 3100], o: [480, 850, 2500],
  u: [330, 700, 2400], uh: [520, 1150, 2450], eh: [580, 1700, 2500], ae: [700, 1650, 2500],
} as const satisfies Record<string, readonly [number, number, number]>;

export interface VoiceOpts {
  t?: number;
  dur: number;
  gain?: number;
  /** Contorno de tom: [u (0..1), Hz]. */
  pitch: [number, number][];
  /** Alvos de vogal ao longo do tempo: [u, [F1,F2,F3]]. */
  vowels: [number, readonly [number, number, number]][];
  /** Contorno de amplitude [u, amp]; padrão: chapado. */
  amp?: [number, number][];
  attack?: number;
  release?: number;
  breath?: number;
  vibrato?: { rate: number; depth: number; delay?: number };
  jitter?: number;
  drive?: number;
}

function pw(pts: [number, number][], u: number): number {
  if (u <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) {
    if (u <= pts[k][0]) {
      const [u0, v0] = pts[k - 1], [u1, v1] = pts[k];
      return v0 + ((v1 - v0) * (u - u0)) / Math.max(1e-6, u1 - u0);
    }
  }
  return pts[pts.length - 1][1];
}

const BW = [90, 120, 180];
const FG = [1, 0.65, 0.35];

export function addVoice(s: Sample, rng: Rng, o: VoiceOpts): void {
  const sr = s.sr;
  const i0 = Math.round((o.t ?? 0) * sr);
  const n = Math.min(Math.round(o.dur * sr), s.data.length - i0);
  if (n <= 0) return;
  const bq = [new Biquad(), new Biquad(), new Biquad()];
  const att = Math.max(o.attack ?? 0.01, 0.001) * sr;
  const rel = Math.max(o.release ?? 0.03, 0.002) * sr;
  const gain = o.gain ?? 1;
  const breath = o.breath ?? 0.15;
  const drive = o.drive ?? 0;
  const vib = o.vibrato;
  let phase = 0, vibPh = 0, jit = 0;
  const vp: [number, number][] = o.vowels.map(([u, f]) => [u, 0]);
  const d = s.data;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if (i % 24 === 0) {
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < vp.length; j++) vp[j][1] = o.vowels[j][1][k];
        const f = pw(vp, u);
        bq[k].set('bp', f, f / BW[k], sr);
      }
      jit = jit * 0.9 + (rng() - 0.5) * (o.jitter ?? 0.01);
    }
    let f0 = pw(o.pitch, u) * (1 + jit);
    if (vib) {
      const on = (i / sr) > (vib.delay ?? 0) ? 1 : 0;
      f0 *= 1 + vib.depth * on * Math.sin(vibPh);
      vibPh += (TWO_PI * vib.rate) / sr;
    }
    const dt = f0 / sr;
    phase += dt; if (phase >= 1) phase -= 1;
    const src = 2 * phase - 1 - polyBlep(phase, dt) + breath * (rng() * 2 - 1);
    let v = bq[0].process(src) * FG[0] + bq[1].process(src) * FG[1] + bq[2].process(src) * FG[2];
    if (drive) v = Math.tanh(v * drive);
    const a = i < att ? i / att : 1;
    const r = i > n - rel ? (n - i) / rel : 1;
    const env = o.amp ? pw(o.amp, u) : 1;
    d[i0 + i] += v * gain * a * r * env;
  }
}

// ------------------------------------------------------------------ pós

/** Ecos "de deserto": cópias filtradas do começo do som, atrasadas. */
export function addEchoes(s: Sample, srcDur: number, taps: { d: number; g: number; lp: number }[]): void {
  const sr = s.sr;
  const m = Math.min(Math.round(srcDur * sr), s.data.length);
  const snap = s.data.slice(0, m);
  for (const t of taps) {
    const off = Math.round(t.d * sr);
    const lp = new Biquad();
    lp.set('lp', t.lp, 0.6, sr);
    const lp2 = new Biquad();
    lp2.set('lp', t.lp * 0.8, 0.6, sr);
    const end = Math.min(m, s.data.length - off);
    for (let i = 0; i < end; i++) s.data[i + off] += lp2.process(lp.process(snap[i])) * t.g;
  }
}

/** Distorção suave + normaliza para `peak` + fade de saída (sem estalo no corte). */
export function finalize(s: Sample, peak: number, drive = 0, fadeOut = 0.015): Float32Array {
  const d = s.data;
  const n = d.length;
  if (drive > 0) {
    const inv = 1 / Math.tanh(drive);
    for (let i = 0; i < n; i++) d[i] = Math.tanh(d[i] * drive) * inv;
  }
  // tira offset DC (ondas pulsadas, ruído marrom) antes de normalizar
  let mean = 0;
  for (let i = 0; i < n; i++) mean += d[i];
  mean /= n;
  let mx = 0;
  for (let i = 0; i < n; i++) { d[i] -= mean; const a = Math.abs(d[i]); if (a > mx) mx = a; }
  const k = mx > 1e-9 ? peak / mx : 0;
  const fo = Math.min(n, Math.round(fadeOut * s.sr));
  for (let i = 0; i < n; i++) {
    let v = d[i] * k;
    if (i >= n - fo) v *= (n - i) / fo;
    d[i] = v;
  }
  // fade-in mínimo (0.4 ms) contra clique no início
  const fi = Math.min(n, Math.round(0.0004 * s.sr));
  for (let i = 0; i < fi; i++) d[i] *= i / fi;
  return d;
}

/** Loop sem emenda: `raw` tem L + X amostras; o começo faz crossfade (potência igual) com o excedente. */
export function loopify(raw: Float32Array, L: number, peak: number): Float32Array {
  const X = raw.length - L;
  const out = new Float32Array(L);
  let mean = 0, mx = 0;
  for (let i = 0; i < L; i++) {
    let v: number;
    if (i < X) {
      const u = (i / X) * Math.PI * 0.5;
      v = raw[i] * Math.sin(u) + raw[L + i] * Math.cos(u);
    } else v = raw[i];
    out[i] = v;
    mean += v;
  }
  mean /= L;
  for (let i = 0; i < L; i++) { out[i] -= mean; mx = Math.max(mx, Math.abs(out[i])); }
  const k = mx > 1e-9 ? peak / mx : 0;
  for (let i = 0; i < L; i++) out[i] *= k;
  return out;
}
