import {
  Sample, addNoise, addTone, addVoice, finalize, loopify, Biquad, VOWELS,
  type Rng,
} from './dsp';
import type { Recipe } from './recipes';

/** Receitas de bola, pipa, rodo, café e hélice picotando. */
export const SPECIAL2_RECIPES: Recipe[] = [];
const add = (name: string, variants: number, build: Recipe['build']) => SPECIAL2_RECIPES.push({ name, variants, build });
const mk = (sr: number) => (dur: number) => new Sample(sr, dur);
const jit = (rng: Rng, x: number, r = 0.1) => x * (1 + (rng() * 2 - 1) * r);
const TAU = Math.PI * 2;

function loopRecipe(name: string, len: number, peak: number, fill: (raw: Float32Array, sr: number, L: number, rng: Rng) => void): void {
  add(name, 1, (rng, sr) => {
    const L = Math.round(len * sr), X = Math.round(Math.min(0.3, len * 0.3) * sr);
    const raw = new Float32Array(L + X);
    fill(raw, sr, L, rng);
    return loopify(raw, L, peak);
  });
}

function pinkState(): { st: number[]; next: (w: number) => number } {
  const st = [0, 0, 0];
  return {
    st,
    next(w: number) {
      st[0] = 0.99765 * st[0] + w * 0.099046;
      st[1] = 0.963 * st[1] + w * 0.2965164;
      st[2] = 0.57 * st[2] + w * 1.0526913;
      return (st[0] + st[1] + st[2] + w * 0.1848) * 0.2;
    },
  };
}

// ------------------------------------------------------------------ bola

// "TUM" de bola de couro
add('kick', 2, (rng, sr) => {
  const s = mk(sr)(0.38);
  addTone(s, { dur: 0.3, f0: jit(rng, 170, 0.08), f1: 55, pitchTau: 0.018, decay: 0.09, gain: 1.2, attack: 0.001 });
  addTone(s, { dur: 0.3, f0: 90, decay: 0.12, gain: 0.5, attack: 0.002 });
  addNoise(s, rng, { dur: 0.1, attack: 0.0005, decay: 0.02, gain: 1, filters: [{ type: 'bp', f: 650, q: 0.9 }] });
  addNoise(s, rng, { dur: 0.15, color: 'pink', attack: 0.001, decay: 0.03, gain: 0.6, filters: [{ type: 'lp', f: 1800 }] });
  return finalize(s, 0.75, 1.4, 0.05);
});

add('ballBounce', 3, (rng, sr) => {
  const s = mk(sr)(0.24);
  addTone(s, { dur: 0.2, f0: jit(rng, 190, 0.08), f1: 120, pitchTau: 0.015, decay: 0.05, gain: 1, attack: 0.001 });
  addNoise(s, rng, { dur: 0.05, attack: 0.0005, decay: 0.015, gain: 0.5, filters: [{ type: 'lp', f: 900 }] });
  return finalize(s, 0.45, 0, 0.04);
});

// "GOOOOL" de narrador: vogal sobe, sustenta com vibrato e fecha em "l"
add('golNarrator', 2, (rng, sr, v) => {
  const m = [1, 0.88][v];
  const s = mk(sr)(2.7);
  addNoise(s, rng, { dur: 0.05, attack: 0.001, decay: 0.01, gain: 0.5, filters: [{ type: 'bp', f: 900, q: 1 }] });
  addVoice(s, rng, {
    t: 0.02, dur: 2.5,
    pitch: [[0, 190 * m], [0.04, 320 * m], [0.1, 400 * m], [0.75, 430 * m], [0.92, 380 * m], [1, 280 * m]],
    vowels: [[0, VOWELS.uh], [0.04, VOWELS.o], [0.9, VOWELS.o], [1, VOWELS.u]],
    amp: [[0, 0], [0.02, 1], [0.8, 1], [0.95, 0.6], [1, 0]],
    attack: 0.01, release: 0.08, breath: 0.18,
    vibrato: { rate: 6, depth: 0.035, delay: 0.35 }, jitter: 0.02, drive: 2,
  });
  return finalize(s, 0.8, 0, 0.1);
});

// Torcida: ruído filtrado em ondas + vuvuzela
add('crowd', 1, (rng, sr) => {
  const s = mk(sr)(3.4);
  const d = s.data;
  const bp = new Biquad(), hp = new Biquad();
  bp.set('bp', 1400, 0.6, sr);
  hp.set('hp', 400, 0.7, sr);
  const p = pinkState();
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const env = Math.min(t / 0.5, 1) * Math.exp(-Math.max(0, t - 1.8) / 0.7) * (0.75 + 0.25 * Math.sin(TAU * 1.6 * t));
    d[i] += hp.process(bp.process(p.next(rng() * 2 - 1))) * env * 2;
  }
  addTone(s, { t: 0.1, dur: 2.2, wave: 'saw', f0: 233, decay: 2, gain: 0.25, lp: 1600, attack: 0.15, vibrato: { rate: 5, depth: 0.004 } });
  addTone(s, { t: 0.1, dur: 2.2, wave: 'saw', f0: 236, decay: 2, gain: 0.2, lp: 1600, attack: 0.15 });
  return finalize(s, 0.6, 0, 0.3);
});

// ------------------------------------------------------------------ pipa

// carretel girando: catraca que acelera + zumbido
add('reel', 2, (rng, sr) => {
  const s = mk(sr)(0.85);
  let t = 0, iv = 0.08;
  while (t < 0.6) {
    addNoise(s, rng, { t, dur: 0.02, attack: 0.0003, decay: 0.004, gain: 0.8, filters: [{ type: 'bp', f: jit(rng, 3000, 0.1), q: 1 }] });
    addTone(s, { t, dur: 0.02, f0: 1800, decay: 0.004, gain: 0.3, attack: 0.0003 });
    t += iv;
    iv = Math.max(0.02, iv * 0.88);
  }
  addNoise(s, rng, { dur: 0.75, attack: 0.05, decay: 0.25, gain: 0.4, filters: [{ type: 'bp', f: 1200, to: 3500, q: 3, shape: 'lin' }] });
  return finalize(s, 0.4, 0, 0.1);
});

// vento + zumbido da linha esticada
loopRecipe('kiteLoop', 1.2, 0.3, (raw, sr, L, rng) => {
  const bp = new Biquad();
  bp.set('bp', 700, 0.6, sr);
  const p = pinkState();
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    const hum =
      0.5 * Math.sin(TAU * 330 * t + 0.8 * Math.sin(TAU * 2.5 * t)) +
      0.3 * Math.sin(TAU * 495 * t + 1.1 * Math.sin(TAU * 2.5 * t + 1)) +
      0.2 * Math.sin(TAU * 660 * t + 0.5 * Math.sin(TAU * 5 * t));
    const wind = bp.process(p.next(rng() * 2 - 1)) * (0.6 + 0.4 * Math.sin(TAU * (2 / 1.2) * t));
    raw[i] = (hum * 0.6 + wind * 1.2) * (0.8 + 0.2 * Math.sin(TAU * 10 * t));
  }
});

// chiado cortante agudo quando a linha corta alguém
loopRecipe('cutLoop', 0.6, 0.35, (raw, sr, L, rng) => {
  const bp = new Biquad(), hp = new Biquad();
  bp.set('bp', 6500, 5, sr);
  hp.set('hp', 5000, 0.7, sr);
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    const w = rng() * 2 - 1;
    raw[i] = bp.process(w) * 2.5 + hp.process(w) * 0.2 + Math.sin(TAU * 4400 * t) * 0.3 * (0.6 + 0.4 * Math.sin(TAU * 20 * t));
  }
});

// ------------------------------------------------------------------ rodo

// "VUUUSH"
add('rodoSwing', 2, (rng, sr) => {
  const s = mk(sr)(0.6);
  addNoise(s, rng, { dur: 0.55, attack: 0.2, decay: 0.15, gain: 1, filters: [{ type: 'bp', f: jit(rng, 250, 0.1), to: 1600, q: 0.9, shape: 'bell' }] });
  addNoise(s, rng, { dur: 0.5, color: 'brown', attack: 0.15, decay: 0.15, gain: 0.6, filters: [{ type: 'lp', f: 350 }] });
  addNoise(s, rng, { t: 0.05, dur: 0.4, attack: 0.15, decay: 0.08, gain: 0.12, filters: [{ type: 'hp', f: 4000 }] });
  return finalize(s, 0.6, 0, 0.1);
});

// madeira rangendo na carga do golpe
add('rodoCharge', 1, (rng, sr) => {
  const s = mk(sr)(0.42);
  addTone(s, { dur: 0.38, wave: 'saw', f0: 80, f1: 240, pitchTau: 0.15, decay: 0.3, gain: 0.6, lp: 900, vibrato: { rate: 25, depth: 0.08 }, attack: 0.05 });
  addNoise(s, rng, { dur: 0.38, attack: 0.1, decay: 0.15, gain: 0.4, filters: [{ type: 'bp', f: 500, to: 1200, q: 2, shape: 'lin' }] });
  return finalize(s, 0.4, 0, 0.06);
});

// "PLAAAC" de madeira pesado
add('plac', 2, (rng, sr) => {
  const s = mk(sr)(0.7);
  addTone(s, { dur: 0.4, f0: 130, f1: 55, pitchTau: 0.02, decay: 0.12, gain: 1.2, attack: 0.001 });
  addNoise(s, rng, { dur: 0.1, attack: 0.0004, decay: 0.02, gain: 1, filters: [{ type: 'bp', f: jit(rng, 1400, 0.1), q: 1.2 }] });
  addTone(s, { dur: 0.15, f0: 900, f1: 400, pitchTau: 0.01, decay: 0.04, gain: 0.5, attack: 0.0005 });
  addTone(s, { dur: 0.2, f0: 2200, decay: 0.06, gain: 0.15, attack: 0.0005 });
  addNoise(s, rng, { dur: 0.02, attack: 0.0003, decay: 0.01, gain: 0.7, filters: [{ type: 'hp', f: 3500 }] });
  addNoise(s, rng, { t: 0.03, dur: 0.4, attack: 0.003, decay: 0.1, gain: 0.4, filters: [{ type: 'bp', f: 500, q: 4 }] });
  return finalize(s, 0.85, 1.8, 0.1);
});

// corpo batendo seco na parede
add('slam', 2, (rng, sr) => {
  const s = mk(sr)(0.45);
  addTone(s, { dur: 0.3, f0: 95, f1: 40, pitchTau: 0.02, decay: 0.09, gain: 1.2, attack: 0.001 });
  addNoise(s, rng, { dur: 0.2, color: 'pink', attack: 0.001, decay: 0.05, gain: 0.9, filters: [{ type: 'lp', f: 700 }] });
  addNoise(s, rng, { dur: 0.04, attack: 0.0004, decay: 0.008, gain: 0.8, filters: [{ type: 'bp', f: 1800, q: 1 }] });
  addNoise(s, rng, { t: 0.02, dur: 0.25, attack: 0.01, decay: 0.07, gain: 0.25, filters: [{ type: 'bp', f: 3500, q: 0.7 }] });
  return finalize(s, 0.8, 1.5, 0.07);
});

// ------------------------------------------------------------------ café

// jato líquido borbulhante
loopRecipe('jetLoop', 1.2, 0.4, (raw, sr, L, rng) => {
  const bp = new Biquad(), lp = new Biquad();
  bp.set('bp', 1500, 0.5, sr);
  lp.set('lp', 3500, 0.7, sr);
  let am = 0;
  for (let i = 0; i < raw.length; i++) {
    am += ((rng() * 2 - 1) - am) * 0.01;
    raw[i] = lp.process(bp.process(rng() * 2 - 1)) * (1 + 0.6 * am);
  }
  const len = Math.round(0.03 * sr);
  for (let k = 0; k < 30; k++) {
    const p = (rng() * L) | 0, f = 300 + rng() * 600, g = 0.3 + rng() * 0.5;
    for (let j = 0; j < len; j++) {
      const t = j / sr;
      raw[p + j] += Math.sin(TAU * f * (1 + 20 * t) * t) * Math.exp(-j / (len * 0.4)) * g;
    }
  }
});

// "fsss" de vapor
add('steam', 2, (rng, sr) => {
  const s = mk(sr)(0.6);
  addNoise(s, rng, { dur: 0.55, attack: 0.04, decay: 0.18, gain: 1, filters: [{ type: 'hp', f: 3500 }] });
  addNoise(s, rng, { dur: 0.5, attack: 0.03, decay: 0.15, gain: 0.6, filters: [{ type: 'bp', f: 6500, q: 0.6 }] });
  return finalize(s, 0.3, 0, 0.1);
});

// ------------------------------------------------------------------ ventilador: hélice picotando

loopRecipe('chopLoop', 0.5, 0.45, (raw, sr, L, rng) => {
  const bp = new Biquad();
  bp.set('bp', 2500, 2, sr);
  for (let i = 0; i < raw.length; i++) raw[i] = bp.process(rng() * 2 - 1) * 0.12;
  const len = Math.round(0.012 * sr);
  for (let k = 0; k < 16; k++) {
    const p = Math.round((k / 32) * sr), g = 0.7 + rng() * 0.3;
    for (let j = 0; j < len; j++) {
      raw[p + j] += ((rng() * 2 - 1) * Math.exp(-j / (0.003 * sr)) + 0.8 * Math.sin(TAU * 180 * (j / sr)) * Math.exp(-j / (0.006 * sr))) * g;
    }
  }
});
