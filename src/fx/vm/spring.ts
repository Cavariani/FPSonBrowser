import { Vector3 } from 'three';

/** Mola amortecida 3D (Euler semi-implícito com substeps para ser estável com dt grande). */
export class Spring3 {
  readonly x = new Vector3();
  readonly v = new Vector3();
  k = 200;
  c = 20;

  step(dt: number, target?: Vector3): void {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    const tx = target ? target.x : 0, ty = target ? target.y : 0, tz = target ? target.z : 0;
    for (let i = 0; i < n; i++) {
      this.v.x += (-this.k * (this.x.x - tx) - this.c * this.v.x) * h;
      this.v.y += (-this.k * (this.x.y - ty) - this.c * this.v.y) * h;
      this.v.z += (-this.k * (this.x.z - tz) - this.c * this.v.z) * h;
      this.x.x += this.v.x * h;
      this.x.y += this.v.y * h;
      this.x.z += this.v.z * h;
    }
  }

  /** Impulso que gera um pico de deslocamento aproximado de `amount` (independe de k). */
  kick(ax: number, ay: number, az: number): void {
    const w = Math.sqrt(this.k) * 1.6;
    this.v.x += ax * w;
    this.v.y += ay * w;
    this.v.z += az * w;
  }

  reset(): void {
    this.x.set(0, 0, 0);
    this.v.set(0, 0, 0);
  }
}

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
/** Progresso de u dentro de [a,b], suavizado. */
export const seg = (u: number, a: number, b: number) => smooth((u - a) / (b - a));
export const easeOutBack = (t: number) => {
  t = clamp01(t);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Sobe rápido e volta (0→1→0) dentro de [a,b] com pico em `peak` (fração). */
export const pulse = (u: number, a: number, b: number, peak = 0.3) => {
  if (u <= a || u >= b) return 0;
  const t = (u - a) / (b - a);
  return t < peak ? smooth(t / peak) : 1 - smooth((t - peak) / (1 - peak));
};
