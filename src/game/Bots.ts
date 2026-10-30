import { Vector3 } from 'three';
import type { Actor } from './Actor';
import { MOVE } from './Player';
import { SPECIALS } from './special/defs';
import { aimDir, coneDir } from './Weapons';
import { WEAPONS, type WeaponDef } from './weaponDefs';
import type { World } from './World';

export interface BotHost {
  world: World;
  actors(): Iterable<Actor>;
  difficulty(): number;
  fire(shooter: Actor, def: WeaponDef, origin: Vector3, dirs: Vector3[]): void;
  melee(shooter: Actor, def: WeaponDef, origin: Vector3, dir: Vector3, heavy: boolean): boolean;
  /** Armas malucas: o bot "segura/aperta" o gatilho. Chamado todo tick enquanto o bot tem uma. */
  special(shooter: Actor, dt: number, held: boolean, pressed: boolean, dir: Vector3): void;
  /** A arma maluca do bot está "ligada" (pipa no ar): o próximo clique recolhe. */
  specialOn(a: Actor): boolean;
  /** Foi lançado por knockback (vento, explosão): não reassume o controle horizontal no ar. */
  knocked(a: Actor): boolean;
  stunned(a: Actor): boolean;
  blinded(a: Actor): boolean;
  /** Pickup de arma maluca mais próximo (ou null). */
  pickupNear(a: Actor): { id: number; pos: [number, number, number] } | null;
}

interface NavGraph {
  nodes: Vector3[];
  links: number[][];
}

const _eye = new Vector3(), _teye = new Vector3(), _d = new Vector3(), _aim = new Vector3();

/** Compensação de pitch (rad) para arremessos em arco: mira acima do alvo. */
function lobPitch(id: string, dist: number): number {
  let v = 0, g = 0, lift = 0;
  switch (id) {
    case 'dolly': ({ speed: v, g, lift } = SPECIALS.dolly.p); break;
    case 'panela': ({ speed: v, g, lift } = SPECIALS.panela.p); break;
    case 'bola': ({ speed: v, g, lift } = SPECIALS.bola.p); break;
    case 'estilingue': v = SPECIALS.estilingue.p.vMax * 0.8; g = SPECIALS.estilingue.p.g; break;
    default: return 0;
  }
  const x = Math.min(1, (g * dist) / (v * v));
  return 0.5 * Math.asin(x) - Math.atan(lift);
}

const _down = new Vector3(0, -1, 0), _probe = new Vector3();

/**
 * O caminho a pé entre dois nós não tem degrau maior que um passo (nem pra cima nem pra baixo).
 * Amostra a altura do chão a cada ~0.5 m; evita links "só de descida" onde o bot empaca na volta.
 */
function walkable(world: World, a: Vector3, b: Vector3): boolean {
  const top = Math.max(a.y, b.y) + 2.5;
  const n = Math.max(2, Math.ceil(a.distanceTo(b) / 0.5));
  let prev = a.y;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    _probe.set(a.x + (b.x - a.x) * t, top, a.z + (b.z - a.z) * t);
    const hit = world.raycast(_probe, _down, top + 5);
    const y = hit ? hit.point.y : -99;
    if (Math.abs(y - prev) > MOVE.stepHeight + 0.05) return false;
    prev = y;
  }
  return true;
}

/** Monta grafo de navegação: nós conectados se há visão livre na altura da cintura e da cabeça e o chão é contínuo. */
export function buildNavGraph(world: World): NavGraph {
  const nodes = world.map.navNodes.map((n) => new Vector3(...n));
  const links: number[][] = nodes.map(() => []);
  const a = new Vector3(), b = new Vector3();
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].distanceTo(nodes[j]) > 45) continue;
      let ok = true;
      for (const h of [0.5, 1.5]) {
        a.copy(nodes[i]).y += h;
        b.copy(nodes[j]).y += h;
        if (!world.visible(a, b)) { ok = false; break; }
      }
      if (ok && walkable(world, nodes[i], nodes[j])) { links[i].push(j); links[j].push(i); }
    }
  }
  return { nodes, links };
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** IA simples de bot: anda pelo grafo, vê inimigo, mira com atraso/erro, atira em rajadas e faz strafe. */
export class BotBrain {
  private node = -1;
  private prevNode = -1;
  private enemy: Actor | null = null;
  private seeTime = 0;
  private lostTime = 0;
  private think = 0;
  private cooldown = 0;
  private burst = 0;
  private burstPause = 0;
  private strafe = 1;
  private strafeTimer = 0;
  private stuck = 0;
  private lastPos = new Vector3();
  private aimErrYaw = 0;
  private aimErrPitch = 0;
  private crouchTimer = 0;
  private footDist = 0;
  // armas malucas
  private spCool = 0.8;
  private spCharging = false;
  private spChargeT = 0;
  private pickupT = 0;
  private pickup: Vector3 | null = null;
  onFootstep: (() => void) | null = null;

  constructor(readonly actor: Actor, private nav: NavGraph) {
    actor.body = {
      pos: actor.pos,
      vel: actor.vel,
      hw: MOVE.halfWidth,
      height: MOVE.standHeight,
      grounded: false,
      stepHeight: MOVE.stepHeight,
    };
  }

  respawned(): void {
    this.node = -1;
    this.enemy = null;
    this.seeTime = 0;
  }

  tick(dt: number, host: BotHost): void {
    const a = this.actor, b = a.body!;
    if (!a.alive) return;
    const diff = host.difficulty();
    const def = WEAPONS[a.weapon];
    const stunned = host.stunned(a);
    const blinded = host.blinded(a);
    let spHeld = false, spPressed = false;
    this.spCool -= dt;

    // Arma maluca no mapa por perto? Vai buscar quando não está brigando.
    this.pickupT -= dt;
    if (this.pickupT <= 0) {
      this.pickupT = 0.6;
      const p = host.pickupNear(a);
      this.pickup = p ? (this.pickup ?? new Vector3()).set(p.pos[0], p.pos[1], p.pos[2]) : null;
    }

    // Percepção (a cada ~0.15s)
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.12 + Math.random() * 0.08;
      this.perceive(host);
    }

    let moveX = 0, moveZ = 0;
    let wantSpeed = MOVE.maxSpeed * 0.8 * def.moveMult;

    if (this.enemy && this.enemy.alive) {
      this.seeTime += dt;
      const e = this.enemy;
      a.eyePos(_eye);
      e.eyePos(_teye);
      const aimHead = Math.random() < 0.15 + diff * 0.35;
      _teye.y -= aimHead ? 0.05 : 0.45;
      _d.subVectors(_teye, _eye);
      const dist = _d.length();
      const wantYaw = Math.atan2(-_d.x, -_d.z);
      const wantPitch = Math.asin(_d.y / Math.max(dist, 0.001)) + (a.special ? lobPitch(a.special, dist) : 0);

      // Erro de mira diminui conforme rastreia o alvo
      const errScale = (1 - diff * 0.75) * Math.max(0.15, 1 - this.seeTime * 0.8) * (blinded ? 4 : 1);
      this.aimErrYaw += (Math.random() - 0.5) * dt * 3;
      this.aimErrPitch += (Math.random() - 0.5) * dt * 2;
      this.aimErrYaw *= 0.96;
      this.aimErrPitch *= 0.96;
      const turn = stunned ? 0 : (3 + diff * 9) * dt; // atordoado: mira travada
      a.yaw += Math.max(-turn, Math.min(turn, wrapAngle(wantYaw + this.aimErrYaw * errScale - a.yaw)));
      a.pitch += Math.max(-turn, Math.min(turn, wantPitch + this.aimErrPitch * errScale * 0.5 - a.pitch));

      const reaction = 0.55 - diff * 0.35;
      const onTarget = Math.abs(wrapAngle(wantYaw - a.yaw)) < 0.12 + 0.6 / Math.max(dist, 1);

      if (a.special) {
        const sp = this.specialCombat(a, dist, onTarget, dt, host.specialOn(a));
        spHeld = sp.held && !stunned;
        spPressed = sp.pressed && !stunned;
        moveX = sp.approach > 0 ? -Math.sin(a.yaw) : sp.approach < 0 ? Math.sin(a.yaw) : Math.cos(a.yaw) * this.strafe;
        moveZ = sp.approach > 0 ? -Math.cos(a.yaw) : sp.approach < 0 ? Math.cos(a.yaw) : -Math.sin(a.yaw) * this.strafe;
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafe = Math.random() < 0.5 ? -1 : 1;
          this.strafeTimer = 0.5 + Math.random() * 0.9;
        }
        wantSpeed = MOVE.maxSpeed * (sp.approach > 0 ? 0.85 : 0.6);
      } else if (def.melee) {
        // Corre pra cima com a faca
        moveX = _d.x; moveZ = _d.z;
        wantSpeed = MOVE.maxSpeed * def.moveMult;
        this.cooldown -= dt;
        if (dist < def.melee.range + 0.3 && this.cooldown <= 0) {
          const heavy = Math.random() < 0.3;
          host.melee(a, def, a.eyePos(new Vector3()), aimDir(a.yaw, a.pitch, new Vector3()), heavy);
          this.cooldown = heavy ? def.melee.heavyTime : 60 / def.rpm + 0.15;
        }
      } else {
        // Strafe lateral enquanto atira
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafe = Math.random() < 0.5 ? -1 : 1;
          this.strafeTimer = 0.4 + Math.random() * 0.9;
          this.crouchTimer = Math.random() < 0.15 * diff ? 0.6 + Math.random() : 0;
        }
        const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
        moveX = cy * this.strafe;
        moveZ = -sy * this.strafe;
        if (dist > 22) { moveX += -sy; moveZ += -cy; }
        wantSpeed = MOVE.maxSpeed * 0.6;

        this.cooldown -= dt;
        this.burstPause -= dt;
        if (this.seeTime > reaction && onTarget && this.cooldown <= 0 && this.burstPause <= 0) {
          const spread = def.spreadBase + (1 - diff) * 0.035 + Math.min(1, this.actor.speed / 6) * def.spreadMove * 0.5;
          const base = aimDir(a.yaw, a.pitch, new Vector3());
          const dirs: Vector3[] = [];
          for (let i = 0; i < Math.max(1, def.pellets); i++) dirs.push(coneDir(base, def.pellets > 1 ? def.spreadBase : spread));
          host.fire(a, def, a.eyePos(new Vector3()), dirs);
          // Bots atiram um pouco mais devagar que humanos
          this.cooldown = (60 / def.rpm) * (def.auto ? 1.35 : 1.6 + Math.random());
          if (def.auto && ++this.burst > 3 + Math.random() * 5) {
            this.burst = 0;
            this.burstPause = 0.25 + Math.random() * 0.5;
          }
        }
      }
    } else {
      this.seeTime = 0;
      a.pitch *= 0.9;
      // Anda pelo grafo
      if (this.node < 0 || a.pos.distanceTo(this.nav.nodes[this.node]) < 1.2) this.pickNode();
      let t: Vector3 | undefined = this.nav.nodes[this.node];
      if (this.pickup && Math.hypot(this.pickup.x - a.pos.x, this.pickup.z - a.pos.z) < 16 && host.world.visible(a.eyePos(_eye), this.pickup)) {
        t = this.pickup; // arma maluca à vista: vai pegar
      }
      if (t) {
        moveX = t.x - a.pos.x;
        moveZ = t.z - a.pos.z;
        const wantYaw = Math.atan2(-moveX, -moveZ);
        a.yaw += wrapAngle(wantYaw - a.yaw) * Math.min(1, dt * 6);
      }
    }

    this.crouchTimer -= dt;
    a.crouched = this.crouchTimer > 0;
    b.height = a.crouched ? MOVE.crouchHeight : MOVE.standHeight;
    if (a.crouched) wantSpeed *= MOVE.crouchMult;

    // Movimento (aceleração simples)
    const ml = Math.hypot(moveX, moveZ);
    const tx = ml > 0.01 ? (moveX / ml) * wantSpeed : 0;
    const tz = ml > 0.01 ? (moveZ / ml) * wantSpeed : 0;
    // Lançado por knockback no ar: o corpo voa livre (senão o bot "freia" no meio do home run)
    if (!(!b.grounded && host.knocked(a))) {
      const k = Math.min(1, dt * (b.grounded ? 10 : 1.5));
      b.vel.x += (tx - b.vel.x) * k;
      b.vel.z += (tz - b.vel.z) * k;
    }
    b.vel.y -= MOVE.gravity * dt;
    host.world.moveBody(b, dt);
    a.grounded = b.grounded;
    a.speed = Math.hypot(b.vel.x, b.vel.z);

    if (a.grounded && a.speed > 2.5) {
      this.footDist += a.speed * dt;
      if (this.footDist > 2.1) { this.footDist = 0; this.onFootstep?.(); }
    }

    // Preso? pula e troca de destino
    this.stuck += dt;
    if (this.stuck > 0.6) {
      if (ml > 0.01 && this.lastPos.distanceTo(a.pos) < 0.4) {
        if (b.grounded) b.vel.y = MOVE.jumpVel;
        this.pickNode();
      }
      this.lastPos.copy(a.pos);
      this.stuck = 0;
    }
    if (a.pos.y < -30) a.pos.set(0, 2, 0);

    if (a.special) host.special(a, dt, spHeld, spPressed, aimDir(a.yaw, a.pitch, _aim));
  }

  /** Decide se aperta/segura o gatilho da arma maluca e se chega perto ou fica longe. `on`: pipa já está no ar. */
  private specialCombat(a: Actor, dist: number, onTarget: boolean, dt: number, on: boolean): { held: boolean; pressed: boolean; approach: number } {
    const id = a.special!;
    const loose = onTarget || (Math.abs(wrapAngle(Math.atan2(-_d.x, -_d.z) - a.yaw)) < 0.45);
    const seen = this.seeTime > 0.3;
    let held = false, pressed = false, approach = 0;
    const throwIf = (ok: boolean, cdMin: number, cdMax: number) => {
      if (ok && this.spCool <= 0) {
        pressed = held = true;
        this.spCool = cdMin + Math.random() * (cdMax - cdMin);
      }
    };
    switch (id) {
      case 'lorenzetti':
        held = dist < 33 && onTarget && seen;
        approach = dist > 20 ? 1 : 0;
        break;
      case 'rexona':
        held = dist < 7.2 && onTarget;
        approach = dist > 4 ? 1 : 0;
        break;
      case 'ventilador':
        held = dist < 13 && onTarget && seen;
        approach = dist > 9 ? 1 : 0;
        break;
      case 'pombo':
        held = dist > 5 && dist < 42 && loose && seen;
        break;
      // Antes só arremessava a mais de 8-9 m: de perto o bot ficava só dançando sem dar dano.
      case 'dolly': throwIf(dist > 2.5 && dist < 26 && loose && seen, 1.1, 2.2); approach = dist < 6 ? -1 : dist > 22 ? 1 : 0; break;
      case 'panela': throwIf(dist > 4 && dist < 28 && loose && seen, 1.4, 2.6); approach = dist < 8 ? -1 : 0; break;
      case 'tijolo': throwIf(dist > 1.5 && dist < 20 && onTarget && seen, 0.9, 1.8); break;
      case 'bola': throwIf(dist > 2.5 && dist < 32 && onTarget && seen, 0.7, 1.4); break;
      case 'cafe':
        held = dist < 8.8 && onTarget;
        approach = dist > 5 ? 1 : 0;
        break;
      case 'pipa':
        // solta a pipa quando tem inimigo à vista e deixa a mira varrer a linha; recolhe se ele sumiu longe
        if (!on && dist < 27 && seen && this.spCool <= 0) { pressed = held = true; this.spCool = 1.2; }
        else if (on && dist > 34 && this.spCool <= 0) { pressed = held = true; this.spCool = 1.2; }
        approach = dist > 16 ? 1 : dist < 5 ? -1 : 0;
        break;
      // rojão voa reto (com balanço): dispara de média distância e fica longe da explosão
      case 'rojao': throwIf(dist > 5 && dist < 34 && onTarget && seen, 1.0, 2.0); approach = dist < 7 ? -1 : 0; break;
      // a galinha corre sozinha atrás do alvo: basta soltar de frente, perto ou meio longe
      case 'galinha': throwIf(dist > 3 && dist < 24 && loose && seen, 1.2, 2.2); break;
      case 'chinelo': throwIf(dist < 15 && onTarget && seen, 0.6, 1.2); break;
      case 'estilingue':
        if (!this.spCharging) {
          if (this.spCool <= 0 && dist > 2 && dist < 45 && loose && seen) {
            this.spCharging = true;
            this.spChargeT = 0.5 + Math.random() * 0.6;
            pressed = held = true;
          }
        } else {
          this.spChargeT -= dt;
          held = this.spChargeT > 0;
          if (!held) { this.spCharging = false; this.spCool = 0.4 + Math.random() * 0.8; }
        }
        break;
    }
    return { held, pressed, approach };
  }

  private perceive(host: BotHost): void {
    const a = this.actor;
    a.eyePos(_eye);
    let best: Actor | null = null;
    let bestD = 60;
    for (const o of host.actors()) {
      if (o === a || !o.alive) continue;
      o.eyePos(_teye);
      const d = _eye.distanceTo(_teye);
      if (d >= bestD) continue;
      // Campo de visão ~200° (ou já está brigando com ele)
      _d.subVectors(_teye, _eye);
      const ang = Math.abs(wrapAngle(Math.atan2(-_d.x, -_d.z) - a.yaw));
      if (ang > 1.75 && o !== this.enemy && d > 6) continue;
      if (!host.world.visible(_eye, _teye)) continue;
      best = o;
      bestD = d;
    }
    if (best !== this.enemy) {
      if (best) { this.enemy = best; this.seeTime = 0; this.lostTime = 0; }
      else {
        this.lostTime += 0.15;
        if (this.lostTime > 0.6) this.enemy = null;
      }
    }
  }

  private pickNode(): void {
    const nav = this.nav;
    if (!nav.nodes.length) return;
    let next = -1;
    if (this.node >= 0 && nav.links[this.node].length) {
      const opts = nav.links[this.node].filter((n) => n !== this.prevNode);
      const list = opts.length ? opts : nav.links[this.node];
      next = list[Math.floor(Math.random() * list.length)];
    } else {
      // Nó visível mais próximo
      let bd = Infinity;
      for (let i = 0; i < nav.nodes.length; i++) {
        const d = nav.nodes[i].distanceTo(this.actor.pos) + Math.random() * 6;
        if (d < bd) { bd = d; next = i; }
      }
    }
    this.prevNode = this.node;
    this.node = next;
  }
}
