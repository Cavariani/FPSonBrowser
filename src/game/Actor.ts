import { Vector3, type Texture } from 'three';
import type { CharacterModel } from '../fx/Character';
import type { Body } from './World';
import { MOVE } from './Player';
import type { SpecialId } from './special/defs';
import type { WeaponId } from './weaponDefs';

export interface ActorHit {
  dist: number;
  head: boolean;
}

/** Snapshot de um actor remoto, para interpolação. */
export interface ActorSnap {
  t: number;
  pos: Vector3;
  yaw: number;
  pitch: number;
  crouched: boolean;
  speed: number;
  grounded: boolean;
}

const HEAD = 0.34;
/** Vida máxima (era 100; subiu pra deixar o tempo pra matar menos curto). */
export const MAX_HP = 130;

/**
 * Qualquer combatente: jogador local, jogador remoto ou bot.
 * Estado de partida (hp, kills, level) é decidido pelo host (Match) e espelhado nos clientes.
 */
export class Actor {
  pos = new Vector3();
  vel = new Vector3();
  yaw = 0;
  pitch = 0;
  crouched = false;
  grounded = true;
  speed = 0;

  hp = MAX_HP;
  alive = false;
  kills = 0;
  deaths = 0;
  /** Nível na escada de malucas (0 = mais fraca) e dinheiro da loja (decididos pelo host, espelhados nos clientes). */
  level = 0;
  money = 0;
  /** Pontos de colete (absorvem parte do dano). */
  armor = 0;
  /** Buffs de powerup: segundos restantes (cada máquina desconta no seu relógio; o host decide o dano). */
  readonly buffs = { speed: 0, ammo: 0, dmg: 0 };
  weapon: WeaponId = 'smg';
  /** Arma maluca (pickup) na mão, ou null. Munição só é precisa em quem simula (jogador local e bots no host). */
  special: SpecialId | null = null;
  specialAmmo = 0;
  respawnAt = 0;
  ping = 0;

  /** Corpo físico (bots no host). */
  body: Body | null = null;
  model: CharacterModel | null = null;
  /** "Cara" do boneco (data URL jpeg/png) e a textura carregada dela. Bots não têm. */
  face: string | null = null;
  faceTex: Texture | null = null;
  readonly snaps: ActorSnap[] = [];

  constructor(
    readonly id: string,
    public name: string,
    readonly isBot: boolean,
    readonly isLocal: boolean,
    public color: number,
  ) {}

  get height(): number {
    return this.crouched ? MOVE.crouchHeight : MOVE.standHeight;
  }

  eyePos(out: Vector3): Vector3 {
    return out.set(this.pos.x, this.pos.y + (this.crouched ? MOVE.crouchEye : MOVE.standEye), this.pos.z);
  }

  /** Raio contra as hitboxes (corpo + cabeça). */
  hitTest(o: Vector3, d: Vector3, maxDist: number): ActorHit | null {
    if (!this.alive) return null;
    const h = this.height;
    const p = this.pos;
    const head = rayBox(o, d, p.x - 0.17, p.y + h - HEAD, p.z - 0.17, p.x + 0.17, p.y + h + 0.02, p.z + 0.17);
    const body = rayBox(o, d, p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + h - HEAD, p.z + 0.3);
    let best: ActorHit | null = null;
    if (head >= 0 && head < maxDist) best = { dist: head, head: true };
    if (body >= 0 && body < maxDist && (!best || body < best.dist)) best = { dist: body, head: false };
    return best;
  }
}

/** Retorna t de entrada no AABB ou -1. */
export function rayBox(o: Vector3, d: Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number {
  let tmin = 0, tmax = Infinity;
  const os = [o.x, o.y, o.z], ds = [d.x, d.y, d.z], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ds[a]) < 1e-9) {
      if (os[a] < mn[a] || os[a] > mx[a]) return -1;
      continue;
    }
    let t1 = (mn[a] - os[a]) / ds[a], t2 = (mx[a] - os[a]) / ds[a];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Paleta de cores dos personagens. */
export const ACTOR_COLORS = [0xd94f3d, 0x3d7dd9, 0x46b04a, 0xe0b23a, 0x9a4fd1, 0x2fb5b0, 0xe07a2f, 0xd14f9a];

const BOT_NAMES = [
  'Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Fox', 'Golf', 'Hotel', 'Índia', 'Juliet', 'Kilo', 'Lima',
];

export function botName(i: number): string {
  return BOT_NAMES[i % BOT_NAMES.length];
}
