import {
  Sample, addNoise, addTone, addBell, addBrass, addVoice, addEchoes, finalize, Biquad, VOWELS,
  type Rng,
} from './dsp';
import { SPECIAL_RECIPES } from './recipesSpecial';
import { SPECIAL2_RECIPES } from './recipesSpecial2';

/**
 * Receitas de síntese: cada uma gera os samples (mono) de um som.
 * O nível final de cada som já é definido aqui (argumento `peak` de `finalize`);
 * tiros ~0.7-1.0 (referência), cliques de arma ~0.3, passos ~0.15.
 */
export interface Recipe {
  name: string;
  variants: number;
  build: (rng: Rng, sr: number, v: number) => Float32Array;
}

const jit = (rng: Rng, x: number, r = 0.1) => x * (1 + (rng() * 2 - 1) * r);

// ------------------------------------------------------------------ tiros

interface GunCfg {
  dur: number;
  thump: { f0: number; f1: number; tau: number; decay: number; gain: number };
  mid?: { f0: number; f1: number; tau: number; decay: number; gain: number };
  crack: { hp: number; decay: number; gain: number };
  superCrack?: { f0: number; f1: number; gain: number };
  body: { lp0: number; lp1: number; decay: number; gain: number };
  tail: { lp: number; decay: number; gain: number; dur: number };
  echoes?: { d: number; g: number; lp: number }[];
  drive: number;
  peak: number;
}

function gun(rng: Rng, sr: number, c: GunCfg): Float32Array {
  const s = new Sample(sr, c.dur);
  const t = c.thump;
  addTone(s, { dur: c.dur, f0: jit(rng, t.f0), f1: t.f1, pitchTau: t.tau, decay: t.decay, gain: t.gain, attack: 0.0015 });
  if (c.mid) {
    const m = c.mid;
    addTone(s, { dur: 0.4, wave: 'tri', f0: jit(rng, m.f0), f1: m.f1, pitchTau: m.tau, decay: m.decay, gain: m.gain, attack: 0.001 });
  }
  addNoise(s, rng, { dur: 0.12, attack: 0.0004, decay: c.crack.decay, gain: c.crack.gain, filters: [{ type: 'hp', f: jit(rng, c.crack.hp) }] });
  if (c.superCrack) {
    const k = c.superCrack;
    addTone(s, { dur: 0.1, f0: k.f0, f1: k.f1, pitchTau: 0.012, decay: 0.02, gain: k.gain, attack: 0.0004 });
  }
  addNoise(s, rng, {
    dur: Math.min(c.dur, 1.2), color: 'pink', attack: 0.0006, decay: c.body.decay, gain: c.body.gain,
    filters: [{ type: 'lp', f: jit(rng, c.body.lp0), to: c.body.lp1, shape: 'fast' }],
  });
  addNoise(s, rng, {
    dur: c.tail.dur, color: 'brown', attack: 0.004, decay: c.tail.decay, gain: c.tail.gain,
    filters: [{ type: 'lp', f: c.tail.lp }],
  });
  if (c.echoes) addEchoes(s, Math.min(0.45, c.dur * 0.4), c.echoes);
  return finalize(s, c.peak, c.drive, 0.03);
}

const GUNS: Record<string, { variants: number; cfg: GunCfg }> = {
  shot_smg: {
    variants: 3,
    cfg: {
      dur: 0.26,
      thump: { f0: 170, f1: 62, tau: 0.018, decay: 0.06, gain: 0.9 },
      crack: { hp: 2200, decay: 0.009, gain: 1.0 },
      body: { lp0: 3500, lp1: 700, decay: 0.045, gain: 0.9 },
      tail: { lp: 800, decay: 0.1, gain: 0.35, dur: 0.26 },
      drive: 1.8, peak: 0.78,
    },
  },
  shot_rifle: {
    variants: 3,
    cfg: {
      dur: 0.8,
      thump: { f0: 120, f1: 45, tau: 0.03, decay: 0.12, gain: 1.1 },
      mid: { f0: 260, f1: 110, tau: 0.02, decay: 0.05, gain: 0.35 },
      crack: { hp: 1800, decay: 0.012, gain: 1.0 },
      body: { lp0: 3000, lp1: 500, decay: 0.09, gain: 1.0 },
      tail: { lp: 600, decay: 0.28, gain: 0.45, dur: 0.7 },
      echoes: [{ d: 0.16, g: 0.28, lp: 2200 }, { d: 0.38, g: 0.14, lp: 1400 }],
      drive: 2.0, peak: 0.88,
    },
  },
  shot_shotgun: {
    variants: 2,
    cfg: {
      dur: 1.8,
      thump: { f0: 85, f1: 30, tau: 0.07, decay: 0.28, gain: 1.3 },
      mid: { f0: 200, f1: 70, tau: 0.04, decay: 0.1, gain: 0.5 },
      crack: { hp: 1200, decay: 0.02, gain: 1.1 },
      body: { lp0: 4000, lp1: 350, decay: 0.17, gain: 1.2 },
      tail: { lp: 500, decay: 0.55, gain: 0.6, dur: 1.4 },
      echoes: [{ d: 0.2, g: 0.38, lp: 1800 }, { d: 0.45, g: 0.24, lp: 1200 }, { d: 0.85, g: 0.12, lp: 900 }],
      drive: 2.4, peak: 0.95,
    },
  },
  shot_sniper: {
    variants: 2,
    cfg: {
      dur: 3.2,
      thump: { f0: 75, f1: 27, tau: 0.09, decay: 0.45, gain: 1.3 },
      crack: { hp: 1500, decay: 0.016, gain: 1.2 },
      superCrack: { f0: 2600, f1: 500, gain: 0.5 },
      body: { lp0: 5000, lp1: 400, decay: 0.14, gain: 1.1 },
      tail: { lp: 450, decay: 0.9, gain: 0.55, dur: 1.6 },
      echoes: [{ d: 0.32, g: 0.42, lp: 2000 }, { d: 0.7, g: 0.3, lp: 1500 }, { d: 1.2, g: 0.2, lp: 1100 }, { d: 1.9, g: 0.11, lp: 900 }],
      drive: 2.2, peak: 1.0,
    },
  },
  shot_pistol: {
    variants: 3,
    cfg: {
      dur: 0.45,
      thump: { f0: 190, f1: 75, tau: 0.014, decay: 0.05, gain: 0.8 },
      crack: { hp: 2800, decay: 0.007, gain: 1.1 },
      body: { lp0: 4500, lp1: 1000, decay: 0.035, gain: 0.8 },
      tail: { lp: 900, decay: 0.14, gain: 0.3, dur: 0.4 },
      echoes: [{ d: 0.12, g: 0.2, lp: 2500 }],
      drive: 1.7, peak: 0.7,
    },
  },
};

// ------------------------------------------------------------------ peças mecânicas

type Mk = (dur: number) => Sample;

function rasp(s: Sample, rng: Rng, t: number, dur: number, f0: number, f1: number, gain: number): void {
  addNoise(s, rng, { t, dur, attack: 0.012, decay: dur * 0.6, gain, filters: [{ type: 'bp', f: f0, to: f1, q: 1.2, shape: 'lin' }] });
}

function clack(s: Sample, rng: Rng, t: number, f: number, gain: number, low = 160): void {
  addNoise(s, rng, { t, dur: 0.06, attack: 0.0005, decay: 0.014, gain, filters: [{ type: 'bp', f: jit(rng, f), q: 0.9 }] });
  addTone(s, { t, dur: 0.12, f0: low * 1.8, f1: low * 0.8, pitchTau: 0.02, decay: 0.04, gain: gain * 0.7, attack: 0.0008 });
  addTone(s, { t, dur: 0.1, f0: jit(rng, 2600, 0.15), decay: 0.03, gain: gain * 0.12, attack: 0.0005 });
}

function boltOpenAt(s: Sample, rng: Rng, t: number): void {
  rasp(s, rng, t, 0.09, 900, 2000, 0.5);
  clack(s, rng, t + 0.09, 1800, 1.0, 330);
}
function boltCloseAt(s: Sample, rng: Rng, t: number): void {
  rasp(s, rng, t, 0.06, 1800, 800, 0.4);
  clack(s, rng, t + 0.06, 1300, 1.0, 100);
  addNoise(s, rng, { t: t + 0.1, dur: 0.03, decay: 0.006, gain: 0.5, filters: [{ type: 'bp', f: 3000, q: 1 }] });
}

// ------------------------------------------------------------------ receitas

const mk = (sr: number): Mk => (dur) => new Sample(sr, dur);

export const RECIPES: Recipe[] = [];
const add = (name: string, variants: number, build: Recipe['build']) => RECIPES.push({ name, variants, build });

// --- Críticos primeiro (tiros e feedback de acerto)
for (const [name, g] of Object.entries(GUNS)) add(name, g.variants, (rng, sr) => gun(rng, sr, g.cfg));

add('tick', 2, (rng, sr) => {
  const s = mk(sr)(0.08);
  addTone(s, { dur: 0.08, f0: jit(rng, 2600, 0.04), f1: 1700, pitchTau: 0.01, decay: 0.014, gain: 1, attack: 0.0005 });
  addNoise(s, rng, { dur: 0.02, decay: 0.003, gain: 0.5, filters: [{ type: 'hp', f: 5000 }] });
  return finalize(s, 0.38, 0, 0.01);
});

add('ding', 1, (rng, sr) => {
  const s = mk(sr)(1.1);
  addBell(s, { f: 1760, tau: 0.32, gain: 1 });
  addBell(s, { f: 2640, tau: 0.25, gain: 0.5 });
  addTone(s, { dur: 0.15, f0: 220, f1: 90, pitchTau: 0.02, decay: 0.05, gain: 0.6, attack: 0.001 });
  return finalize(s, 0.55, 0, 0.05);
});

// Confirmação de kill: "thunk" grave encorpado + ding metálico
add('kill', 1, (rng, sr) => {
  const s = mk(sr)(0.9);
  addNoise(s, rng, { dur: 0.04, attack: 0.0004, decay: 0.006, gain: 0.7, filters: [{ type: 'bp', f: 3000, q: 1.2 }] });
  addTone(s, { dur: 0.3, f0: 170, f1: 55, pitchTau: 0.02, decay: 0.1, gain: 1.1, attack: 0.001 });
  addTone(s, { dur: 0.2, wave: 'tri', f0: 320, f1: 140, pitchTau: 0.015, decay: 0.05, gain: 0.35, attack: 0.001 });
  addBell(s, { t: 0.012, f: 1175, tau: 0.3, gain: 0.75 });
  addBell(s, { t: 0.012, f: 1760, tau: 0.22, gain: 0.35, bright: 0.6 });
  return finalize(s, 0.75, 1.3, 0.08);
});

add('footstep', 4, (rng, sr, v) => {
  const s = mk(sr)(0.17);
  addNoise(s, rng, {
    dur: 0.16, color: 'pink', attack: 0.007, decay: 0.05, gain: 1,
    filters: [{ type: 'lp', f: 550 + rng() * 300, to: 300, q: 0.7, shape: 'fast' }],
  });
  addNoise(s, rng, { t: 0.002, dur: 0.1, attack: 0.004, decay: 0.025, gain: 0.1, filters: [{ type: 'hp', f: 2800 }, { type: 'lp', f: 7000 }] });
  addTone(s, { dur: 0.1, f0: 95 + v * 4, f1: 55, pitchTau: 0.02, decay: 0.035, gain: 0.55, attack: 0.003 });
  return finalize(s, 0.2, 0, 0.03);
});

add('dryfire', 1, (rng, sr) => {
  const s = mk(sr)(0.07);
  addNoise(s, rng, { dur: 0.03, attack: 0.0005, decay: 0.004, gain: 1, filters: [{ type: 'bp', f: 3200, q: 2 }] });
  addTone(s, { dur: 0.03, f0: 1900, f1: 1500, pitchTau: 0.01, decay: 0.005, gain: 0.4, attack: 0.0005 });
  addNoise(s, rng, { t: 0.02, dur: 0.02, attack: 0.0005, decay: 0.003, gain: 0.5, filters: [{ type: 'bp', f: 2200, q: 2 }] });
  return finalize(s, 0.3, 0, 0.015);
});

// --- Mecânica de arma
add('magOut', 2, (rng, sr) => {
  const s = mk(sr)(0.2);
  addNoise(s, rng, { dur: 0.08, attack: 0.001, decay: 0.02, gain: 1, filters: [{ type: 'bp', f: jit(rng, 1400), q: 1.5 }] });
  addTone(s, { dur: 0.1, f0: 650, f1: 380, pitchTau: 0.02, decay: 0.03, gain: 0.4, attack: 0.001 });
  addNoise(s, rng, { t: 0.05, dur: 0.03, attack: 0.0005, decay: 0.008, gain: 0.4, filters: [{ type: 'hp', f: 2500 }] });
  return finalize(s, 0.32, 0, 0.03);
});

add('magIn', 2, (rng, sr) => {
  const s = mk(sr)(0.24);
  addTone(s, { dur: 0.12, f0: 230, f1: 110, pitchTau: 0.012, decay: 0.04, gain: 1, attack: 0.001 });
  addNoise(s, rng, { dur: 0.06, attack: 0.0005, decay: 0.012, gain: 0.8, filters: [{ type: 'bp', f: jit(rng, 2200), q: 1 }] });
  addNoise(s, rng, { t: 0.035, dur: 0.03, attack: 0.0005, decay: 0.004, gain: 0.6, filters: [{ type: 'bp', f: 3500, q: 1 }] });
  return finalize(s, 0.38, 0, 0.03);
});

add('charge', 2, (rng, sr) => {
  const s = mk(sr)(0.3);
  rasp(s, rng, 0, 0.07, 700, 2600, 0.6);
  clack(s, rng, 0.075, 1500, 1.0, 170);
  clack(s, rng, 0.15, 1200, 0.45, 150);
  return finalize(s, 0.38, 0, 0.04);
});

add('pump', 2, (rng, sr) => {
  const s = mk(sr)(0.5);
  clack(s, rng, 0, 1100, 1.0, 140);
  rasp(s, rng, 0.05, 0.07, 600, 1500, 0.3);
  clack(s, rng, 0.14, 1400, 1.0, 170);
  return finalize(s, 0.5, 0, 0.05);
});

add('bolt', 1, (rng, sr) => {
  const s = mk(sr)(0.65);
  boltOpenAt(s, rng, 0);
  boltCloseAt(s, rng, 0.26);
  return finalize(s, 0.42, 0, 0.05);
});
add('boltOpen', 1, (rng, sr) => { const s = mk(sr)(0.3); boltOpenAt(s, rng, 0); return finalize(s, 0.4, 0, 0.04); });
add('boltClose', 1, (rng, sr) => { const s = mk(sr)(0.3); boltCloseAt(s, rng, 0); return finalize(s, 0.4, 0, 0.04); });

add('shellIn', 3, (rng, sr) => {
  const s = mk(sr)(0.16);
  addTone(s, { dur: 0.1, f0: 300, f1: 200, pitchTau: 0.01, decay: 0.015, gain: 0.6, attack: 0.0008 });
  addTone(s, { dur: 0.1, f0: jit(rng, 3100, 0.05), decay: 0.02, gain: 0.5, attack: 0.0005 });
  addTone(s, { dur: 0.08, f0: jit(rng, 4300, 0.05), decay: 0.015, gain: 0.3, attack: 0.0005 });
  addNoise(s, rng, { dur: 0.03, attack: 0.0005, decay: 0.006, gain: 0.5, filters: [{ type: 'bp', f: 2500, q: 1 }] });
  return finalize(s, 0.3, 0, 0.03);
});

add('switch', 2, (rng, sr) => {
  const s = mk(sr)(0.24);
  addNoise(s, rng, { dur: 0.1, attack: 0.03, decay: 0.05, gain: 0.6, filters: [{ type: 'bp', f: 500, to: 1800, q: 1, shape: 'lin' }] });
  addNoise(s, rng, { t: 0.09, dur: 0.04, attack: 0.0005, decay: 0.006, gain: 0.8, filters: [{ type: 'bp', f: 2000, q: 1 }] });
  addTone(s, { t: 0.09, dur: 0.06, f0: 400, f1: 250, pitchTau: 0.01, decay: 0.02, gain: 0.4, attack: 0.001 });
  return finalize(s, 0.28, 0, 0.04);
});

add('zoomIn', 1, (rng, sr) => {
  const s = mk(sr)(0.16);
  addNoise(s, rng, { dur: 0.03, attack: 0.0005, decay: 0.004, gain: 1, filters: [{ type: 'bp', f: 3500, q: 1.5 }] });
  addTone(s, { dur: 0.03, f0: 2200, decay: 0.006, gain: 0.3, attack: 0.0005 });
  addNoise(s, rng, { t: 0.01, dur: 0.06, attack: 0.01, decay: 0.03, gain: 0.25, filters: [{ type: 'bp', f: 1500, to: 3000, q: 1, shape: 'lin' }] });
  addNoise(s, rng, { t: 0.05, dur: 0.03, attack: 0.0005, decay: 0.004, gain: 0.7, filters: [{ type: 'bp', f: 3000, q: 1.5 }] });
  return finalize(s, 0.28, 0, 0.03);
});

add('zoomOut', 1, (rng, sr) => {
  const s = mk(sr)(0.12);
  addNoise(s, rng, { dur: 0.03, attack: 0.0005, decay: 0.005, gain: 1, filters: [{ type: 'bp', f: 2200, q: 1.5 }] });
  addTone(s, { dur: 0.03, f0: 1400, decay: 0.007, gain: 0.3, attack: 0.0005 });
  addNoise(s, rng, { t: 0.04, dur: 0.03, attack: 0.0005, decay: 0.004, gain: 0.6, filters: [{ type: 'bp', f: 1800, q: 1.5 }] });
  return finalize(s, 0.24, 0, 0.03);
});

// --- Grampeador
add('swing', 2, (rng, sr) => {
  const s = mk(sr)(0.3);
  addNoise(s, rng, { dur: 0.28, attack: 0.08, decay: 0.09, gain: 1, filters: [{ type: 'bp', f: jit(rng, 600), to: 2400, q: 1.0, shape: 'bell' }] });
  addNoise(s, rng, { t: 0.03, dur: 0.2, attack: 0.05, decay: 0.05, gain: 0.25, filters: [{ type: 'hp', f: 5000 }] });
  return finalize(s, 0.42, 0, 0.06);
});
add('swingHeavy', 1, (rng, sr) => {
  const s = mk(sr)(0.46);
  addNoise(s, rng, { dur: 0.44, attack: 0.13, decay: 0.13, gain: 1, filters: [{ type: 'bp', f: 350, to: 1400, q: 0.9, shape: 'bell' }] });
  addNoise(s, rng, { t: 0.05, dur: 0.3, color: 'brown', attack: 0.1, decay: 0.1, gain: 0.5, filters: [{ type: 'lp', f: 400 }] });
  return finalize(s, 0.5, 0, 0.08);
});

// Facada / corte
add('meleeHit', 2, (rng, sr) => {
  const s = mk(sr)(0.3);
  addTone(s, { dur: 0.2, f0: 160, f1: 65, pitchTau: 0.02, decay: 0.08, gain: 1, attack: 0.001 });
  addNoise(s, rng, { dur: 0.15, attack: 0.001, decay: 0.05, gain: 0.8, filters: [{ type: 'lp', f: 1100 }] });
  addNoise(s, rng, { t: 0.005, dur: 0.08, attack: 0.0005, decay: 0.025, gain: 0.7, filters: [{ type: 'bp', f: 3500, q: 1.4 }] });
  addTone(s, { t: 0.005, dur: 0.2, f0: jit(rng, 4300, 0.05), decay: 0.05, gain: 0.1, attack: 0.0005 });
  return finalize(s, 0.55, 1.3, 0.05);
});

// --- Movimento do jogador
add('land', 2, (rng, sr) => {
  const s = mk(sr)(0.42);
  addTone(s, { dur: 0.3, f0: 85, f1: 40, pitchTau: 0.04, decay: 0.1, gain: 1, attack: 0.002 });
  addNoise(s, rng, { dur: 0.3, color: 'pink', attack: 0.004, decay: 0.12, gain: 0.8, filters: [{ type: 'lp', f: 700, to: 300, shape: 'fast' }] });
  addNoise(s, rng, { t: 0.003, dur: 0.15, attack: 0.003, decay: 0.05, gain: 0.12, filters: [{ type: 'hp', f: 2500 }, { type: 'lp', f: 7000 }] });
  return finalize(s, 0.5, 0, 0.05);
});

add('jump', 2, (rng, sr) => {
  const s = mk(sr)(0.22);
  addNoise(s, rng, { dur: 0.2, color: 'pink', attack: 0.04, decay: 0.06, gain: 1, filters: [{ type: 'bp', f: 500, to: 900, q: 0.8, shape: 'lin' }] });
  addNoise(s, rng, { dur: 0.15, attack: 0.03, decay: 0.04, gain: 0.1, filters: [{ type: 'hp', f: 3000 }] });
  return finalize(s, 0.14, 0, 0.05);
});

// --- Vozes
add('hurtThump', 2, (rng, sr) => {
  const s = mk(sr)(0.32);
  addTone(s, { dur: 0.25, f0: 120, f1: 50, pitchTau: 0.035, decay: 0.1, gain: 1, attack: 0.002 });
  addNoise(s, rng, { dur: 0.2, color: 'pink', attack: 0.002, decay: 0.09, gain: 0.8, filters: [{ type: 'lp', f: 350 }] });
  return finalize(s, 0.6, 1.2, 0.05);
});

add('ugh', 3, (rng, sr, v) => {
  const m = [1, 1.1, 0.92][v];
  const s = mk(sr)(0.26);
  addVoice(s, rng, {
    dur: 0.24, pitch: [[0, 125 * m], [0.4, 115 * m], [1, 85 * m]],
    vowels: [[0, VOWELS.uh], [1, VOWELS.o]], amp: [[0, 0], [0.1, 1], [0.6, 0.7], [1, 0]],
    breath: 0.3, jitter: 0.015, drive: 1.3,
  });
  return finalize(s, 0.5, 0, 0.04);
});

/** Vozes dos outros: um grunhido curto de dor e um de morte por timbre (hash do actorId). */
export const VOICE_COUNT = 5;
const VOICE_PITCH = [0.8, 0.9, 1.0, 1.12, 1.28];

add('oof', VOICE_COUNT, (rng, sr, v) => {
  const m = VOICE_PITCH[v];
  const s = mk(sr)(0.22);
  addVoice(s, rng, {
    dur: 0.2, pitch: [[0, 160 * m], [0.3, 150 * m], [1, 105 * m]],
    vowels: [[0, VOWELS.uh], [1, VOWELS.o]], amp: [[0, 0], [0.12, 1], [0.5, 0.8], [1, 0]],
    breath: 0.35, jitter: 0.015, drive: 1.3,
  });
  return finalize(s, 0.45, 0, 0.04);
});

add('deathGrunt', VOICE_COUNT, (rng, sr, v) => {
  const m = VOICE_PITCH[v];
  const s = mk(sr)(0.5);
  addVoice(s, rng, {
    dur: 0.45, pitch: [[0, 175 * m], [0.25, 150 * m], [1, 80 * m]],
    vowels: [[0, VOWELS.o], [0.4, VOWELS.uh], [1, VOWELS.u]], amp: [[0, 0], [0.08, 1], [0.45, 0.8], [1, 0]],
    breath: 0.35, jitter: 0.02, drive: 1.4,
  });
  return finalize(s, 0.5, 0, 0.06);
});

add('bodyFall', 2, (rng, sr) => {
  const s = mk(sr)(0.5);
  addTone(s, { dur: 0.35, f0: 80, f1: 40, pitchTau: 0.04, decay: 0.1, gain: 1, attack: 0.002 });
  addNoise(s, rng, { dur: 0.4, color: 'pink', attack: 0.006, decay: 0.15, gain: 0.8, filters: [{ type: 'lp', f: 600 }] });
  addNoise(s, rng, { t: 0.04, dur: 0.2, attack: 0.02, decay: 0.07, gain: 0.15, filters: [{ type: 'bp', f: 3000, q: 0.6 }] });
  return finalize(s, 0.45, 0, 0.08);
});

// --- Impactos de bala (baixinhos)
const impact = (name: string, variants: number, peak: number, body: (s: Sample, rng: Rng, v: number) => void, dur: number) =>
  add(name, variants, (rng, sr, v) => {
    const s = mk(sr)(dur);
    body(s, rng, v);
    return finalize(s, peak, 0, 0.03);
  });

impact('impSand', 3, 0.22, (s, rng) => {
  addNoise(s, rng, { dur: 0.2, color: 'pink', attack: 0.004, decay: 0.06, gain: 1, filters: [{ type: 'lp', f: 1800, to: 500, shape: 'fast' }] });
  addTone(s, { dur: 0.08, f0: 120, decay: 0.04, gain: 0.3, attack: 0.002 });
}, 0.24);

impact('impStone', 3, 0.24, (s, rng) => {
  addNoise(s, rng, { dur: 0.04, attack: 0.0004, decay: 0.008, gain: 1, filters: [{ type: 'hp', f: 3000 }] });
  addNoise(s, rng, { dur: 0.1, attack: 0.0006, decay: 0.03, gain: 0.8, filters: [{ type: 'bp', f: jit(rng, 1800), q: 1 }] });
  addNoise(s, rng, { t: 0.01, dur: 0.18, color: 'pink', attack: 0.01, decay: 0.07, gain: 0.3, filters: [{ type: 'lp', f: 1500 }] });
  for (let k = 0; k < 3; k++) addTone(s, { t: 0.03 + rng() * 0.1, dur: 0.03, f0: 2500 + rng() * 2000, decay: 0.008, gain: 0.12, attack: 0.0005 });
}, 0.24);

impact('impWood', 3, 0.26, (s, rng) => {
  addTone(s, { dur: 0.12, f0: jit(rng, 320), f1: 180, pitchTau: 0.012, decay: 0.04, gain: 0.8, attack: 0.001 });
  addNoise(s, rng, { dur: 0.06, attack: 0.0006, decay: 0.02, gain: 1, filters: [{ type: 'bp', f: 1200, q: 2 }] });
  addTone(s, { dur: 0.2, f0: 110, decay: 0.07, gain: 0.5, attack: 0.002 });
}, 0.22);

impact('impMetal', 3, 0.26, (s, rng) => {
  addTone(s, { dur: 0.15, f0: jit(rng, 3000, 0.15), f1: 1800, pitchTau: 0.03, decay: 0.05, gain: 0.8, attack: 0.0005 });
  addNoise(s, rng, { dur: 0.04, attack: 0.0004, decay: 0.01, gain: 1, filters: [{ type: 'bp', f: 4000, q: 1.5 }] });
  addTone(s, { t: 0.005, dur: 0.3, f0: jit(rng, 2600, 0.2), f1: 900, pitchTau: 0.08, decay: 0.12, gain: 0.25, attack: 0.002 });
  addBell(s, { f: jit(rng, 1700, 0.2), tau: 0.08, gain: 0.3, bright: 0.5 });
}, 0.34);

impact('impGlass', 2, 0.24, (s, rng) => {
  for (const f of [4200, 5600, 7100]) addTone(s, { dur: 0.15, f0: jit(rng, f, 0.05), decay: 0.06, gain: 0.5, attack: 0.0005 });
  addNoise(s, rng, { dur: 0.04, attack: 0.0004, decay: 0.01, gain: 0.8, filters: [{ type: 'hp', f: 6000 }] });
  for (let k = 0; k < 8; k++) addTone(s, { t: 0.03 + rng() * 0.25, dur: 0.03, f0: 3500 + rng() * 4000, decay: 0.006, gain: 0.12 + rng() * 0.1, attack: 0.0004 });
}, 0.45);

impact('impCloth', 2, 0.18, (s, rng) => {
  addNoise(s, rng, { dur: 0.1, color: 'pink', attack: 0.005, decay: 0.04, gain: 1, filters: [{ type: 'lp', f: 600 }] });
  addTone(s, { dur: 0.1, f0: 90, decay: 0.05, gain: 0.5, attack: 0.002 });
}, 0.15);

impact('impFlesh', 3, 0.3, (s, rng) => {
  addNoise(s, rng, { dur: 0.12, attack: 0.001, decay: 0.035, gain: 1, filters: [{ type: 'lp', f: 1500, to: 400, shape: 'fast' }] });
  addTone(s, { dur: 0.12, f0: jit(rng, 200), f1: 90, pitchTau: 0.015, decay: 0.05, gain: 0.8, attack: 0.001 });
  addNoise(s, rng, { dur: 0.15, attack: 0.002, decay: 0.06, gain: 0.3, filters: [{ type: 'bp', f: 700, q: 3 }] });
}, 0.2);

// --- Jingles
add('levelUp', 1, (rng, sr) => {
  const s = mk(sr)(1.5);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    addTone(s, { t: i * 0.085, dur: 0.14, wave: 'square', width: 0.25, f0: f, decay: 0.08, gain: 0.5, lp: 5000, attack: 0.002 });
    addTone(s, { t: i * 0.085, dur: 0.14, wave: 'tri', f0: f / 2, decay: 0.08, gain: 0.4, attack: 0.002 });
  });
  for (const f of [1046.5, 1318.5, 1568]) {
    addTone(s, { t: 0.34, dur: 0.8, wave: 'square', width: 0.25, f0: f, decay: 0.3, gain: 0.3, lp: 5000, attack: 0.003 });
  }
  addBell(s, { t: 0.34, f: 2093, tau: 0.35, gain: 0.5 });
  return finalize(s, 0.5, 0, 0.1);
});

add('levelDown', 1, (rng, sr) => {
  const s = mk(sr)(0.9);
  for (const [f, t] of [[587.3, 0], [440, 0.14]] as const) {
    addTone(s, { t, dur: 0.5, wave: 'tri', f0: f, decay: t ? 0.2 : 0.09, gain: 0.8, lp: 2500, attack: 0.004 });
    addTone(s, { t, dur: 0.5, wave: 'saw', f0: f / 2, decay: t ? 0.2 : 0.09, gain: 0.15, lp: 900, attack: 0.004 });
  }
  return finalize(s, 0.42, 0, 0.1);
});

// Morte do jogador: impacto abafado + tom grave curto
add('deathHit', 1, (rng, sr) => {
  const s = mk(sr)(1.0);
  addTone(s, { dur: 0.6, f0: 95, f1: 38, pitchTau: 0.06, decay: 0.22, gain: 1.2, attack: 0.002 });
  addNoise(s, rng, { dur: 0.5, color: 'brown', attack: 0.003, decay: 0.15, gain: 0.8, filters: [{ type: 'lp', f: 320 }] });
  addTone(s, { t: 0.04, dur: 0.8, wave: 'tri', f0: 110, f1: 82, pitchTau: 0.3, decay: 0.3, gain: 0.45, lp: 450, attack: 0.02 });
  return finalize(s, 0.6, 1.3, 0.2);
});

add('fanfareWin', 1, (rng, sr) => {
  const s = mk(sr)(2.2);
  const b = { cutLo: 700, cutHi: 3500, cut: 'open' as const, q: 1.2, attack: 0.012, release: 0.04 };
  for (const t of [0, 0.17]) {
    for (const f of [261.6, 329.6, 392]) addBrass(s, { ...b, t, dur: 0.13, f0: f, gain: 0.4 });
  }
  for (const f of [261.6, 392, 523.25, 659.25]) {
    addBrass(s, { ...b, t: 0.36, dur: 1.5, f0: f, gain: 0.4, attack: 0.02, release: 0.3 });
  }
  addTone(s, { t: 0.36, dur: 0.5, f0: 110, f1: 55, pitchTau: 0.05, decay: 0.3, gain: 0.9, attack: 0.002 });
  addNoise(s, rng, { t: 0.36, dur: 1.2, attack: 0.002, decay: 0.5, gain: 0.15, filters: [{ type: 'hp', f: 5000 }] });
  return finalize(s, 0.6, 1.2, 0.2);
});

add('fanfareLose', 1, (rng, sr) => {
  const s = mk(sr)(1.8);
  const b = { cutLo: 250, cutHi: 1100, cut: 'close' as const, q: 1.4, attack: 0.03, release: 0.1 };
  for (const f of [220, 261.6, 329.6]) addBrass(s, { ...b, t: 0, dur: 0.5, f0: f, gain: 0.5 });
  for (const f of [196, 233.1, 293.7]) addBrass(s, { ...b, t: 0.5, dur: 1.2, f0: f, gain: 0.5, release: 0.4 });
  addTone(s, { t: 0.5, dur: 0.4, f0: 80, f1: 50, pitchTau: 0.08, decay: 0.2, gain: 0.7, attack: 0.003 });
  return finalize(s, 0.5, 1.1, 0.2);
});

add('respawn', 1, (rng, sr) => {
  const s = mk(sr)(1.0);
  addBell(s, { f: 1318.5, tau: 0.25, gain: 0.7 });
  addBell(s, { t: 0.22, f: 987.8, tau: 0.3, gain: 0.6 });
  return finalize(s, 0.3, 0, 0.1);
});

// Cheats de killstreak: bipes de terminal (notificação), ligar (varredura subindo) e desligar
add('cheatReady', 1, (rng, sr) => {
  const s = mk(sr)(0.5);
  addTone(s, { t: 0, dur: 0.09, f0: 1320, wave: 'square', gain: 0.5, decay: 0.2, attack: 0.002, lp: 5000 });
  addTone(s, { t: 0.11, dur: 0.09, f0: 1760, wave: 'square', gain: 0.5, decay: 0.2, attack: 0.002, lp: 5000 });
  addTone(s, { t: 0.22, dur: 0.18, f0: 2637, wave: 'square', gain: 0.45, decay: 0.12, attack: 0.002, lp: 5000 });
  return finalize(s, 0.28, 0, 0.05);
});

add('cheatOn', 1, (rng, sr) => {
  const s = mk(sr)(0.7);
  addTone(s, { dur: 0.3, f0: 220, f1: 1200, pitchTau: 0.09, wave: 'saw', gain: 0.5, decay: 0.25, attack: 0.004, lp: 4000 });
  addNoise(s, rng, { dur: 0.25, attack: 0.002, decay: 0.08, gain: 0.25, filters: [{ type: 'hp', f: 3000 }] });
  addTone(s, { t: 0.28, dur: 0.2, f0: 1760, wave: 'square', gain: 0.35, decay: 0.15, attack: 0.002, lp: 5000 });
  return finalize(s, 0.35, 0.3, 0.1);
});

add('cheatOff', 1, (rng, sr) => {
  const s = mk(sr)(0.4);
  addTone(s, { dur: 0.25, f0: 900, f1: 180, pitchTau: 0.07, wave: 'square', gain: 0.5, decay: 0.12, attack: 0.002, lp: 3500 });
  return finalize(s, 0.25, 0, 0.05);
});

add('matchStart', 1, (rng, sr) => {
  const s = mk(sr)(1.7);
  addBell(s, { f: 880, tau: 0.6, gain: 1 });
  addBell(s, { f: 1760, tau: 0.4, gain: 0.3 });
  return finalize(s, 0.4, 0, 0.15);
});

/** Vento de deserto, em loop sem emenda (8 s). Sem fade-out: o loop depende disso. */
add('wind', 1, (rng, sr) => {
  const L = Math.round(8 * sr), X = Math.round(0.6 * sr);
  const raw = new Float32Array(L + X);
  const lp = new Biquad(), bp = new Biquad();
  bp.set('bp', 900, 0.8, sr);
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    const gust = 0.55 + 0.3 * Math.sin((2 * Math.PI * t) / 8 + 1) + 0.15 * Math.sin((2 * Math.PI * 3 * t) / 8 + 2);
    if ((i & 63) === 0) lp.set('lp', 300 + 500 * gust, 0.7, sr);
    const w = rng() * 2 - 1;
    brown = (brown + 0.02 * w) / 1.02;
    raw[i] = (lp.process(brown * 3.5) + 0.12 * bp.process(w)) * gust;
  }
  const out = new Float32Array(L);
  let mx = 0;
  for (let i = 0; i < L; i++) {
    if (i < X) {
      const u = (i / X) * Math.PI * 0.5;
      out[i] = raw[i] * Math.sin(u) + raw[L + i] * Math.cos(u);
    } else out[i] = raw[i];
    mx = Math.max(mx, Math.abs(out[i]));
  }
  const k = mx > 0 ? 0.5 / mx : 0;
  for (let i = 0; i < L; i++) out[i] *= k;
  return out;
});

// Armas malucas (pickups)

RECIPES.push(...SPECIAL_RECIPES, ...SPECIAL2_RECIPES);
