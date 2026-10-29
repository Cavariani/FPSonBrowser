/** Tremor (trauma²), punch de FOV, "afundada" ao aterrissar e inclinação ao tomar dano. */
export class CameraFX {
  private trauma = 0;
  private fovPunch = 0;
  private dip = 0;
  private dipVel = 0;
  private roll = 0;
  private t = 0;

  // Saídas (rad / metros / graus)
  pitch = 0;
  yaw = 0;
  rollOut = 0;
  offsetY = 0;
  fovAdd = 0;

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  punchFov(deg: number): void {
    this.fovPunch += deg;
  }

  land(impact: number): void {
    this.dipVel -= Math.min(impact, 16) * 0.12;
  }

  hurt(side: number, amount: number): void {
    this.roll += side * Math.min(0.08, amount * 0.0025);
    this.addTrauma(Math.min(0.45, amount * 0.012));
  }

  update(dt: number): void {
    this.t += dt;
    const s = this.trauma * this.trauma;
    const n = (f: number, o: number) => Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.13 + o * 1.7) * 0.4;
    this.pitch = s * 0.05 * n(37, 0);
    this.yaw = s * 0.05 * n(41, 3.1);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);

    // mola criticamente amortecida
    this.dipVel += (-90 * this.dip - 14 * this.dipVel) * dt;
    this.dip += this.dipVel * dt;
    this.offsetY = this.dip;

    this.fovPunch *= Math.exp(-dt * 12);
    this.fovAdd = this.fovPunch;

    this.roll *= Math.exp(-dt * 5);
    this.rollOut = this.roll + s * 0.03 * n(29, 5.3);
  }
}
