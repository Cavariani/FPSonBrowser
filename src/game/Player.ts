import { Vector3 } from 'three';
import { bus } from '../core/events';
import type { Body, World } from './World';

export interface MoveInput {
  forward: number;
  right: number;
  jump: boolean;
  crouch: boolean;
  /** Shift: corre (só pra frente, em pé). */
  sprint: boolean;
  speedMult: number;
}

// Unidades em metros/segundo. Inspirado no movimento Quake/Source (aceleração + fricção + air strafe).
export const MOVE = {
  maxSpeed: 6.2,
  groundAccel: 11,
  airAccel: 60,
  airCap: 0.85,
  friction: 6.5,
  stopSpeed: 1.6,
  jumpVel: 6.9,
  gravity: 20,
  crouchMult: 0.42,
  sprintMult: 1.33,
  standHeight: 1.8,
  crouchHeight: 1.2,
  standEye: 1.62,
  crouchEye: 1.05,
  halfWidth: 0.3,
  stepHeight: 0.45,
  // Slide: correndo + agachar
  slideTime: 0.9,
  slideBoost: 3.2,
  slideMinSpeed: 9.5,
  slideFriction: 0.9,
  // Bunny hop: cada pulo emendado (tocou o chão e pulou de novo rápido) acelera
  bhopWindow: 0.14,
  bhopGain: 1.1,
  bhopMax: 32,
};

/** Controlador do jogador local, rodando em tick fixo. */
export class Player {
  readonly body: Body = {
    pos: new Vector3(),
    vel: new Vector3(),
    hw: MOVE.halfWidth,
    height: MOVE.standHeight,
    grounded: false,
    stepHeight: MOVE.stepHeight,
  };
  readonly prevPos = new Vector3();
  yaw = 0;
  pitch = 0;
  crouched = false;
  sprinting = false;
  /** Altura do olho suavizada (anima o agachar). */
  eye = MOVE.standEye;
  prevEye = MOVE.standEye;
  /** Offset para suavizar subida de degrau na câmera. */
  stepSmooth = 0;
  private stepDist = 0;
  private fallSpeed = 0;
  /** Tempo restante de slide (s). */
  slideT = 0;
  /** Pulos emendados seguidos (bunny hop). */
  bhopChain = 0;
  private groundTime = 0;
  private prevCrouchWant = false;

  get sliding(): boolean {
    return this.slideT > 0;
  }

  constructor(private world: World) {}

  get pos(): Vector3 {
    return this.body.pos;
  }

  get grounded(): boolean {
    return this.body.grounded;
  }

  get speed(): number {
    return Math.hypot(this.body.vel.x, this.body.vel.z);
  }

  teleport(p: Vector3, yaw: number): void {
    this.body.pos.copy(p);
    this.prevPos.copy(p);
    this.body.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.crouched = false;
    this.body.height = MOVE.standHeight;
    this.eye = this.prevEye = MOVE.standEye;
    this.stepSmooth = 0;
    this.body.grounded = false;
    this.fallSpeed = 0;
    this.stepDist = 0;
    this.sprinting = false;
    this.slideT = 0;
    this.bhopChain = 0;
    this.groundTime = 0;
  }

  tick(dt: number, inp: MoveInput): void {
    const b = this.body;
    this.prevPos.copy(b.pos);
    this.prevEye = this.eye;

    const wasSprinting = this.sprinting;
    const crouchPressed = inp.crouch && !this.prevCrouchWant;
    this.prevCrouchWant = inp.crouch;
    this.groundTime = b.grounded ? this.groundTime + dt : 0;
    if (this.groundTime > 0.3) this.bhopChain = 0;

    this.updateCrouch(inp.crouch);

    // Slide: estava correndo no chão e apertou agachar
    if (crouchPressed && this.crouched && b.grounded && wasSprinting && this.speed > 5 && this.slideT <= 0) {
      const spd = this.speed;
      const target = Math.min(MOVE.bhopMax, Math.max(spd + MOVE.slideBoost, MOVE.slideMinSpeed));
      b.vel.x *= target / spd;
      b.vel.z *= target / spd;
      this.slideT = MOVE.slideTime;
      bus.emit('player:slide', {});
    }
    if (this.slideT > 0) {
      this.slideT -= dt;
      if (!inp.crouch || this.speed < 3) this.slideT = 0;
    }

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
    let wx = -sy * inp.forward + cy * inp.right;
    let wz = -cy * inp.forward - sy * inp.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    this.sprinting = inp.sprint && inp.forward > 0 && !this.crouched;
    let wishSpeed = MOVE.maxSpeed * inp.speedMult;
    if (this.crouched) wishSpeed *= MOVE.crouchMult;
    else if (this.sprinting) wishSpeed *= MOVE.sprintMult;
    if (wl === 0) wishSpeed = 0;

    if (b.grounded) {
      if (inp.jump && !this.crouchBlocked()) {
        // Pulo emendado logo depois de tocar o chão = bunny hop: ganha velocidade a cada um
        const spd = this.speed;
        if (this.groundTime <= MOVE.bhopWindow && spd > 3) {
          this.bhopChain++;
          const target = Math.min(MOVE.bhopMax, Math.max(spd, wishSpeed) * MOVE.bhopGain);
          b.vel.x *= target / spd;
          b.vel.z *= target / spd;
        }
        b.vel.y = MOVE.jumpVel;
        b.grounded = false;
        this.slideT = 0;
        bus.emit('player:jump', {});
      } else if (this.slideT > 0) {
        // deslizando: quase sem atrito, só um pouco de controle
        this.applyFriction(dt, MOVE.slideFriction);
        this.accelerate(wx, wz, Math.min(wishSpeed, 1.5), MOVE.groundAccel, dt);
      } else {
        this.applyFriction(dt);
      }
      if (this.slideT <= 0) this.accelerate(wx, wz, wishSpeed, MOVE.groundAccel, dt);
    } else {
      this.accelerate(wx, wz, Math.min(wishSpeed, MOVE.airCap), MOVE.airAccel, dt);
    }

    b.vel.y -= MOVE.gravity * dt;
    const wasGrounded = b.grounded;
    const fallVel = b.vel.y;
    const stepped = this.world.moveBody(b, dt);
    if (stepped !== 0) this.stepSmooth -= stepped;

    if (!wasGrounded && b.grounded) {
      bus.emit('player:land', { impact: Math.max(0, -this.fallSpeed) });
    }
    this.fallSpeed = b.grounded ? 0 : fallVel;

    // Passos
    const spd = this.speed;
    if (b.grounded && spd > 2.5 && !this.crouched) {
      this.stepDist += spd * dt;
      if (this.stepDist > (this.sprinting ? 2.6 : 2.1)) {
        this.stepDist = 0;
        bus.emit('player:footstep', { speed: spd });
      }
    }

    // Anima olho e degrau
    const targetEye = this.crouched ? MOVE.crouchEye : MOVE.standEye;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 14);
    this.stepSmooth *= Math.exp(-dt * 14);

    // Rede de segurança: caiu do mapa
    if (b.pos.y < -30) b.pos.set(0, 2, 0);
  }

  private crouchBlocked(): boolean {
    return false;
  }

  private updateCrouch(want: boolean): void {
    const b = this.body;
    if (want && !this.crouched) {
      this.crouched = true;
      b.height = MOVE.crouchHeight;
      // Agachar no ar puxa as pernas: dá pra subir em caixa mais alta (crouch-jump).
      if (!b.grounded) {
        const dh = MOVE.standHeight - MOVE.crouchHeight;
        b.pos.y += dh;
        if (!this.world.fits(b)) b.pos.y -= dh;
        else { this.prevPos.y += dh; this.eye -= dh; this.prevEye -= dh; }
      }
    } else if (!want && this.crouched) {
      b.height = MOVE.standHeight;
      const dh = MOVE.standHeight - MOVE.crouchHeight;
      if (!b.grounded) {
        // No ar, espelha o agachar: as pernas descem (a cabeça fica no lugar).
        // Sem isso, agachar/levantar repetido no ar ganhava 0.6 m por ciclo.
        b.pos.y -= dh;
        if (this.world.fits(b)) {
          this.crouched = false;
          this.prevPos.y -= dh; this.eye += dh; this.prevEye += dh;
          return;
        }
        b.pos.y += dh;
      }
      if (this.world.fits(b)) this.crouched = false;
      else b.height = MOVE.crouchHeight;
    }
  }

  private applyFriction(dt: number, friction = MOVE.friction): void {
    const v = this.body.vel;
    const speed = Math.hypot(v.x, v.z);
    if (speed < 0.01) { v.x = 0; v.z = 0; return; }
    const drop = Math.max(speed, MOVE.stopSpeed) * friction * dt;
    const k = Math.max(speed - drop, 0) / speed;
    v.x *= k;
    v.z *= k;
  }

  private accelerate(dx: number, dz: number, wishSpeed: number, accel: number, dt: number): void {
    if (wishSpeed <= 0) return;
    const v = this.body.vel;
    const current = v.x * dx + v.z * dz;
    const add = wishSpeed - current;
    if (add <= 0) return;
    const accelSpeed = Math.min(accel * dt * Math.max(wishSpeed, 1), add);
    v.x += dx * accelSpeed;
    v.z += dz * accelSpeed;
  }
}
