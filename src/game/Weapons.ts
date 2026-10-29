import { Vector3 } from 'three';
import { bus } from '../core/events';
import { WEAPONS, type WeaponDef, type WeaponId } from './weaponDefs';

export interface FireInput {
  fire: boolean;
  firePressed: boolean;
  altPressed: boolean;
  reloadPressed: boolean;
  /** Botão direito segurado (ADS). */
  aim: boolean;
  /** Correndo: não atira, sai da mira. */
  sprinting: boolean;
}

export interface AimContext {
  eye: Vector3;
  yaw: number;
  pitch: number;
  speed: number;
  grounded: boolean;
  crouched: boolean;
}

export type ShootFn = (weapon: WeaponDef, origin: Vector3, dirs: Vector3[]) => void;
export type MeleeFn = (weapon: WeaponDef, origin: Vector3, dir: Vector3, heavy: boolean) => boolean;

const DEG = Math.PI / 180;

/** Armas do jogador local: cadência, munição, recarga, spread, recuo e zoom. */
export class WeaponSystem {
  current: WeaponId = 'smg';
  ammo = 0;
  state: 'ready' | 'reloading' | 'switching' = 'ready';
  private stateTime = 0;
  private stateDuration = 0;
  private cooldown = 0;
  bloom = 0;
  /** Offset de recuo aplicado à câmera e aos tiros (rad). */
  recoilPitch = 0;
  recoilYaw = 0;
  private shotsFired = 0;
  private sinceShot = 99;
  zoomed = false;
  /** Progresso da mira (ADS) 0..1. */
  ads = 0;
  /** Tempo até poder atirar depois de parar de correr. */
  private sprintBlock = 0;
  /** Arma guardada (o jogador está com uma arma maluca na mão): nada de recarga automática. */
  private holstered = false;
  /** Munição guardada por arma (trocar e voltar não recarrega de graça). Zera no respawn. */
  private saved: Partial<Record<WeaponId, number>> = {};
  /** Recarga automática depois do último tiro (s); < 0 = desligada. */
  private autoReload = -1;

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  get reloadProgress(): number {
    return this.state === 'reloading' ? Math.min(1, this.stateTime / this.stateDuration) : 0;
  }

  /** Guarda a arma atual (pegou uma arma maluca): zera mira, zoom e recarga. `equip` tira de novo. */
  holster(): void {
    this.holstered = true;
    this.autoReload = -1;
    this.setZoom(false);
    this.ads = 0;
    this.bloom = 0;
    this.state = 'ready';
    this.recoilPitch = this.recoilYaw = 0;
  }

  /** `keepAmmo`: volta com a munição que a arma tinha (troca no treino, fim de arma maluca). */
  equip(id: WeaponId, instant = false, keepAmmo = false): void {
    if (!this.holstered) this.saved[this.current] = this.ammo;
    this.holstered = false;
    this.autoReload = -1;
    this.current = id;
    this.ammo = keepAmmo ? this.saved[id] ?? WEAPONS[id].mag : WEAPONS[id].mag;
    this.setZoom(false);
    this.ads = 0;
    this.bloom = 0;
    this.shotsFired = 0;
    this.cooldown = 0;
    if (instant) {
      this.state = 'ready';
    } else {
      this.state = 'switching';
      this.stateTime = 0;
      this.stateDuration = WEAPONS[id].switchTime;
      bus.emit('weapon:switch', { to: id, duration: this.stateDuration });
    }
  }

  /** Respawn: pente cheio em todas as armas. */
  reset(): void {
    this.recoilPitch = this.recoilYaw = 0;
    this.bloom = 0;
    this.saved = {};
    this.holstered = true; // não salva a munição da vida anterior
    this.equip(this.current, true);
  }

  /** Spread atual (rad) — o HUD usa para a mira dinâmica. */
  spread(ctx: AimContext): number {
    const d = this.def;
    if (d.melee) return 0;
    if (d.zoomFov && this.zoomed) return 0.0004 + (ctx.speed > 1 ? d.spreadMove : 0) + (ctx.grounded ? 0 : d.spreadAir);
    let s = d.spreadBase + this.bloom;
    s += d.spreadMove * Math.min(1, ctx.speed / 6);
    if (!ctx.grounded) s += d.spreadAir;
    if (ctx.crouched) s *= d.crouchMult;
    s = Math.min(s, d.spreadMax + d.spreadAir);
    // Mirando: bem mais preciso (escopeta abre menos, mas continua espalhando)
    return s * (1 - this.ads * (d.pellets > 1 ? 0.3 : 0.75));
  }

  private setZoom(on: boolean): void {
    if (this.zoomed === on) return;
    this.zoomed = on;
    bus.emit('weapon:zoom', { active: on, fov: on ? this.def.zoomFov ?? 0 : 0 });
  }

  update(dt: number, inp: FireInput, ctx: AimContext, shoot: ShootFn, melee: MeleeFn): void {
    const d = this.def;
    this.cooldown -= dt;
    this.sinceShot += dt;
    if (this.autoReload >= 0) {
      this.autoReload -= dt;
      if (this.autoReload < 0 && this.ammo <= 0) this.startReload();
    }
    this.bloom = Math.max(0, this.bloom - dt * (d.spreadPerShot * 25 + 0.02));
    if (this.sinceShot > 60 / d.rpm + 0.12) this.shotsFired = 0;

    // Recuo volta suave quando não está atirando
    const rec = this.sinceShot > 60 / d.rpm ? d.recover : d.recover * 0.25;
    const k = Math.exp(-dt * rec);
    this.recoilPitch *= k;
    this.recoilYaw *= k;

    // Corrida bloqueia o tiro por um instante depois de parar (estilo CoD)
    if (inp.sprinting) this.sprintBlock = 0.16;
    else this.sprintBlock = Math.max(0, this.sprintBlock - dt);

    // Mira (ADS): segura o botão direito. Sniper não mira recarregando.
    const canAds = !d.melee && !inp.sprinting && this.state !== 'switching' && !(d.zoomFov && this.state === 'reloading');
    const target = inp.aim && canAds ? 1 : 0;
    const step = dt / Math.max(0.05, d.adsTime);
    if (target === 1) this.ads = Math.min(1, this.ads + step);
    else this.ads = Math.max(0, this.ads - step * 1.4);
    if (d.zoomFov) this.setZoom(this.ads > 0.92);

    if (this.state !== 'ready') {
      this.stateTime += dt;
      if (this.stateTime >= this.stateDuration) {
        if (this.state === 'reloading') {
          this.ammo = d.mag;
          bus.emit('weapon:reloaded', { weapon: d.id });
        }
        this.state = 'ready';
      } else {
        return;
      }
    }

    if (inp.sprinting || this.sprintBlock > 0) return;

    if (d.melee) {
      if (this.cooldown <= 0 && (inp.fire || inp.altPressed)) {
        const heavy = !inp.fire && inp.altPressed;
        const dir = aimDir(ctx.yaw, ctx.pitch, new Vector3());
        const hit = melee(d, ctx.eye.clone(), dir, heavy);
        bus.emit('weapon:melee', { actorId: 'local', local: true, weapon: d.id, hit, heavy, origin: ctx.eye.clone() });
        this.cooldown = heavy ? d.melee.heavyTime : 60 / d.rpm;
      }
      return;
    }

    if (inp.reloadPressed && this.ammo < d.mag) {
      this.startReload();
      return;
    }

    const wants = d.auto ? inp.fire : inp.firePressed;
    if (!wants) return;
    if (this.ammo <= 0) {
      if (inp.firePressed) bus.emit('weapon:dryfire', { weapon: d.id });
      this.startReload();
      return;
    }

    // Permite mais de um tiro por frame se o fps estiver baixo, sem acumular "crédito".
    if (this.cooldown < -dt) this.cooldown = 0;
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown += 60 / d.rpm;
      this.fireOnce(d, ctx, shoot);
      if (!d.auto) break;
    }
  }

  private startReload(): void {
    const d = this.def;
    if (this.holstered || this.state !== 'ready' || d.mag === 0) return;
    this.setZoom(false);
    this.state = 'reloading';
    this.stateTime = 0;
    this.stateDuration = d.reload;
    bus.emit('weapon:reload', { weapon: d.id, duration: d.reload });
  }

  private fireOnce(d: WeaponDef, ctx: AimContext, shoot: ShootFn): void {
    const spread = this.spread(ctx);
    const pitch = ctx.pitch + this.recoilPitch;
    const yaw = ctx.yaw + this.recoilYaw;
    const base = aimDir(yaw, pitch, new Vector3());
    const dirs: Vector3[] = [];
    for (let i = 0; i < Math.max(1, d.pellets); i++) dirs.push(coneDir(base, spread));
    shoot(d, ctx.eye.clone(), dirs);

    this.ammo--;
    this.shotsFired++;
    this.sinceShot = 0;
    this.bloom = Math.min(d.spreadMax, this.bloom + d.spreadPerShot);

    // Padrão de recuo: sobe forte no começo da rajada, depois "dança" pros lados.
    const climb = (this.shotsFired < 8 ? 1 : 0.35) * (1 - this.ads * 0.3);
    this.recoilPitch += d.kick * DEG * climb * (0.85 + Math.random() * 0.3);
    const side = this.shotsFired > 5 ? Math.sin(this.shotsFired * 0.55) * 1.2 : (Math.random() - 0.5);
    this.recoilYaw += d.kickYaw * DEG * side * (1 - this.ads * 0.4);
    this.recoilPitch = Math.min(this.recoilPitch, 14 * DEG);

    if (this.ammo <= 0) {
      // Recarrega sozinho depois do último tiro (sniper/shotgun ficam mais fluidos).
      this.autoReload = 0.25;
    }
  }
}

/** Direção da mira a partir de yaw/pitch (mesma convenção da câmera, ordem YXZ). */
export function aimDir(yaw: number, pitch: number, out: Vector3): Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

const _r = new Vector3(), _u = new Vector3(), _up = new Vector3(0, 1, 0);

/** Direção aleatória dentro de um cone (distribuição uniforme no disco). */
export function coneDir(base: Vector3, halfAngle: number): Vector3 {
  if (halfAngle <= 0) return base.clone();
  _r.crossVectors(base, _up);
  if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_r, base).normalize();
  const a = Math.random() * Math.PI * 2;
  const r = Math.tan(halfAngle) * Math.sqrt(Math.random());
  return base.clone().addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
}
