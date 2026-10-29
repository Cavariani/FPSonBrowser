import {
  Sample, addNoise, addTone, addBell, addVoice, addEchoes, finalize, loopify, Biquad, VOWELS,
  type Rng,
} from './dsp';
import type { Recipe } from './recipes';

/** Receitas das armas malucas (pickups). Mesmas convenções de recipes.ts. */
export const SPECIAL_RECIPES: Recipe[] = [];
const add = (name: string, variants: number, build: Recipe['build']) => SPECIAL_RECIPES.push({ name, variants, build });
const mk = (sr: number) => (dur: number) => new Sample(sr, dur);
const jit = (rng: Rng, x: number, r = 0.1) => x * (1 + (rng() * 2 - 1) * r);
const TAU = Math.PI * 2;

/** Constrói um loop: `fill` preenche raw (L + X amostras). */
function loopRecipe(name: string, len: number, peak: number, fill: (raw: Float32Array, sr: number, L: number, rng: Rng) => void): void {
  add(name, 1, (rng, sr) => {
    const L = Math.round(len * sr), X = Math.round(Math.min(0.3, len * 0.3) * sr);
    const raw = new Float32Array(L + X);
    fill(raw, sr, L, rng);
    return loopify(raw, L, peak);
  });
}

function pink(w: number, st: number[]): number {
  st[0] = 0.99765 * st[0] + w * 0.099046;
  st[1] = 0.963 * st[1] + w * 0.2965164;
  st[2] = 0.57 * st[2] + w * 1.0526913;
  return (st[0] + st[1] + st[2] + w * 0.1848) * 0.2;
}

// ------------------------------------------------------------------ loops (segurar o botão)

// Lorenzetti: zumbido elétrico de 100 Hz + estalos
loopRecipe('zapLoop', 1.2, 0.4, (raw, sr, L, rng) => {
  const hp = new Biquad();
  hp.set('hp', 3000, 0.7, sr);
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    let v = Math.tanh(3 * Math.sin(TAU * 100 * t) + 1.5 * Math.sin(TAU * 300 * t + 1)) * 0.6;
    v += 0.25 * Math.sin(TAU * 1200 * t) * (0.5 + 0.5 * Math.sin(TAU * 5 * t));
    v += hp.process(rng() * 2 - 1) * (0.15 + 0.15 * Math.sin(TAU * 10 * t));
    raw[i] = v;
  }
  const len = Math.round(0.004 * sr);
  for (let k = 0; k < 26; k++) {
    const p = (rng() * L) | 0, g = 0.4 + rng() * 0.8;
    for (let j = 0; j < len; j++) raw[p + j] += (rng() * 2 - 1) * g * Math.exp(-j / (len * 0.3));
  }
});

// Rexona: rugido do fogo
loopRecipe('fireLoop', 2, 0.5, (raw, sr, L, rng) => {
  const lpB = new Biquad(), lpP = new Biquad(), hp = new Biquad();
  lpB.set('lp', 250, 0.7, sr); lpP.set('lp', 1500, 0.7, sr); hp.set('hp', 3000, 0.7, sr);
  let brown = 0, fl = 0;
  const st = [0, 0, 0];
  for (let i = 0; i < raw.length; i++) {
    const w = rng() * 2 - 1;
    brown = (brown + 0.02 * w) / 1.02;
    fl += ((rng() * 2 - 1) - fl) * 0.004;
    const amp = Math.max(0.25, 0.7 + 3 * fl);
    let v = lpB.process(brown * 3.5) * 1.2 + lpP.process(pink(w, st)) * amp;
    v += hp.process(rng() < 0.0007 ? (rng() * 2 - 1) * 2.5 : 0);
    raw[i] = v;
  }
});

// Rexona: aerosol "psssss"
loopRecipe('sprayLoop', 1, 0.3, (raw, sr, L, rng) => {
  const bp = new Biquad(), hp = new Biquad();
  bp.set('bp', 6500, 0.6, sr); hp.set('hp', 3000, 0.7, sr);
  let am = 0;
  for (let i = 0; i < raw.length; i++) {
    am += ((rng() * 2 - 1) - am) * 0.01;
    raw[i] = hp.process(bp.process(rng() * 2 - 1)) * (1 + 0.5 * am);
  }
});

// Ventilador: motor + pás
loopRecipe('fanLoop', 1, 0.35, (raw, sr, L, rng) => {
  const lp = new Biquad();
  lp.set('lp', 2500, 0.7, sr);
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    let v = 0.5 * Math.sin(TAU * 120 * t) + 0.3 * Math.sin(TAU * 240 * t + 0.4) + 0.15 * Math.sin(TAU * 360 * t) + 0.08 * Math.sin(TAU * 850 * t);
    v += lp.process(rng() * 2 - 1) * 0.15;
    raw[i] = v * (0.7 + 0.3 * Math.sin(TAU * 24 * t));
  }
});

// Ventilador: vento
loopRecipe('windLoop', 1.5, 0.25, (raw, sr, L, rng) => {
  const bp = new Biquad();
  bp.set('bp', 900, 0.5, sr);
  const st = [0, 0, 0];
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    raw[i] = bp.process(pink(rng() * 2 - 1, st)) * (0.7 + 0.3 * Math.sin(TAU * (t / 1.5) * 2));
  }
});

// Estilingue: elástico esticando (o pitch é controlado em runtime via playbackRate)
loopRecipe('stretchLoop', 0.5, 0.3, (raw, sr, L, rng) => {
  const bp = new Biquad();
  bp.set('bp', 2500, 1, sr);
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    const v = Math.tanh(1.5 * Math.sin(TAU * 260 * t) + 0.5 * Math.sin(TAU * 520 * t + 0.5)) * (0.8 + 0.2 * Math.sin(TAU * 18 * t));
    raw[i] = v * 0.7 + bp.process(rng() * 2 - 1) * 0.15 * (0.5 + 0.5 * Math.sin(TAU * 10 * t));
  }
});

// ------------------------------------------------------------------ estilingue

add('twang', 3, (rng, sr) => {
  const s = mk(sr)(0.7);
  addTone(s, { dur: 0.6, wave: 'saw', f0: jit(rng, 520, 0.08), f1: 300, pitchTau: 0.12, decay: 0.18, gain: 0.8, lp: 2500, vibrato: { rate: 45, depth: 0.06 }, attack: 0.001 });
  addTone(s, { dur: 0.5, f0: 700, f1: 260, pitchTau: 0.1, decay: 0.15, gain: 0.6, vibrato: { rate: 38, depth: 0.08 }, attack: 0.001 });
  addNoise(s, rng, { dur: 0.02, attack: 0.0004, decay: 0.004, gain: 0.8, filters: [{ type: 'hp', f: 3000 }] });
  return finalize(s, 0.6, 1.3, 0.06);
});

add('toc', 2, (rng, sr) => {
  const s = mk(sr)(0.12);
  addTone(s, { dur: 0.1, f0: jit(rng, 700, 0.1), f1: 400, pitchTau: 0.01, decay: 0.02, gain: 1, attack: 0.0006 });
  addNoise(s, rng, { dur: 0.03, attack: 0.0004, decay: 0.008, gain: 0.7, filters: [{ type: 'bp', f: 1500, q: 1.5 }] });
  return finalize(s, 0.38, 0, 0.02);
});

// ------------------------------------------------------------------ tijolo

add('tonk', 2, (rng, sr) => {
  const s = mk(sr)(0.28);
  addTone(s, { dur: 0.2, f0: 280, f1: 140, pitchTau: 0.006, decay: 0.03, gain: 1, attack: 0.0006 });
  addTone(s, { dur: 0.25, f0: 90, decay: 0.06, gain: 0.8, attack: 0.001 });
  addNoise(s, rng, { dur: 0.05, attack: 0.0004, decay: 0.012, gain: 0.8, filters: [{ type: 'bp', f: 900, q: 1.5 }] });
  return finalize(s, 0.65, 1.4, 0.04);
});

// passarinhos e estrelinhas do nocaute
add('stunBirds', 2, (rng, sr) => {
  const s = mk(sr)(1.6);
  for (let k = 0; k < 6; k++) {
    const t = 0.05 + k * 0.2 + rng() * 0.05;
    const f = 2600 + rng() * 800;
    addTone(s, { t, dur: 0.1, f0: f, f1: f * 1.35, pitchTau: 0.03, decay: 0.05, gain: 0.5, vibrato: { rate: 30, depth: 0.04 }, attack: 0.004 });
    addTone(s, { t: t + 0.07, dur: 0.08, f0: f * 1.25, f1: f * 0.9, pitchTau: 0.02, decay: 0.04, gain: 0.35, attack: 0.004 });
  }
  [2637, 3322, 3951].forEach((f, i) => addBell(s, { t: 0.1 + i * 0.09, f, tau: 0.25, gain: 0.35, bright: 0.3 }));
  return finalize(s, 0.35, 0, 0.1);
});

// ------------------------------------------------------------------ pombo

add('pomboFire', 3, (rng, sr, v) => {
  const m = [1, 1.12, 0.9][v];
  const s = mk(sr)(1.1);
  for (const [t, d] of [[0, 0.28], [0.34, 0.36]] as const) {
    addVoice(s, rng, {
      t, dur: d, pitch: [[0, 300 * m], [0.25, 430 * m], [1, 320 * m]],
      vowels: [[0, VOWELS.u], [1, VOWELS.o]], amp: [[0, 0], [0.2, 1], [0.8, 0.8], [1, 0]],
      breath: 0.12, vibrato: { rate: 22, depth: 0.04 }, jitter: 0.01,
    });
  }
  for (let k = 0; k < 9; k++) {
    addNoise(s, rng, { t: 0.15 + k * 0.07 + rng() * 0.02, dur: 0.06, attack: 0.012, decay: 0.02, gain: 0.35 + rng() * 0.2, filters: [{ type: 'bp', f: 700 + rng() * 700, q: 0.8 }] });
  }
  return finalize(s, 0.5, 0, 0.08);
});

add('pomboHit', 2, (rng, sr) => {
  const s = mk(sr)(0.3);
  for (let k = 0; k < 4; k++) addNoise(s, rng, { t: k * 0.045, dur: 0.06, attack: 0.012, decay: 0.02, gain: 0.5, filters: [{ type: 'bp', f: 900 + rng() * 600, q: 0.8 }] });
  addTone(s, { dur: 0.1, f0: 150, f1: 80, pitchTau: 0.015, decay: 0.04, gain: 0.5, attack: 0.002 });
  return finalize(s, 0.4, 0, 0.05);
});

// splat da cagada (status blind)
add('splat', 2, (rng, sr) => {
  const s = mk(sr)(0.4);
  addNoise(s, rng, { dur: 0.25, attack: 0.002, decay: 0.08, gain: 1, filters: [{ type: 'bp', f: 900, to: 300, q: 1, shape: 'fast' }] });
  addNoise(s, rng, { dur: 0.12, color: 'pink', attack: 0.001, decay: 0.05, gain: 0.8, filters: [{ type: 'lp', f: 1500 }] });
  addTone(s, { dur: 0.15, f0: 120, f1: 60, pitchTau: 0.02, decay: 0.06, gain: 0.8, attack: 0.001 });
  addTone(s, { t: 0.02, dur: 0.2, f0: 500, f1: 200, pitchTau: 0.06, decay: 0.08, gain: 0.3, vibrato: { rate: 25, depth: 0.1 }, attack: 0.003 });
  for (let k = 0; k < 4; k++) addTone(s, { t: 0.1 + rng() * 0.2, dur: 0.04, f0: 800 + rng() * 700, f1: 400, pitchTau: 0.01, decay: 0.012, gain: 0.2, attack: 0.001 });
  return finalize(s, 0.55, 1.2, 0.06);
});

// ------------------------------------------------------------------ chinelo

add('chineloFwip', 2, (rng, sr) => {
  const s = mk(sr)(1.5);
  for (let k = 0; k < 8; k++) {
    addNoise(s, rng, { t: k * 0.16, dur: 0.1, attack: 0.025, decay: 0.03, gain: 1, filters: [{ type: 'bp', f: 1200, to: 2600, q: 2, shape: 'lin' }] });
  }
  return finalize(s, 0.35, 0, 0.1);
});

add('plaft', 2, (rng, sr) => {
  const s = mk(sr)(0.28);
  addNoise(s, rng, { dur: 0.08, attack: 0.0004, decay: 0.012, gain: 1, filters: [{ type: 'bp', f: 2200, q: 0.8 }] });
  addNoise(s, rng, { dur: 0.04, attack: 0.0003, decay: 0.008, gain: 0.6, filters: [{ type: 'hp', f: 5000 }] });
  addTone(s, { dur: 0.15, f0: 220, f1: 120, pitchTau: 0.01, decay: 0.04, gain: 0.8, attack: 0.0006 });
  addNoise(s, rng, { t: 0.03, dur: 0.05, attack: 0.0004, decay: 0.01, gain: 0.35, filters: [{ type: 'bp', f: 1800, q: 1 }] });
  return finalize(s, 0.7, 1.5, 0.04);
});

// ------------------------------------------------------------------ coxinha

add('plop', 3, (rng, sr) => {
  const s = mk(sr)(0.14);
  addTone(s, { dur: 0.1, f0: jit(rng, 220, 0.15), f1: 700, pitchTau: 0.02, decay: 0.035, gain: 1, attack: 0.001 });
  addNoise(s, rng, { dur: 0.05, attack: 0.001, decay: 0.02, gain: 0.3, filters: [{ type: 'lp', f: 600 }] });
  return finalize(s, 0.4, 0, 0.03);
});

add('plopGun', 1, (rng, sr) => {
  const s = mk(sr)(0.32);
  addTone(s, { dur: 0.25, f0: 140, f1: 60, pitchTau: 0.025, decay: 0.08, gain: 1, attack: 0.001 });
  addNoise(s, rng, { dur: 0.15, color: 'pink', attack: 0.002, decay: 0.04, gain: 0.8, filters: [{ type: 'lp', f: 1800, to: 500, shape: 'fast' }] });
  addTone(s, { dur: 0.12, f0: 180, f1: 480, pitchTau: 0.03, decay: 0.04, gain: 0.4, attack: 0.002 });
  return finalize(s, 0.6, 1.3, 0.05);
});

// ------------------------------------------------------------------ panela e dolly

add('hissPanela', 2, (rng, sr) => {
  const s = mk(sr)(0.34);
  addNoise(s, rng, { dur: 0.32, attack: 0.02, decay: 0.12, gain: 1, filters: [{ type: 'hp', f: 3000 }, { type: 'bp', f: 7000, q: 0.6 }] });
  addTone(s, { t: 0.01, dur: 0.15, f0: 1300, decay: 0.05, gain: 0.05, vibrato: { rate: 30, depth: 0.03 }, attack: 0.004 });
  return finalize(s, 0.35, 0, 0.05);
});

add('hissBottle', 2, (rng, sr) => {
  const s = mk(sr)(0.3);
  addNoise(s, rng, { dur: 0.1, color: 'pink', attack: 0.01, decay: 0.04, gain: 0.5, filters: [{ type: 'lp', f: 900 }] });
  for (let k = 0; k < 3; k++) addNoise(s, rng, { t: 0.02 + k * 0.07, dur: 0.07, attack: 0.008, decay: 0.025, gain: 0.7, filters: [{ type: 'hp', f: 5000 }, { type: 'bp', f: 9000, q: 0.7 }] });
  return finalize(s, 0.3, 0, 0.05);
});

// "FSSHHH-BOOM!" da Dolly
add('dollyBoom', 1, (rng, sr) => {
  const s = mk(sr)(2.2);
  addNoise(s, rng, { dur: 0.3, attack: 0.18, decay: 0.2, gain: 0.7, filters: [{ type: 'hp', f: 2000 }] });
  const t = 0.2;
  addTone(s, { t, dur: 1.0, f0: 90, f1: 32, pitchTau: 0.07, decay: 0.3, gain: 1.4, attack: 0.002 });
  addNoise(s, rng, { t, dur: 0.12, attack: 0.0005, decay: 0.02, gain: 1, filters: [{ type: 'hp', f: 1000 }] });
  addNoise(s, rng, { t, dur: 0.8, color: 'pink', attack: 0.001, decay: 0.15, gain: 1, filters: [{ type: 'lp', f: 4000, to: 300, shape: 'fast' }] });
  addNoise(s, rng, { t: t + 0.05, dur: 1.6, attack: 0.02, decay: 0.5, gain: 0.35, filters: [{ type: 'hp', f: 4000 }] });
  for (let k = 0; k < 22; k++) addTone(s, { t: t + 0.1 + rng() * 1.3, dur: 0.03, f0: 1500 + rng() * 2000, f1: 700, pitchTau: 0.005, decay: 0.008, gain: 0.15, attack: 0.0004 });
  addEchoes(s, 0.5, [{ d: 0.22, g: 0.25, lp: 1800 }, { d: 0.5, g: 0.14, lp: 1200 }]);
  return finalize(s, 0.95, 2, 0.1);
});

// "PSSSHHH-BANG!" da panela (o chiado vem dos eventos special:hiss)
add('panelaBang', 1, (rng, sr) => {
  const s = mk(sr)(1.9);
  addTone(s, { dur: 0.9, f0: 100, f1: 38, pitchTau: 0.05, decay: 0.22, gain: 1.3, attack: 0.002 });
  addNoise(s, rng, { dur: 0.1, attack: 0.0004, decay: 0.014, gain: 1.2, filters: [{ type: 'hp', f: 1500 }] });
  addNoise(s, rng, { dur: 0.6, color: 'pink', attack: 0.001, decay: 0.12, gain: 1.1, filters: [{ type: 'lp', f: 3500, to: 400, shape: 'fast' }] });
  addBell(s, { t: 0.01, f: 520, tau: 0.35, gain: 0.6 });
  addBell(s, { t: 0.01, f: 780, tau: 0.25, gain: 0.4 });
  for (let k = 0; k < 25; k++) addNoise(s, rng, { t: 0.05 + rng() * 0.6, dur: 0.02, attack: 0.0004, decay: 0.005, gain: 0.2 + rng() * 0.2, filters: [{ type: 'bp', f: 2000 + rng() * 3000, q: 1 }] });
  addEchoes(s, 0.4, [{ d: 0.2, g: 0.3, lp: 1800 }, { d: 0.5, g: 0.18, lp: 1200 }]);
  return finalize(s, 0.95, 2.2, 0.1);
});

add('clang', 2, (rng, sr) => {
  const s = mk(sr)(0.7);
  addBell(s, { f: jit(rng, 600, 0.1), tau: 0.18, gain: 1 });
  addTone(s, { dur: 0.1, f0: 200, f1: 100, pitchTau: 0.01, decay: 0.03, gain: 0.6, attack: 0.0008 });
  return finalize(s, 0.5, 0, 0.1);
});

// ------------------------------------------------------------------ status

add('burn', 2, (rng, sr) => {
  const s = mk(sr)(1.0);
  addNoise(s, rng, { dur: 0.9, color: 'brown', attack: 0.05, decay: 0.3, gain: 0.6, filters: [{ type: 'lp', f: 600 }] });
  addNoise(s, rng, { dur: 0.8, color: 'pink', attack: 0.06, decay: 0.25, gain: 0.5, filters: [{ type: 'lp', f: 1500 }] });
  for (let k = 0; k < 28; k++) addNoise(s, rng, { t: rng() * 0.8, dur: 0.02, attack: 0.0004, decay: 0.004, gain: 0.2 + rng() * 0.8, filters: [{ type: 'hp', f: 2500 }] });
  return finalize(s, 0.35, 0, 0.15);
});

add('zap', 2, (rng, sr) => {
  const s = mk(sr)(0.55);
  addTone(s, { dur: 0.3, wave: 'saw', f0: 1800, f1: 200, pitchTau: 0.05, decay: 0.12, gain: 0.8, lp: 6000, attack: 0.0005 });
  addTone(s, { dur: 0.3, wave: 'square', f0: 2200, f1: 300, pitchTau: 0.04, decay: 0.1, gain: 0.4, lp: 6000, attack: 0.0005 });
  addNoise(s, rng, { dur: 0.25, attack: 0.0008, decay: 0.06, gain: 1, filters: [{ type: 'hp', f: 2000 }] });
  addTone(s, { dur: 0.3, f0: 120, f1: 60, pitchTau: 0.04, decay: 0.08, gain: 0.7, attack: 0.001 });
  for (let k = 0; k < 14; k++) addNoise(s, rng, { t: 0.05 + rng() * 0.4, dur: 0.012, attack: 0.0003, decay: 0.003, gain: 0.3 + rng() * 0.5, filters: [{ type: 'hp', f: 3000 }] });
  return finalize(s, 0.6, 1.5, 0.08);
});

add('zapCrack', 3, (rng, sr) => {
  const s = mk(sr)(0.09);
  addNoise(s, rng, { dur: 0.06, attack: 0.0003, decay: 0.012, gain: 1, filters: [{ type: 'hp', f: 3000 }] });
  addTone(s, { dur: 0.05, f0: jit(rng, 2500, 0.2), f1: 900, pitchTau: 0.01, decay: 0.015, gain: 0.5, attack: 0.0004 });
  return finalize(s, 0.3, 0, 0.02);
});

// ------------------------------------------------------------------ pickups

add('pickup', 1, (rng, sr) => {
  const s = mk(sr)(0.6);
  [659.25, 880, 1174.7].forEach((f, i) => {
    addTone(s, { t: i * 0.07, dur: 0.12, wave: 'square', width: 0.25, f0: f, decay: i === 2 ? 0.15 : 0.06, gain: 0.5, lp: 5000, attack: 0.002 });
    addTone(s, { t: i * 0.07, dur: 0.12, wave: 'tri', f0: f / 2, decay: 0.08, gain: 0.35, attack: 0.002 });
  });
  addBell(s, { t: 0.14, f: 2349, tau: 0.22, gain: 0.5 });
  return finalize(s, 0.4, 0, 0.08);
});

add('spawn', 1, (rng, sr) => {
  const s = mk(sr)(0.9);
  [3951, 4699, 5274].forEach((f, i) => addBell(s, { t: i * 0.06, f, tau: 0.2, gain: 0.5, bright: 0.2 }));
  addTone(s, { dur: 0.5, f0: 1500, f1: 3000, pitchTau: 0.25, decay: 0.2, gain: 0.15, attack: 0.1 });
  return finalize(s, 0.15, 0, 0.15);
});
