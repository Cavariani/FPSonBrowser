import { Matrix4, Vector3, type PerspectiveCamera } from 'three';
import { bus } from '../core/events';
import { MAX_HP, type Actor } from './Actor';
import type { Player } from './Player';
import { aimDir } from './Weapons';
import type { World } from './World';

/**
 * Killstreaks que são CHEATS (só do jogador local; bots não ganham).
 * 3 kills seguidas = wallhack, 6 = aimbot, 9 = noclip. O cheat fica guardado; [V] ativa o melhor guardado por 5 s.
 * Aimbot e ESP são calculados aqui; o noclip é um modo do Player (Game sincroniza com `noclipWanted`).
 */
export type CheatId = 'wallhack' | 'aimbot' | 'noclip';

export const CHEAT_ORDER: CheatId[] = ['wallhack', 'aimbot', 'noclip'];
export const CHEAT_TIME = 5;

export const CHEAT_DEFS: Record<CheatId, { kills: number; name: string; exe: string }> = {
  wallhack: { kills: 3, name: 'WALLHACK', exe: 'wallhack.exe' },
  aimbot: { kills: 6, name: 'AIMBOT', exe: 'aimbot.exe' },
  noclip: { kills: 9, name: 'NOCLIP', exe: 'noclip.exe' },
};

/** Caixa 2D de ESP já projetada (coordenadas normalizadas 0..1, y para baixo). Objetos reaproveitados a cada frame. */
export interface EspBox {
  x0: number; y0: number; x1: number; y1: number;
  /** Vida 0..1. */
  hp: number;
  label: string;
  /** Cache do label. */
  id: string;
  dm: number;
}

export interface CheatsHud {
  streak: number;
  /** Cheats guardados (pode repetir). Mesma referência a cada frame: copie se precisar guardar. */
  stored: readonly CheatId[];
  active: CheatId | null;
  timeLeft: number;
  duration: number;
  /** Próxima meta de kills (null = passou do último). */
  nextAt: number | null;
  esp: readonly EspBox[];
  espCount: number;
}

const DEG = Math.PI / 180;
const AIM_CONE = Math.cos(35 * DEG); // ~70° de campo
const AIM_KEEP = Math.cos(55 * DEG); // alvo travado só é largado fora disso
const AIM_SNAP = 32; // 1/s: snap rápido, mas não instantâneo
const HEAD_DROP = 0.16; // centro da cabeça abaixo do topo do actor

const _vp = new Matrix4(), _inv = new Matrix4();
const _eye = new Vector3(), _fwd = new Vector3(), _head = new Vector3(), _d = new Vector3();

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Cheats {
  streak = 0;
  readonly stored: CheatId[] = [];
  active: CheatId | null = null;
  timeLeft = 0;
  readonly esp: EspBox[] = [];
  espCount = 0;
  private target: Actor | null = null;
  private clock = 0;

  constructor(private world: World) {
    bus.on('kill', (e) => {
      if (e.localVictim) this.onDeath();
      else if (e.localKiller) this.addKill();
    });
    bus.on('player:death', () => this.onDeath());
    bus.on('match:start', () => this.reset());
  }

  /** Zera tudo (nova partida / saiu da sessão). */
  reset(): void {
    const was = this.active;
    this.streak = 0;
    this.stored.length = 0;
    this.active = null;
    this.timeLeft = 0;
    this.target = null;
    this.espCount = 0;
    if (was) bus.emit('cheat:end', { id: was });
  }

  /** O noclip deve estar ligado agora? */
  get noclipWanted(): boolean {
    return this.active === 'noclip';
  }

  private onDeath(): void {
    this.streak = 0; // guardados continuam; o ativo acaba
    if (this.active) this.finish();
  }

  private addKill(): void {
    this.streak++;
    for (const id of CHEAT_ORDER) {
      if (CHEAT_DEFS[id].kills === this.streak) {
        this.stored.push(id);
        bus.emit('cheat:ready', { id });
      }
    }
  }

  /** Tecla V: ativa o melhor guardado (maior nível). Ignora se já tem um rodando. */
  activate(): boolean {
    if (this.active || !this.stored.length) return false;
    let best = 0;
    for (let i = 1; i < this.stored.length; i++) {
      if (CHEAT_ORDER.indexOf(this.stored[i]) > CHEAT_ORDER.indexOf(this.stored[best])) best = i;
    }
    const id = this.stored.splice(best, 1)[0];
    this.active = id;
    this.timeLeft = CHEAT_TIME;
    this.target = null;
    bus.emit('cheat:start', { id });
    return true;
  }

  private finish(): void {
    const id = this.active;
    this.active = null;
    this.timeLeft = 0;
    this.target = null;
    this.espCount = 0;
    if (id) bus.emit('cheat:end', { id });
  }

  update(dt: number): void {
    this.clock += dt;
    if (!this.active) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) this.finish();
  }

  // ---------------------------------------------------------------- aimbot

  /**
   * Gruda a mira na cabeça do inimigo visível mais próximo do centro da tela.
   * `rYaw`/`rPitch` = recuo da arma (somado à mira na hora do tiro e na câmera): compensado para a bala ir na cabeça.
   */
  aimbot(dt: number, p: Player, actors: Iterable<Actor>, rYaw: number, rPitch: number): void {
    if (this.active !== 'aimbot') return;
    const eye = _eye.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
    const fwd = aimDir(p.yaw + rYaw, p.pitch + rPitch, _fwd);

    let t = this.target;
    if (t && !this.valid(t, eye, fwd, AIM_KEEP)) t = null;
    if (!t) {
      let bestCos = AIM_CONE;
      for (const a of actors) {
        if (a.isLocal || !this.headOf(a, _head)) continue;
        const c = this.cosTo(eye, fwd, _head);
        if (c > bestCos && this.world.visible(eye, _head)) { bestCos = c; t = a; }
      }
      this.target = t;
    }
    if (!t) return;

    this.headOf(t, _head);
    const d = _d.subVectors(_head, eye);
    // tremidinha "rage" (~0.2°): o suavizado absorve, então não acumula
    const jx = (Math.sin(this.clock * 47) * 0.6 + Math.sin(this.clock * 91 + 1) * 0.4) * 0.0035;
    const jy = (Math.sin(this.clock * 53 + 2) * 0.6 + Math.sin(this.clock * 83) * 0.4) * 0.0035;
    const wantYaw = Math.atan2(-d.x, -d.z) - rYaw + jx;
    const wantPitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - rPitch + jy;
    const k = 1 - Math.exp(-dt * AIM_SNAP);
    p.yaw += wrap(wantYaw - p.yaw) * k;
    p.pitch += (wantPitch - p.pitch) * k;
    p.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, p.pitch));
  }

  private headOf(a: Actor, out: Vector3): boolean {
    if (!a.alive) return false;
    out.set(a.pos.x, a.pos.y + a.height - HEAD_DROP, a.pos.z);
    return true;
  }

  private cosTo(eye: Vector3, fwd: Vector3, to: Vector3): number {
    const dx = to.x - eye.x, dy = to.y - eye.y, dz = to.z - eye.z;
    const len = Math.hypot(dx, dy, dz);
    return len < 1e-4 ? 1 : (dx * fwd.x + dy * fwd.y + dz * fwd.z) / len;
  }

  private valid(a: Actor, eye: Vector3, fwd: Vector3, minCos: number): boolean {
    if (!this.headOf(a, _head)) return false;
    return this.cosTo(eye, fwd, _head) > minCos && this.world.visible(eye, _head);
  }

  // ---------------------------------------------------------------- wallhack (ESP)

  /** Projeta o AABB (pés até a cabeça, ~0.6 de largura) de cada inimigo vivo para a tela. Sem alocação por frame. */
  project(camera: PerspectiveCamera, actors: Iterable<Actor>): void {
    if (this.active !== 'wallhack') { this.espCount = 0; return; }
    camera.updateMatrixWorld();
    _inv.copy(camera.matrixWorld).invert();
    _vp.multiplyMatrices(camera.projectionMatrix, _inv);
    const e = _vp.elements;
    const cp = camera.position;
    let n = 0;
    for (const a of actors) {
      if (a.isLocal || !a.alive) continue;
      const h = a.height + 0.02;
      const px = a.pos.x, py = a.pos.y, pz = a.pos.z;
      // atrás da câmera: ignora
      if (e[3] * px + e[7] * (py + h * 0.5) + e[11] * pz + e[15] <= 0.1) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const x = px + (i & 1 ? 0.3 : -0.3), y = py + (i & 2 ? h : 0), z = pz + (i & 4 ? 0.3 : -0.3);
        const w = Math.max(0.05, e[3] * x + e[7] * y + e[11] * z + e[15]);
        const sx = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * 0.5 + 0.5;
        const sy = 0.5 - ((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * 0.5;
        if (sx < x0) x0 = sx;
        if (sx > x1) x1 = sx;
        if (sy < y0) y0 = sy;
        if (sy > y1) y1 = sy;
      }
      if (x1 < -0.1 || x0 > 1.1 || y1 < -0.1 || y0 > 1.1) continue;
      let b = this.esp[n];
      if (!b) this.esp[n] = b = { x0: 0, y0: 0, x1: 0, y1: 0, hp: 1, label: '', id: '', dm: -1 };
      n++;
      b.x0 = x0; b.y0 = y0; b.x1 = x1; b.y1 = y1;
      b.hp = Math.max(0, Math.min(1, a.hp / MAX_HP));
      const dm = Math.round(Math.hypot(px - cp.x, pz - cp.z));
      if (b.id !== a.id || b.dm !== dm) { b.id = a.id; b.dm = dm; b.label = `${a.name} ${dm}m`; }
    }
    this.espCount = n;
  }

  // ---------------------------------------------------------------- HUD

  hud(): CheatsHud {
    let next: number | null = null;
    for (const id of CHEAT_ORDER) {
      if (CHEAT_DEFS[id].kills > this.streak) { next = CHEAT_DEFS[id].kills; break; }
    }
    return {
      streak: this.streak, stored: this.stored, active: this.active, timeLeft: Math.max(0, this.timeLeft),
      duration: CHEAT_TIME, nextAt: next, esp: this.esp, espCount: this.espCount,
    };
  }
}
