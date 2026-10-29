import * as THREE from 'three';
import { bus } from '../../core/events';
import type { Actor } from '../Actor';
import type { MatchEvent, V3 } from '../Match';
import { SPECIALS, SPECIAL_IDS, type SpecialId } from './defs';

export interface PickupInfo {
  id: number;
  kind: SpecialId;
  pos: V3;
}

interface Item extends PickupInfo {
  age: number;
  model: THREE.Object3D;
  seed: number;
}

export const MAX_PICKUPS = 3;
const FIRST_SPAWN = 5;
const SPAWN_MIN = 15, SPAWN_MAX = 25;
const EXPIRE = 55;
/** Raio de coleta (horizontal) para quem simula localmente (jogador local, bots no host). */
export const PICKUP_RADIUS = 1.5;
/** O host aceita pedidos de clientes até esta distância (compensa latência/interpolação). */
export const PICKUP_VALIDATE = 3.6;

export interface PickupHostCtx {
  /** Pontos candidatos (chão). */
  spots: THREE.Vector3[];
  actors: Iterable<Actor>;
  publish(e: MatchEvent): void;
  /** Actors simulados nesta máquina e que podem coletar sozinhos (jogador local e bots). */
  collectors: Iterable<Actor>;
}

/**
 * Pickups das armas malucas.
 * Host: decide quando/onde aparecem e quem pegou (o primeiro que chega). Todos: desenham o pickup.
 */
export class PickupSystem {
  readonly items = new Map<number, Item>();
  private nextId = 1;
  private timer = FIRST_SPAWN;
  private lastKind: SpecialId | null = null;
  private lastSpots: number[] = [];
  private t = 0;
  /** Debug: força a próxima rodada de spawn. */
  enabled = true;

  constructor(private scene: THREE.Scene, private build: (id: SpecialId) => THREE.Object3D) {}

  list(): PickupInfo[] {
    return [...this.items.values()].map((i) => ({ id: i.id, kind: i.kind, pos: i.pos }));
  }

  // ---------------------------------------------------------------- estado (todos)

  applySpawn(id: number, kind: SpecialId, pos: V3): void {
    if (this.items.has(id)) return;
    const model = this.build(kind);
    model.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(model);
    this.items.set(id, { id, kind, pos, age: 0, model, seed: Math.random() * 6.28 });
    if (id >= this.nextId) this.nextId = id + 1;
    bus.emit('special:spawn', { id, kind, pos: new THREE.Vector3(pos[0], pos[1], pos[2]) });
  }

  /** Remove o pickup. Retorna o item (para o chamador saber o que era). */
  applyTake(id: number, expired: boolean): PickupInfo | null {
    const it = this.items.get(id);
    if (!it) return null;
    this.scene.remove(it.model);
    this.items.delete(id);
    if (expired) bus.emit('special:expire', { id, kind: it.kind, pos: new THREE.Vector3(...it.pos) });
    return { id: it.id, kind: it.kind, pos: it.pos };
  }

  applyList(list: PickupInfo[]): void {
    this.clear();
    for (const p of list) this.applySpawn(p.id, p.kind, p.pos);
  }

  clear(): void {
    for (const it of this.items.values()) this.scene.remove(it.model);
    this.items.clear();
  }

  // ---------------------------------------------------------------- host

  /** Reinicia o relógio de spawn (nova partida). */
  resetTimer(): void {
    this.timer = FIRST_SPAWN;
    this.lastSpots.length = 0;
  }

  hostUpdate(dt: number, ctx: PickupHostCtx): void {
    for (const it of this.items.values()) it.age += dt;

    // expira pickups esquecidos
    for (const it of [...this.items.values()]) {
      if (it.age > EXPIRE) ctx.publish({ t: 'pickup-take', id: it.id, actor: '' });
    }

    if (this.enabled) {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.items.size < MAX_PICKUPS && this.spawnOne(ctx)) this.timer = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
        else this.timer = 3;
      }
    }

    // coleta por quem simulamos aqui
    for (const a of ctx.collectors) {
      if (!a.alive) continue;
      for (const it of this.items.values()) {
        if (Math.abs(a.pos.y + 0.9 - it.pos[1]) > 2) continue;
        if (Math.hypot(a.pos.x - it.pos[0], a.pos.z - it.pos[2]) <= PICKUP_RADIUS) {
          this.take(it.id, a, ctx.publish);
          break; // um pickup por frame por actor
        }
      }
    }
  }

  /** Host: sorteia tipo e ponto e publica. Retorna false se não achou lugar. */
  spawnOne(ctx: Pick<PickupHostCtx, 'spots' | 'actors' | 'publish'>, kind?: SpecialId, at?: V3): boolean {
    if (at) {
      this.publishSpawn(ctx.publish, kind ?? this.randomKind(), at);
      return true;
    }
    const spots = ctx.spots;
    if (!spots.length) return false;
    for (const minActor of [7, 3.5, 0]) {
      const ok: number[] = [];
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        if (this.lastSpots.includes(i)) continue;
        let good = true;
        for (const it of this.items.values()) {
          if (Math.hypot(it.pos[0] - s.x, it.pos[2] - s.z) < 14) { good = false; break; }
        }
        if (!good) continue;
        for (const a of ctx.actors) {
          if (!a.alive) continue;
          if (Math.hypot(a.pos.x - s.x, a.pos.z - s.z) < minActor) { good = false; break; }
        }
        if (good) ok.push(i);
      }
      if (!ok.length) continue;
      const idx = ok[Math.floor(Math.random() * ok.length)];
      this.lastSpots.push(idx);
      if (this.lastSpots.length > 4) this.lastSpots.shift();
      const s = spots[idx];
      this.publishSpawn(ctx.publish, kind ?? this.randomKind(), [s.x, s.y + 0.95, s.z]);
      return true;
    }
    return false;
  }

  private randomKind(): SpecialId {
    let k: SpecialId;
    do k = SPECIAL_IDS[Math.floor(Math.random() * SPECIAL_IDS.length)];
    while (k === this.lastKind && SPECIAL_IDS.length > 1);
    return k;
  }

  private publishSpawn(publish: (e: MatchEvent) => void, kind: SpecialId, pos: V3): void {
    this.lastKind = kind;
    publish({ t: 'pickup-spawn', id: this.nextId++, kind, pos: [round(pos[0]), round(pos[1]), round(pos[2])] });
  }

  /** Host: `actor` quer pegar o pickup `id`. Valida distância e se ainda existe. */
  tryTake(id: number, actor: Actor, publish: (e: MatchEvent) => void, maxDist = PICKUP_VALIDATE): boolean {
    const it = this.items.get(id);
    if (!it || !actor.alive) return false;
    if (Math.abs(actor.pos.y + 0.9 - it.pos[1]) > 3) return false;
    if (Math.hypot(actor.pos.x - it.pos[0], actor.pos.z - it.pos[2]) > maxDist) return false;
    this.take(id, actor, publish);
    return true;
  }

  private take(id: number, actor: Actor, publish: (e: MatchEvent) => void): void {
    const it = this.items.get(id);
    if (!it) return;
    publish({ t: 'pickup-take', id, actor: actor.id });
    publish({ t: 'special', actor: actor.id, kind: it.kind, ammo: SPECIALS[it.kind].ammo });
  }

  // ---------------------------------------------------------------- visual

  visual(dt: number): void {
    this.t += dt;
    for (const it of this.items.values()) {
      const m = it.model;
      m.position.y = it.pos[1] + Math.sin(this.t * 2.2 + it.seed) * 0.14;
      const spin = m.userData.spin as THREE.Object3D | undefined;
      (spin ?? m).rotation.y += dt * 1.6;
      (m.userData.update as ((t: number, dt: number) => void) | undefined)?.(this.t + it.seed, dt);
      // some devagar no fim da vida
      const blink = it.age > EXPIRE - 6 ? (Math.sin(this.t * 14) > 0 ? 1 : 0) : 1;
      m.visible = blink > 0;
    }
  }

  /** Pickup mais próximo de (x,z) — usado pelos bots. */
  nearest(x: number, z: number, maxDist: number): PickupInfo | null {
    let best: Item | null = null, bd = maxDist;
    for (const it of this.items.values()) {
      const d = Math.hypot(it.pos[0] - x, it.pos[2] - z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
