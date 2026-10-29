import * as THREE from 'three';
import { AudioSystem } from '../audio/Audio';
import { bus } from '../core/events';
import { loadFaceTexture } from '../core/faceTexture';
import { Input } from '../core/Input';
import { settings } from '../core/Settings';
import { CameraFX } from '../fx/CameraFX';
import { CharacterModel } from '../fx/Character';
import { Effects } from '../fx/Effects';
import { ViewModel } from '../fx/ViewModel';
import { DUST } from '../maps/dust';
import type { NetLink } from '../net/types';
import { buildEnvironment, type Environment } from '../render/MapBuilder';
import { Renderer } from '../render/Renderer';
import type { HudState, ScoreRow } from '../ui/types';
import { ACTOR_COLORS, Actor, MAX_HP, botName, type ActorSnap } from './Actor';
import { BotBrain, buildNavGraph } from './Bots';
import { Match, RESPAWN_TIME, type DamageRequest, type MatchEvent, type V3 } from './Match';
import { Player } from './Player';
import { SpecialSystem } from './special/Specials';
import { WeaponSystem } from './Weapons';
import { anyWeaponDef, GUNGAME_LADDER, killsNeeded, WEAPONS, type WeaponDef, type WeaponId } from './weaponDefs';
import { World } from './World';

const TICK = 1 / 60;
const INTERP_DELAY = 0.1;
const DEG = Math.PI / 180;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.05, 400);
  readonly renderer: Renderer;
  readonly input: Input;
  readonly world = new World(DUST);
  readonly player = new Player(this.world);
  readonly weapons = new WeaponSystem();
  readonly camfx = new CameraFX();
  readonly vm = new ViewModel();
  readonly effects: Effects;
  readonly audio = new AudioSystem();
  readonly env: Environment;
  /** Armas malucas (pickups): regras, projéteis, status e efeitos. */
  readonly sp: SpecialSystem;
  private nav = buildNavGraph(this.world);

  readonly actors = new Map<string, Actor>();
  local: Actor | null = null;
  private bots = new Map<string, BotBrain>();
  match: Match | null = null;
  net: NetLink | null = null;
  /** Ganchos de rede: o host replica entrada/saída de actors (inclusive bots) para os clientes. */
  onActorAdd: ((a: Actor) => void) | null = null;
  onActorRemove: ((id: string) => void) | null = null;

  /** Em partida (offline ou online). */
  inSession = false;
  private acc = 0;
  private time = 0;
  private jumpQueued = false;
  private damageFlash = 0;
  private deadFade = 0;
  private killerName = '';
  private fpsCount = 0;
  private fpsTime = 0;
  fps = 0;
  private lastLookDX = 0;
  private lastLookDY = 0;
  private sprintAmt = 0;
  /** Corrida ligada (Shift é toggle). */
  private sprintOn = false;
  private speedFov = 0;
  private slideTilt = 0;
  private footDist = new Map<string, number>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.camera.rotation.order = 'YXZ';
    this.env = buildEnvironment(this.scene, DUST);
    this.effects = new Effects(this.scene, this.camera);
    this.scene.add(this.camera);
    this.sp = new SpecialSystem(this);
    this.wireFeel();
  }

  // ---------------------------------------------------------------- sessão

  /** Começa partida. Offline: net = null (somos o host). */
  startSession(net: NetLink | null, localName: string): void {
    this.endSession();
    this.net = net;
    const id = net?.localId ?? 'local';
    // Sem nome: online os outros veriam "Você" no kill feed, então usa um genérico
    const fallback = !net ? 'Você' : net.isHost ? 'Host' : `Jogador ${id.slice(-2)}`;
    this.local = this.addActor(id, localName.trim() || fallback, false, true, ACTOR_COLORS[0], settings.face);
    net?.attach(this);
    if (this.isHost) {
      this.match = new Match({
        actors: () => this.actors.values(),
        getActor: (aid) => this.actors.get(aid),
        pickSpawn: (aid) => this.pickSpawn(aid),
        mode: () => this.mode,
        publish: (e) => {
          this.applyMatchEvent(e);
          this.net?.broadcastMatch(e);
        },
      });
      this.syncBots();
      this.match.start();
    }
    this.inSession = true;
  }

  endSession(): void {
    this.net?.close();
    for (const id of [...this.actors.keys()]) this.removeActor(id);
    this.onActorAdd = null;
    this.onActorRemove = null;
    this.net = null;
    this.match = null;
    this.local = null;
    this.inSession = false;
    this.sp.reset();
  }

  /** Host: aplica um evento de partida localmente e manda para os clientes. */
  hostPublish(e: MatchEvent): void {
    this.applyMatchEvent(e);
    this.net?.broadcastMatch(e);
  }

  get isHost(): boolean {
    return !this.net || this.net.isHost;
  }

  /** Modo da partida: o do host (clientes recebem pela rede). */
  get mode(): 'gungame' | 'treino' {
    return this.net && !this.net.isHost ? this.net.mode : settings.mode;
  }

  /** Host: ajusta quantidade de bots conforme settings.botCount. */
  syncBots(): void {
    if (!this.isHost || !this.match) return;
    const want = settings.botCount;
    const current = [...this.bots.keys()];
    for (let i = current.length; i < want; i++) {
      let n = 0;
      while (this.actors.has(`bot-${n}`)) n++;
      const a = this.addActor(`bot-${n}`, botName(n), true, false, ACTOR_COLORS[(n + 1) % ACTOR_COLORS.length]);
      this.match.join(a);
    }
    for (let i = current.length - 1; i >= want; i--) this.removeActor(current[i]);
  }

  addActor(id: string, name: string, isBot: boolean, isLocal: boolean, color: number, face: string | null = null): Actor {
    this.removeActor(id);
    const a = new Actor(id, name, isBot, isLocal, color);
    if (!isBot) a.face = face; // definido antes do hook onActorAdd (o host repassa a face no 'join')
    if (!isLocal) {
      a.model = new CharacterModel(color, hashSeed(id));
      a.model.root.visible = false;
      this.scene.add(a.model.root);
      if (a.face) this.loadActorFace(a);
    }
    if (isBot) {
      const brain = new BotBrain(a, this.nav);
      brain.onFootstep = () => bus.emit('actor:footstep', { actorId: a.id, pos: a.pos.clone() });
      this.bots.set(id, brain);
    }
    this.actors.set(id, a);
    this.onActorAdd?.(a);
    return a;
  }

  /** Jogador remoto entrou (chamado pela rede). No host, já entra na partida. */
  addRemoteActor(id: string, name: string, color: number, face: string | null = null): Actor {
    const a = this.addActor(id, name, false, false, color, face);
    this.match?.join(a);
    return a;
  }

  /** Carrega a face (data URL) do actor numa textura e aplica no modelo; descarta a textura anterior. */
  private loadActorFace(a: Actor): void {
    const face = a.face;
    if (!face || !a.model) return;
    loadFaceTexture(face).then(
      (tex) => {
        if (this.actors.get(a.id) !== a || a.face !== face || !a.model) { tex.dispose(); return; } // saiu/trocou no meio
        a.faceTex?.dispose();
        a.faceTex = tex;
        (a.model as any).setFace?.(tex);
      },
      () => { /* imagem inválida: fica sem face */ },
    );
  }

  removeActor(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    if (a.faceTex) {
      (a.model as any)?.setFace?.(null);
      a.faceTex.dispose();
      a.faceTex = null;
    }
    if (a.model) {
      this.scene.remove(a.model.root);
      a.model.dispose();
    }
    this.bots.delete(id);
    this.sp.removeActor(id);
    this.match?.leave(id);
    this.actors.delete(id);
    this.onActorRemove?.(id);
  }

  // ---------------------------------------------------------------- rede

  /** Snapshot de movimento de um actor remoto (pos/yaw...). `t` em segundos do relógio local. */
  pushSnap(id: string, snap: Omit<ActorSnap, 't'>): void {
    const a = this.actors.get(id);
    if (!a || a.isLocal) return;
    a.snaps.push({ ...snap, t: this.time });
    if (a.snaps.length > 30) a.snaps.shift();
  }

  /** Host recebeu pedido de dano de um cliente. */
  hostApplyDamage(r: DamageRequest): void {
    this.match?.applyDamage(r);
  }

  localSnap(): Omit<ActorSnap, 't'> | null {
    const a = this.local;
    if (!a) return null;
    return { pos: a.pos.clone(), yaw: a.yaw, pitch: a.pitch, crouched: a.crouched, speed: a.speed, grounded: a.grounded };
  }

  requestDamage(r: DamageRequest): void {
    if (this.isHost) this.match?.applyDamage(r);
    else this.net?.sendDamage(r);
  }

  /** Aplica um evento de partida (host aplica o que publicou; clientes aplicam o que recebem). */
  applyMatchEvent(e: MatchEvent): void {
    if (this.sp.onEvent(e)) return; // pickups, armas malucas, impulso e status
    switch (e.t) {
      case 'damage': {
        const v = this.actors.get(e.victim);
        if (!v) return;
        v.hp = e.hp;
        if (v.isLocal) {
          const att = this.actors.get(e.attacker);
          const noDir = e.dir[0] === 0 && e.dir[1] === 0 && e.dir[2] === 0; // dano por tempo / queda: sem direção
          const from = att && !noDir ? _v.subVectors(att.pos, v.pos).setY(0).normalize().clone() : null;
          bus.emit('player:damage', { amount: e.dmg, fromDir: from, health: e.hp });
        } else {
          v.model?.onHurt(e.headshot);
          bus.emit('actor:hurt', { actorId: v.id, pos: v.pos.clone(), damage: e.dmg, headshot: e.headshot });
        }
        break;
      }
      case 'kill': {
        const v = this.actors.get(e.victim);
        const k = this.actors.get(e.killer);
        if (!v) return;
        v.alive = false;
        v.hp = 0;
        v.deaths++;
        v.respawnAt = this.time + RESPAWN_TIME;
        if (k && k !== v) k.kills++;
        const dir = k ? _v.subVectors(v.pos, k.pos).normalize().clone() : new THREE.Vector3(0, 0, 1);
        bus.emit('kill', {
          killerId: e.killer, killer: k?.name ?? '???', victimId: v.id, victim: v.name, weapon: e.weapon as WeaponId, headshot: e.headshot,
          localKiller: !!k?.isLocal, localVictim: v.isLocal,
        });
        bus.emit('actor:death', { actorId: v.id, pos: v.pos.clone(), dir, headshot: e.headshot });
        if (v.isLocal) {
          this.weapons.holster(); // sai da luneta/mira, cancela recarga
          this.jumpQueued = false;
          this.killerName = k?.name ?? '';
          bus.emit('player:death', { killer: this.killerName, weapon: e.weapon as WeaponId });
        } else {
          v.model?.die(dir, e.headshot);
        }
        break;
      }
      case 'level': {
        const a = this.actors.get(e.id);
        if (!a) return;
        const up = e.level > a.level;
        const changed = e.level !== a.level;
        a.level = e.level;
        a.levelKills = e.levelKills;
        if (this.mode === 'gungame') {
          a.weapon = GUNGAME_LADDER[Math.min(e.level, GUNGAME_LADDER.length - 1)];
        }
        if (a.isLocal && changed) {
          if (!a.special) this.weapons.equip(a.weapon); // com arma maluca na mão, só troca quando ela acabar
          bus.emit('gungame:level', { level: e.level, total: GUNGAME_LADDER.length, weapon: a.weapon, up });
        }
        break;
      }
      case 'spawn': {
        const a = this.actors.get(e.id);
        if (!a) return;
        a.pos.set(...e.pos);
        a.vel.set(0, 0, 0);
        a.yaw = e.yaw;
        a.pitch = 0;
        a.hp = MAX_HP;
        a.alive = true;
        a.weapon = e.weapon;
        a.snaps.length = 0;
        if (a.isLocal) {
          this.player.teleport(a.pos, e.yaw);
          this.jumpQueued = false;
          this.weapons.equip(e.weapon, true);
          this.weapons.reset();
          bus.emit('player:respawn', {});
        } else {
          a.model?.respawn();
          if (a.model) a.model.root.visible = true;
          this.bots.get(a.id)?.respawned();
        }
        bus.emit('actor:spawn', { actorId: a.id, pos: a.pos.clone() });
        break;
      }
      case 'end': {
        const w = this.actors.get(e.winner);
        bus.emit('match:end', { winner: w?.name ?? '???', winnerIsLocal: !!w?.isLocal });
        break;
      }
      case 'start':
        for (const a of this.actors.values()) { a.kills = 0; a.deaths = 0; }
        bus.emit('match:start', {});
        break;
    }
  }

  private pickSpawn(forId: string): { pos: V3; yaw: number } {
    const spawns = this.world.map.spawns;
    const scored = spawns.map((s) => {
      let minD = 999;
      for (const a of this.actors.values()) {
        if (a.id === forId || !a.alive) continue;
        minD = Math.min(minD, Math.hypot(a.pos.x - s.pos[0], a.pos.z - s.pos[2]));
      }
      return { s, score: minD + Math.random() * 8 };
    });
    scored.sort((a, b) => b.score - a.score);
    const s = scored[0].s;
    return { pos: [s.pos[0], s.pos[1] + 0.05, s.pos[2]], yaw: s.yaw };
  }

  // ---------------------------------------------------------------- tiro

  /** Hitscan genérico (jogador local e bots). Calcula acertos, emite efeitos e pede dano. */
  fire(shooter: Actor, def: WeaponDef, origin: THREE.Vector3, dirs: THREE.Vector3[]): void {
    const ends: THREE.Vector3[] = [];
    const perVictim = new Map<string, { dmg: number; head: boolean; point: THREE.Vector3 }>();
    for (const dir of dirs) {
      const wh = this.world.raycast(origin, dir, def.range);
      let maxD = wh ? wh.dist : def.range;
      let victim: Actor | null = null, head = false;
      for (const a of this.actors.values()) {
        if (a === shooter) continue;
        const h = a.hitTest(origin, dir, maxD);
        if (h) { maxD = h.dist; victim = a; head = h.head; }
      }
      const end = origin.clone().addScaledVector(dir, maxD);
      ends.push(end);
      if (victim) {
        const fall = maxD <= def.falloffStart ? 1 : Math.max(def.falloffMin, 1 - ((maxD - def.falloffStart) / (def.range - def.falloffStart)) * (1 - def.falloffMin));
        const dmg = def.damage * fall * (head ? def.headMult : 1);
        const cur = perVictim.get(victim.id) ?? { dmg: 0, head: false, point: end };
        cur.dmg += dmg;
        cur.head ||= head;
        perVictim.set(victim.id, cur);
        bus.emit('weapon:impact', { point: end, normal: dir.clone().negate(), surface: 'flesh' });
      } else if (wh) {
        bus.emit('weapon:impact', { point: end, normal: wh.normal.clone(), surface: 'world', material: wh.material });
      }
    }
    bus.emit('weapon:fire', { actorId: shooter.id, local: shooter.isLocal, weapon: def.id, origin: origin.clone(), dirs, ends });
    shooter.model?.onFire();

    for (const [vid, h] of perVictim) {
      const v = this.actors.get(vid)!;
      const dir = dirs[0];
      if (shooter.isLocal) {
        bus.emit('hit:confirm', { damage: Math.round(h.dmg), headshot: h.head, killed: h.dmg >= v.hp, point: h.point });
      }
      this.requestDamage({ attacker: shooter.id, victim: vid, dmg: Math.round(h.dmg), headshot: h.head, weapon: def.id, dir: [dir.x, dir.y, dir.z] });
    }
  }

  /** Faca: alguns raios num cone curto. */
  melee(shooter: Actor, def: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, heavy: boolean): boolean {
    const range = def.melee!.range;
    let best: Actor | null = null, bestD = range, head = false;
    const offsets = [[0, 0], [0.12, 0], [-0.12, 0], [0, -0.15], [0, 0.1]];
    const right = _v2.crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    for (const [ox, oy] of offsets) {
      const d = dir.clone().addScaledVector(right, ox).add(new THREE.Vector3(0, oy, 0)).normalize();
      const wh = this.world.raycast(origin, d, range);
      const maxD = wh ? wh.dist : range;
      for (const a of this.actors.values()) {
        if (a === shooter) continue;
        const h = a.hitTest(origin, d, Math.min(maxD, bestD));
        if (h) { best = a; bestD = h.dist; head = h.head; }
      }
    }
    if (!best) {
      const wh = this.world.raycast(origin, dir, range);
      if (wh) bus.emit('weapon:impact', { point: wh.point.clone(), normal: wh.normal.clone(), surface: 'world', material: wh.material });
      return false;
    }
    const dmg = heavy ? def.melee!.heavyDamage : def.damage;
    const point = origin.clone().addScaledVector(dir, bestD);
    bus.emit('weapon:impact', { point, normal: dir.clone().negate(), surface: 'flesh' });
    if (shooter.isLocal) bus.emit('hit:confirm', { damage: dmg, headshot: head, killed: dmg >= best.hp, point });
    this.requestDamage({ attacker: shooter.id, victim: best.id, dmg, headshot: head, weapon: def.id, dir: [dir.x, dir.y, dir.z] });
    return true;
  }

  // ---------------------------------------------------------------- feel

  private wireFeel(): void {
    bus.on('weapon:fire', (e) => {
      if (!e.local) return;
      const d = WEAPONS[e.weapon];
      this.camfx.addTrauma(Math.min(0.35, d.kick * 0.03));
      this.camfx.punchFov(Math.min(3, d.kick * 0.35));
    });
    bus.on('player:slide', () => {
      this.camfx.punchFov(5);
      this.camfx.addTrauma(0.12);
    });
    bus.on('player:land', (e) => {
      this.camfx.land(e.impact);
      if (e.impact > 9) this.camfx.addTrauma(0.15);
    });
    bus.on('player:damage', (e) => {
      this.damageFlash = Math.min(1, this.damageFlash + e.amount / 50);
      let side = 0;
      if (e.fromDir) {
        const rx = Math.cos(this.player.yaw), rz = -Math.sin(this.player.yaw);
        side = -(e.fromDir.x * rx + e.fromDir.z * rz);
      }
      this.camfx.hurt(side, e.amount);
    });
    bus.on('hit:confirm', (e) => {
      if (e.killed) this.camfx.punchFov(-1.5);
    });
  }

  // ---------------------------------------------------------------- loop

  /** `render: false` = só simula (aba em segundo plano, o host não pode congelar a partida). */
  frame(dtRaw: number, render = true): void {
    const dt = Math.min(dtRaw, 0.1);
    this.time += dt;
    this.fpsCount++;
    this.fpsTime += dtRaw;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsCount / this.fpsTime);
      this.fpsCount = 0;
      this.fpsTime = 0;
    }

    const inp = this.input;
    const local = this.local;
    const playing = this.inSession && inp.locked && local;

    // Atordoado (tijolo na cabeça): mira travada
    if (playing && local.alive && !this.sp.status.has(local.id, 'stun')) this.handleLook();
    else { this.lastLookDX = 0; this.lastLookDY = 0; }

    if (playing && inp.pressed('Space')) this.jumpQueued = true;

    // Corrida em toggle (estilo CoD): Shift liga/desliga; para ao soltar o W, atirar, mirar ou agachar
    if (playing && local.alive) {
      if (inp.pressed('ShiftLeft') || inp.pressed('ShiftRight')) this.sprintOn = !this.sprintOn;
      const crouching = inp.down('ControlLeft') || inp.down('KeyC');
      if (!inp.down('KeyW') || inp.mouseDown(0) || inp.mouseDown(2) || crouching) this.sprintOn = false;
    } else {
      this.sprintOn = false;
    }

    // Simulação em tick fixo
    this.acc += dt;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick(TICK, !!playing);
    }
    const alpha = this.acc / TICK;

    // Armas (por frame, para resposta imediata)
    if (local && local.alive && this.inSession) {
      const treino = this.mode === 'treino';
      if (playing && treino) {
        const keys: WeaponId[] = ['smg', 'rifle', 'shotgun', 'sniper', 'pistol', 'knife'];
        keys.forEach((w, i) => {
          if (inp.pressed(`Digit${i + 1}`) && (this.weapons.current !== w || local.special)) {
            if (local.special) this.sp.dropLocal(); // largar a arma maluca
            this.weapons.equip(w, false, true);
            local.weapon = w;
          }
        });
      }
      if (local.special) {
        // Arma maluca na mão: ela assume o botão de tiro; a arma comum fica guardada
        this.sp.controlLocal(dt, {
          held: !!playing && inp.mouseDown(0) && !this.player.sprinting,
          pressed: !!playing && inp.mousePressed(0) && !this.player.sprinting,
        });
      } else {
        this.weapons.update(
          dt,
          {
            fire: !!playing && inp.mouseDown(0),
            firePressed: !!playing && inp.mousePressed(0),
            altPressed: !!playing && inp.mousePressed(2),
            reloadPressed: !!playing && inp.pressed('KeyR'),
            aim: !!playing && inp.mouseDown(2),
            sprinting: this.player.sprinting,
          },
          this.aimContext(),
          (def, origin, dirs) => this.fire(local, def, origin, dirs),
          (def, origin, dir, heavy) => this.melee(local, def, origin, dir, heavy),
        );
      }
    }

    this.match?.update(dt);
    this.updateRemoteActors(dt);
    this.sp.frame(dt, alpha);
    this.updateCamera(dt, alpha);
    this.net?.update(dt);

    this.effects.update(dt);
    this.env.update(dt, this.camera);
    this.audio.update(dt, this.camera);
    this.vm.update(dt, {
      weapon: this.weapons.current,
      speed: this.player.speed,
      grounded: this.player.grounded,
      crouched: this.player.crouched,
      lookDX: this.lastLookDX,
      lookDY: this.lastLookDY,
      zoomed: !local?.special && this.weapons.zoomed && !!this.weapons.def.zoomFov,
      dead: !local || !local.alive,
      aspect: this.renderer.aspect,
      ads: smooth01(this.weapons.ads),
      sprint: this.sprintAmt,
      // arma maluca na mão: o viewmodel troca a arma comum pelo item + braços
      special: local?.alive ? local.special : null,
    });

    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    const deadTarget = local && !local.alive ? 1 : 0;
    this.deadFade += (deadTarget - this.deadFade) * Math.min(1, dt * 4);

    const showVm = this.inSession && local?.alive;
    if (render) this.renderer.render(this.scene, this.camera, showVm ? this.vm.scene : null, showVm ? this.vm.camera : null, {
      time: this.time,
      damage: this.damageFlash,
      dead: this.deadFade,
    });
    inp.endFrame();
  }

  private handleLook(): void {
    const inp = this.input;
    // Sensibilidade proporcional ao zoom atual (mira/luneta)
    const sens = settings.sensitivity * 0.022 * DEG * Math.min(1, this.camera.fov / settings.fov);
    this.player.yaw -= inp.mouseDX * sens;
    this.player.pitch -= inp.mouseDY * sens * (settings.invertY ? -1 : 1);
    this.player.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, this.player.pitch));
    this.lastLookDX = inp.mouseDX;
    this.lastLookDY = inp.mouseDY;
  }

  private aimContext() {
    const p = this.player;
    const eye = new THREE.Vector3(p.pos.x, p.pos.y + p.eye, p.pos.z);
    return { eye, yaw: p.yaw, pitch: p.pitch, speed: p.speed, grounded: p.grounded, crouched: p.crouched };
  }

  private tick(dt: number, playing: boolean): void {
    const local = this.local;
    if (local && local.alive) {
      const inp = this.input;
      const k = (c: string) => (playing && inp.down(c) ? 1 : 0);
      this.player.tick(dt, {
        forward: k('KeyW') - k('KeyS'),
        right: k('KeyD') - k('KeyA'),
        // Segurar espaço pula de novo ao tocar o chão (bunny hop)
        jump: this.jumpQueued || !!k('Space'),
        crouch: !!k('ControlLeft') || !!k('KeyC'),
        sprint: this.sprintOn,
        speedMult: (local.special ? 1 : this.weapons.def.moveMult * (1 - 0.3 * this.weapons.ads)) * (this.sp.status.has(local.id, 'stun') ? 0.7 : 1),
      });
      this.jumpQueued = false;
      local.pos.copy(this.player.pos);
      local.yaw = this.player.yaw;
      local.pitch = this.player.pitch;
      local.crouched = this.player.crouched;
      local.grounded = this.player.grounded;
      local.speed = this.player.speed;
    }
    this.sp.tick(dt);
    if (this.isHost && this.match && !this.match.ended) {
      const host = {
        world: this.world,
        actors: () => this.actors.values(),
        difficulty: () => settings.botDifficulty,
        special: (a: Actor, d: number, held: boolean, pressed: boolean, dir: THREE.Vector3) =>
          this.sp.controlBot(a, d, { held, pressed }, dir),
        stunned: (a: Actor) => this.sp.status.has(a.id, 'stun'),
        blinded: (a: Actor) => this.sp.status.has(a.id, 'blind'),
        pickupNear: (a: Actor) => (a.special ? null : this.sp.pickups.nearest(a.pos.x, a.pos.z, 45)),
        fire: (a: Actor, d: WeaponDef, o: THREE.Vector3, dirs: THREE.Vector3[]) => this.fire(a, d, o, dirs),
        melee: (a: Actor, d: WeaponDef, o: THREE.Vector3, dir: THREE.Vector3, heavy: boolean) => {
          const hit = this.melee(a, d, o, dir, heavy);
          bus.emit('weapon:melee', { actorId: a.id, local: false, weapon: d.id, hit, heavy, origin: o.clone() });
          return hit;
        },
      };
      for (const b of this.bots.values()) b.tick(dt, host);
    }
  }

  /** Interpola remotos, posiciona modelos. */
  private updateRemoteActors(dt: number): void {
    const renderT = this.time - INTERP_DELAY;
    for (const a of this.actors.values()) {
      if (a.isLocal) continue;
      if ((!a.isBot || !this.isHost) && a.snaps.length) {
        const s = a.snaps;
        while (s.length >= 3 && s[1].t <= renderT) s.shift();
        const s0 = s[0], s1 = s[1];
        if (s1 && renderT >= s0.t) {
          const f = Math.min(1, (renderT - s0.t) / Math.max(1e-3, s1.t - s0.t));
          a.pos.lerpVectors(s0.pos, s1.pos, f);
          a.yaw = s0.yaw + wrap(s1.yaw - s0.yaw) * f;
          a.pitch = s0.pitch + (s1.pitch - s0.pitch) * f;
          a.crouched = f < 0.5 ? s0.crouched : s1.crouched;
          a.speed = s1.speed;
          a.grounded = s1.grounded;
        } else {
          const last = s[s.length - 1];
          a.pos.copy(last.pos);
          a.yaw = last.yaw;
          a.pitch = last.pitch;
          a.crouched = last.crouched;
          a.speed = last.speed;
          a.grounded = last.grounded;
        }
      }
      // Passos de jogadores remotos (bots emitem os próprios no host)
      if (!(a.isBot && this.isHost) && a.alive && a.grounded && a.speed > 2.5 && !a.crouched) {
        const d = (this.footDist.get(a.id) ?? 0) + a.speed * dt;
        if (d > 2.1) bus.emit('actor:footstep', { actorId: a.id, pos: a.pos.clone() });
        this.footDist.set(a.id, d > 2.1 ? 0 : d);
      }
      const m = a.model;
      if (!m) continue;
      m.root.position.copy(a.pos);
      m.root.rotation.y = a.yaw;
      m.update(dt, { speed: a.speed, grounded: a.grounded, crouched: a.crouched, pitch: a.pitch, weapon: a.weapon, special: a.alive ? a.special : null });
    }
  }

  private updateCamera(dt: number, alpha: number): void {
    const p = this.player;
    const cam = this.camera;
    const local = this.local;
    this.camfx.update(dt);

    if (local && !local.alive) {
      // Câmera de morte: cai pro chão e inclina
      cam.position.y += ((local.pos.y + 0.35) - cam.position.y) * Math.min(1, dt * 6);
      cam.rotation.z += (0.5 - cam.rotation.z) * Math.min(1, dt * 4);
      cam.fov = settings.fov;
      cam.updateProjectionMatrix();
      return;
    }

    const x = p.prevPos.x + (p.pos.x - p.prevPos.x) * alpha;
    const y = p.prevPos.y + (p.pos.y - p.prevPos.y) * alpha;
    const z = p.prevPos.z + (p.pos.z - p.prevPos.z) * alpha;
    const eye = p.prevEye + (p.eye - p.prevEye) * alpha;
    cam.position.set(x, y + eye + p.stepSmooth + this.camfx.offsetY, z);
    // Slide inclina a câmera de leve
    this.slideTilt += ((p.sliding ? 0.07 : 0) - this.slideTilt) * Math.min(1, dt * 10);
    cam.rotation.set(
      p.pitch + this.weapons.recoilPitch + this.camfx.pitch,
      p.yaw + this.weapons.recoilYaw + this.camfx.yaw,
      this.camfx.rollOut + this.slideTilt,
    );
    const w = this.weapons;
    this.sprintAmt += ((p.sprinting && p.speed > 3 ? 1 : 0) - this.sprintAmt) * Math.min(1, dt * 10);
    // Sensação de velocidade: FOV abre conforme passa da corrida normal (bhop/slide)
    const fast = Math.min(16, Math.max(0, p.speed - 8.5) * 0.9);
    this.speedFov += (fast - this.speedFov) * Math.min(1, dt * 4);
    const zoom = w.zoomed && w.def.zoomFov
      ? w.def.zoomFov
      : settings.fov * (1 + (w.def.adsZoom - 1) * smooth01(w.ads)) + this.sprintAmt * 4 + this.speedFov;
    const targetFov = zoom + this.camfx.fovAdd;
    if (Math.abs(cam.fov - targetFov) > 0.01 || cam.aspect !== this.renderer.aspect) {
      cam.fov = targetFov;
      cam.aspect = this.renderer.aspect;
      cam.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------- HUD

  hudState(): HudState {
    const local = this.local;
    const w = this.weapons;
    const rows: ScoreRow[] = [...this.actors.values()]
      .map((a) => ({
        id: a.id, name: a.name, kills: a.kills, deaths: a.deaths, level: a.level, ping: a.ping,
        isLocal: a.isLocal, isBot: a.isBot, alive: a.alive, color: a.color,
      }))
      .sort((a, b) => b.level - a.level || b.kills - a.kills || a.deaths - b.deaths);
    const leaderRow = rows[0];
    const sph = this.sp.hud();
    // Com arma maluca na mão, os campos de arma/munição já descrevem ela (o HUD antigo funciona sem mudanças).
    const spDef = sph.special ? anyWeaponDef(sph.special.id) : null;
    return {
      health: local?.hp ?? 0,
      weapon: spDef ?? w.def,
      ammo: sph.special ? sph.special.ammo : w.ammo,
      reloading: !sph.special && w.state === 'reloading',
      reloadProgress: sph.special ? 0 : w.reloadProgress,
      switching: !sph.special && w.state === 'switching',
      spread: sph.special ? 0.012 : w.spread(this.aimContext()),
      fov: this.camera.fov,
      zoomed: !sph.special && w.zoomed && !!w.def.zoomFov,
      mode: this.mode,
      level: local?.level ?? 0,
      levelKills: local?.levelKills ?? 0,
      killsNeeded: killsNeeded(local?.level ?? 0),
      ladder: GUNGAME_LADDER,
      dead: !!local && !local.alive,
      respawnIn: local && !local.alive ? Math.max(0, local.respawnAt - this.time) : 0,
      killerName: this.killerName,
      showScoreboard: this.input.down('Tab'),
      scoreboard: rows,
      leader: leaderRow ? { name: leaderRow.name, level: leaderRow.level, isLocal: leaderRow.isLocal } : null,
      fps: this.fps,
      speed: this.player.speed,
      yaw: this.player.yaw,
      ads: sph.special ? 0 : w.ads,
      sprinting: this.sprintAmt > 0.5,
      posX: this.player.pos.x,
      posZ: this.player.pos.z,
      radar: [...this.actors.values()]
        .filter((a) => !a.isLocal)
        .map((a) => ({ id: a.id, x: a.pos.x, z: a.pos.z, alive: a.alive })),
      special: sph.special,
      charge: sph.charge,
      blind: sph.blind,
      burning: sph.burning,
      stunned: sph.stunned,
      shocked: sph.shocked,
      pickups: sph.pickups,
    };
  }
}

function smooth01(t: number): number {
  return t * t * (3 - 2 * t);
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
