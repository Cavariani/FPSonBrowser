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
  /** Noclip: sobe (+1) / desce (-1), e modo rápido. */
  flyUp?: number;
  flyFast?: boolean;
}

/** Noclip (cheat de 9 kills): velocidade de voo em m/s. */
const NOCLIP_SPEED = 12;
const NOCLIP_FAST = 24;
/** Direções (normalizadas) da busca de espaço livre ao sair do noclip; ordem = preferência em empate (cima primeiro). */
const FREE_DIRS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (const y of [1, 0, -1]) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (!x && !y && !z) continue;
    const l = Math.hypot(x, y, z);
    out.push([x / l, y / l, z / l]);
  }
  return out.sort((a, b) => b[1] - a[1] || 0);
})();
const DOWN = new Vector3(0, -1, 0);
const _o = new Vector3(), _o2 = new Vector3(), _save = new Vector3();

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

  /** Modo noclip: voa na direção do olhar, sem gravidade nem colisão. */
  noclip = false;

  setNoclip(on: boolean): void {
    if (on === this.noclip) return;
    this.noclip = on;
    const b = this.body;
    if (on) {
      this.slideT = 0;
      this.sprinting = false;
      this.crouched = false;
      b.height = MOVE.standHeight;
      b.grounded = false;
    } else {
      this.leaveNoclip();
    }
  }

  private tickNoclip(dt: number, inp: MoveInput): void {
    const b = this.body;
    this.prevPos.copy(b.pos);
    this.prevEye = this.eye;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // frente = direção do olhar (com pitch); direita = horizontal
    let wx = -sy * cp * inp.forward + cy * inp.right;
    let wy = sp * inp.forward + (inp.flyUp ?? 0);
    let wz = -cy * cp * inp.forward - sy * inp.right;
    const l = Math.hypot(wx, wy, wz);
    const spd = l > 0 ? (inp.flyFast ? NOCLIP_FAST : NOCLIP_SPEED) / l : 0;
    wx *= spd; wy *= spd; wz *= spd;
    const k = 1 - Math.exp(-dt * 12);
    b.vel.x += (wx - b.vel.x) * k;
    b.vel.y += (wy - b.vel.y) * k;
    b.vel.z += (wz - b.vel.z) * k;
    b.pos.addScaledVector(b.vel, dt);
    // limites: dentro do mapa (com folga) e do chão pra cima
    const bd = this.world.map.bounds;
    b.pos.x = Math.max(bd.min[0] - 4, Math.min(bd.max[0] + 4, b.pos.x));
    b.pos.z = Math.max(bd.min[2] - 4, Math.min(bd.max[2] + 4, b.pos.z));
    b.pos.y = Math.max(bd.min[1], Math.min(bd.max[1] + 20, b.pos.y));
    b.grounded = false;
    this.fallSpeed = 0;
    this.eye += (MOVE.standEye - this.eye) * Math.min(1, dt * 14);
    this.stepSmooth = 0;
  }

  /** Saiu do noclip: se está dentro de algo (ou sem chão embaixo), empurra pro espaço livre mais próximo; senão só cai. */
  private leaveNoclip(): void {
    const b = this.body;
    b.vel.set(0, 0, 0);
    b.height = MOVE.standHeight;
    this.crouched = false;
    this.fallSpeed = 0;
    this.slideT = 0;
    if (!this.standable(b.pos)) {
      const ox = b.pos.x, oy = b.pos.y, oz = b.pos.z;
      let found = false;
      for (let r = 0.25; r <= 14 && !found; r += 0.25) {
        for (const d of FREE_DIRS) {
          _o.set(ox + d[0] * r, oy + d[1] * r, oz + d[2] * r);
          if (_o.y >= 0 && this.standable(_o)) { b.pos.copy(_o); found = true; break; }
        }
      }
      if (!found) {
        // nada por perto: spawn livre mais próximo
        let best = Infinity;
        for (const s of this.world.map.spawns) {
          _o.set(s.pos[0], s.pos[1] + 0.05, s.pos[2]);
          const dd = _o.distanceToSquared(b.pos);
          if (dd < best && this.standable(_o)) { best = dd; b.pos.copy(_o); found = true; }
        }
        if (!found) { const s = this.world.map.spawns[0]; b.pos.set(s.pos[0], s.pos[1] + 0.05, s.pos[2]); }
      }
    }
    this.prevPos.copy(b.pos);
  }

  /** Cabe em pé em `p` e tem chão embaixo (não é um vazio fora do mapa)? */
  private standable(p: Vector3): boolean {
    const b = this.body;
    const save = _save.copy(b.pos);
    b.pos.copy(p);
    const ok = this.world.fits(b) && this.world.raycast(_o2.set(p.x, p.y + 0.1, p.z), DOWN, 80) !== null;
    b.pos.copy(save);
    return ok;
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
    if (this.noclip) { this.tickNoclip(dt, inp); return; }
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
