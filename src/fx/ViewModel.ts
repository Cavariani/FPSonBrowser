import * as THREE from 'three';
import { bus } from '../core/events';
import type { SpecialId } from '../game/special/defs';
import type { WeaponId } from '../game/weaponDefs';
import { applyPose, pose, type Pose } from './vm/arms';
import { Builder, flashTexture, PAL, vmMaterial } from './vm/build';
import { buildWeapons, type WeaponModel } from './vm/models';
import { SpecialHands } from './vm/specialRig';
import { clamp01, easeOutBack, pulse, seg, smooth, Spring3 } from './vm/spring';

export interface ViewModelState {
  weapon: WeaponId;
  /** Velocidade horizontal m/s. */
  speed: number;
  grounded: boolean;
  crouched: boolean;
  /** Delta do mouse neste frame (px), para sway. */
  lookDX: number;
  lookDY: number;
  zoomed: boolean;
  dead: boolean;
  aspect: number;
  /** Mirando (ADS) 0..1, já suavizado pelo Game. */
  ads?: number;
  /** Correndo 0..1, já suavizado pelo Game. */
  sprint?: number;
  /** Arma maluca na mão (substitui a arma comum no viewmodel). */
  special?: SpecialId | null;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const MAX_CASINGS = 12;

interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

/** Poses extras de mão esquerda (no espaço da arma) usadas na recarga. */
interface ReloadPoses {
  grab: Pose;
  down: Pose;
  charge: Pose;
  port: Pose;
  /** Mão direita no ferrolho (sniper). */
  bolt: Pose;
}

/**
 * Arma em primeira pessoa. Cena própria, renderizada por cima do mundo (não atravessa parede).
 * Tudo procedural: bob, sway, respiração, recuo com mola, ferrolho/pump/bolt, recarga, troca,
 * golpe da faca, pouso, agachar, muzzle flash + luz só no viewmodel e cápsulas ejetadas.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);

  private models: Record<WeaponId, WeaponModel>;
  private poses = {} as Record<WeaponId, ReloadPoses>;
  private holder = new THREE.Group();
  private shown: WeaponId | null = null;
  private m!: WeaponModel;

  // estado de animação
  private t = 0;
  private bobPhase = 0;
  private moveAmt = 0;
  private airAmt = 0;
  private crouchAmt = 0;
  private recoilPos = new Spring3();
  private recoilRot = new Spring3();
  private swayRot = new Spring3();
  private land = new Spring3();
  private swayTarget = new THREE.Vector3();

  private switchT = 1;
  private switchDur = 0;
  private switchTo: WeaponId | null = null;
  private swapped = true;

  private reloadT = 0;
  private reloadDur = 0;
  private reloading = false;

  private sinceShot = 99;
  private meleeT = 99;
  private meleeHeavy = false;
  private meleeSide = 1;
  private hitstop = 0;
  /** Cápsula do ciclo manual (pump/bolt) já ejetada. */
  private cycled = true;

  // flash
  private flash: THREE.Group;
  private flashFrames = 0;
  private flashLight = new THREE.PointLight(0xffc070, 0, 2.5, 1.6);
  private flashPower = 0;

  // cápsulas
  private casings: Casing[] = [];
  private casingIdx = 0;
  private brassGeo: THREE.BufferGeometry;
  private shellGeo: THREE.BufferGeometry;
  private shellInHand: THREE.Mesh;

  private visible = true;
  private lastAspect = 0;
  private sp: SpecialHands;
  private static readonly SP_FEEL = { bob: 1.1, sway: 1.2 };

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6a5a48, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-0.6, 1, 0.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd6ff, 0.5);
    rim.position.set(1, -0.2, -0.6);
    this.scene.add(rim);
    this.scene.add(this.flashLight);
    this.scene.add(this.holder);
    this.holder.rotation.order = 'YXZ';

    this.sp = new SpecialHands(this.scene, (back, up, side) => {
      this.recoilPos.kick(0, up * 0.08, back);
      this.recoilRot.kick(up, (Math.random() * 2 - 1) * side, (Math.random() * 2 - 1) * side);
    });
    this.holder.add(this.sp.root);

    this.models = buildWeapons();
    for (const id of Object.keys(this.models) as WeaponId[]) {
      const m = this.models[id];
      m.root.visible = false;
      this.holder.add(m.root);
      this.poses[id] = this.reloadPoses(m);
      m.rightArm.rotation.order = 'YXZ';
      applyPose(m.rightArm, m.rightHold, m.rightHold, 0);
      if (m.leftArm && m.leftHold) applyPose(m.leftArm, m.leftHold, m.leftHold, 0);
    }

    // muzzle flash: 3 planos cruzados aditivos
    const fm = new THREE.MeshBasicMaterial({
      map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), fm);
    const side1 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.24), fm);
    side1.rotation.x = Math.PI / 2;
    side1.position.z = -0.08;
    const side2 = side1.clone();
    side2.rotation.y = Math.PI / 2;
    this.flash.add(front, side1, side2);
    this.flash.traverse((o) => { o.frustumCulled = false; o.renderOrder = 10; });
    this.flash.visible = false;

    // cápsulas
    this.brassGeo = new Builder().cyl(PAL.brass, 0.005, 0.022, 0, 0, 0, Math.PI / 2, 0, 0, 5).build();
    this.shellGeo = new Builder().cyl(PAL.red, 0.009, 0.04, 0, 0.005, 0, 0, 0, 0, 6).cyl(PAL.brass, 0.0095, 0.012, 0, -0.018, 0, 0, 0, 0, 6).build();
    for (let i = 0; i < MAX_CASINGS; i++) {
      const mesh = new THREE.Mesh(this.brassGeo, vmMaterial);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.casings.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    // cartucho na mão esquerda (recarga da escopeta)
    this.shellInHand = new THREE.Mesh(this.shellGeo, vmMaterial);
    this.shellInHand.position.set(0.0, -0.035, -0.03);
    this.shellInHand.rotation.set(0, 0, Math.PI / 2);
    this.shellInHand.visible = false;
    this.models.shotgun.leftArm?.add(this.shellInHand);

    this.recoilPos.k = 260; this.recoilPos.c = 22;
    this.recoilRot.k = 260; this.recoilRot.c = 22;
    this.swayRot.k = 140; this.swayRot.c = 15;
    this.land.k = 120; this.land.c = 13;

    this.wire();
  }

  // ------------------------------------------------------------ eventos

  private wire(): void {
    bus.on('weapon:fire', (e) => {
      if (!e.local) return;
      this.onFire();
    });
    bus.on('weapon:reload', (e) => {
      this.reloading = true;
      this.reloadT = 0;
      this.reloadDur = Math.max(0.2, e.duration);
    });
    bus.on('weapon:reloaded', () => {
      this.reloading = false;
    });
    bus.on('weapon:switch', (e) => {
      this.startSwitch(e.to, e.duration);
    });
    bus.on('weapon:melee', (e) => {
      if (!e.local) return;
      this.meleeT = 0;
      this.meleeHeavy = e.heavy;
      this.meleeSide = -this.meleeSide;
      if (e.hit) {
        this.hitstop = Math.max(this.hitstop, e.heavy ? 0.09 : 0.05);
        this.recoilRot.kick(0, 0, 0.03 * this.meleeSide);
      }
    });
    bus.on('weapon:dryfire', () => {
      this.recoilRot.kick(0.012, 0, 0.004);
      this.recoilPos.kick(0, 0, 0.004);
    });
    bus.on('hit:confirm', (e) => {
      if (e.killed) {
        this.hitstop = Math.max(this.hitstop, 0.075);
        this.recoilRot.kick(-0.015, 0, 0.02);
      }
    });
    bus.on('player:land', (e) => {
      const a = Math.min(1, e.impact / 14);
      this.land.kick(0, -0.03 * a - 0.006, 0);
      this.land.v.x += -0.15 * a; // usa x como pitch extra
    });
    bus.on('player:jump', () => {
      this.land.kick(0, 0.012, 0);
      this.land.v.x += 0.12;
    });
    bus.on('player:respawn', () => {
      this.reloading = false;
      this.meleeT = 99;
      this.sinceShot = 99;
      this.recoilPos.reset();
      this.recoilRot.reset();
      if (this.shown) this.startSwitch(this.shown, 0.5, true);
    });
  }

  private startSwitch(to: WeaponId, duration: number, raiseOnly = false): void {
    this.switchTo = to;
    this.switchDur = Math.max(0.15, duration);
    this.switchT = raiseOnly || !this.shown ? this.switchDur * 0.45 : 0;
    this.swapped = false;
    this.reloading = false;
    this.meleeT = 99;
    if (raiseOnly || !this.shown) this.show(to);
  }

  private show(id: WeaponId): void {
    if (this.shown) this.models[this.shown].root.visible = false;
    this.shown = id;
    this.m = this.models[id];
    this.m.root.visible = !this.sp.current;
    this.swapped = true;
    this.sinceShot = 99;
    this.flash.removeFromParent();
    this.m.muzzle.add(this.flash);
    this.recoilPos.k = this.recoilRot.k = this.m.feel.k;
    this.recoilPos.c = this.recoilRot.c = this.m.feel.c;
    this.resetParts();
  }

  private resetParts(): void {
    const m = this.m;
    if (m.mag && m.magRest) {
      m.mag.position.copy(m.magRest);
      m.mag.rotation.set(0, 0, 0);
      m.mag.visible = true;
    }
    if (m.slide) m.slide.position.z = m.id === 'pistol' ? 0 : m.slide.position.z;
    this.shellInHand.visible = false;
  }

  private onFire(): void {
    if (!this.m) return;
    const f = this.m.feel;
    const r = (a: number) => (Math.random() * 2 - 1) * a;
    this.recoilPos.kick(r(f.side * 0.3), f.rise, f.back);
    this.recoilRot.kick(f.up * (0.85 + Math.random() * 0.3), r(f.side), r(f.side * 1.6));
    this.sinceShot = 0;
    this.cycled = false;
    if (f.flash > 0) {
      this.flashFrames = 2;
      this.flash.visible = true;
      this.flash.rotation.z = Math.random() * Math.PI * 2;
      const s = f.flash * (0.85 + Math.random() * 0.4);
      this.flash.scale.set(s, s, s * (0.8 + Math.random() * 0.5));
      this.flashPower = 1;
    }
    // cápsula: armas de ação manual ejetam no ciclo (pump/bolt), não no disparo
    if (this.m.id !== 'shotgun' && this.m.id !== 'sniper') this.ejectCasing();
  }

  private ejectCasing(): void {
    const m = this.m;
    if (m.casing === 'none') return;
    const c = this.casings[this.casingIdx];
    this.casingIdx = (this.casingIdx + 1) % MAX_CASINGS;
    m.eject.getWorldPosition(c.mesh.position);
    c.mesh.geometry = m.casing === 'shell' ? this.shellGeo : this.brassGeo;
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    c.vel.set(0.9 + Math.random() * 0.6, 1.1 + Math.random() * 0.6, 0.15 + Math.random() * 0.3);
    if (m.casing === 'shell') c.vel.multiplyScalar(0.8);
    c.spin.set(r3(), r3(), r3());
    c.life = 0.7;
    c.mesh.visible = true;
  }

  // ------------------------------------------------------------ poses

  private reloadPoses(m: WeaponModel): ReloadPoses {
    const rest = m.magRest ?? new THREE.Vector3(0, 0.02, -0.1);
    const grab = pose(rest.x - 0.012, rest.y - 0.1, rest.z + 0.02, 0.8, -0.35, Math.PI);
    if (m.id === 'pistol') grab.p.set(-0.012, -0.1, 0.03);
    const down = pose(grab.p.x - 0.2, grab.p.y - 0.26, grab.p.z + 0.12, 1.1, -0.5, Math.PI);
    const sl = m.slide ? m.slide.position : new THREE.Vector3(0, 0.08, -0.05);
    const charge = m.id === 'pistol'
      ? pose(-0.004, 0.115, 0.035, 0.3, -0.25, 0.25)
      : pose(0.05, sl.y + 0.085, sl.z + 0.02, 0.45, 0.2, -1.2);
    const port = pose(-0.02, -0.025, -0.07, 0.8, -0.35, Math.PI);
    const bolt = pose(0.07, 0.07, 0.07, 0.3, 0.4, -1.1);
    return { grab, down, charge, port, bolt };
  }

  // ------------------------------------------------------------ update

  update(dtReal: number, s: ViewModelState): void {
    if (s.aspect !== this.lastAspect) {
      this.lastAspect = s.aspect;
      this.camera.aspect = s.aspect;
      this.camera.updateProjectionMatrix();
    }
    if (!this.shown) this.show(s.weapon);
    // troca sem evento (respawn/equip instantâneo)
    if (s.weapon !== this.shown && (this.switchTo !== s.weapon || this.switchT >= this.switchDur)) {
      this.startSwitch(s.weapon, 0.3, true);
    }

    const spId = s.special ?? null;
    if (spId !== this.sp.current) {
      this.sp.set(spId);
      if (this.m) this.m.root.visible = !spId;
      this.flash.visible = false;
      if (spId) this.reloading = false;
    }

    const vis = !s.dead && !s.zoomed;
    if (vis !== this.visible) {
      this.visible = vis;
      this.holder.visible = vis;
    }

    // hitstop: congela a animação por alguns ms
    let dt = Math.min(dtReal, 0.05);
    if (this.hitstop > 0) {
      this.hitstop -= dtReal;
      dt *= 0.06;
    }
    this.t += dt;
    this.sinceShot += dt;
    this.meleeT += dt;

    // flash dura 2 frames renderizados
    if (this.flashFrames > 0) {
      this.flashFrames--;
      if (this.flashFrames === 0) this.flash.visible = false;
    }
    this.flashPower = Math.max(0, this.flashPower - dtReal * 22);
    this.flashLight.intensity = this.flashPower * this.flashPower * 1.6 * (this.m?.feel.flash ?? 1);
    if (this.flashPower > 0) this.flash.getWorldPosition(this.flashLight.position);

    this.updateCasings(dtReal);
    if (!this.m) return;
    const m = this.m;
    const special = !!spId;
    const f = special ? ViewModel.SP_FEEL : m.feel;
    const hipPos = special ? this.sp.hipPos : m.hipPos;
    const hipRot = special ? this.sp.hipRot : m.hipRot;

    // ---- troca
    let down = 0;
    if (this.switchT < this.switchDur) {
      this.switchT += dt;
      const half = this.switchDur * 0.45;
      if (this.switchT < half) {
        down = smooth(this.switchT / half);
      } else {
        if (!this.swapped && this.switchTo) this.show(this.switchTo);
        down = 1 - easeOutBack((this.switchT - half) / (this.switchDur - half));
      }
    } else if (!this.swapped && this.switchTo) {
      this.show(this.switchTo);
    }

    // ---- movimento
    const ads = m.id === 'knife' || special ? 0 : clamp01(s.ads ?? 0);
    const spr = clamp01(s.sprint ?? 0) * (1 - ads);
    const calm = 1 - 0.8 * ads; // bob/sway/respiração reduzidos mirando
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    const moveTarget = s.grounded ? Math.min(1, s.speed / 6.5) : 0;
    this.moveAmt += (moveTarget - this.moveAmt) * k(8);
    this.airAmt += ((s.grounded ? 0 : 1) - this.airAmt) * k(7);
    this.crouchAmt += ((s.crouched ? 1 : 0) - this.crouchAmt) * k(9);
    this.bobPhase += dt * (s.grounded ? Math.min(s.speed, 11) * 1.45 * (1 + 0.15 * spr) : 0);
    const mv = this.moveAmt * f.bob * calm * (1 + 1.3 * spr);
    const bx = Math.sin(this.bobPhase) * 0.012 * mv;
    const by = (Math.cos(this.bobPhase * 2) - 1) * 0.005 * mv;
    const broll = Math.sin(this.bobPhase) * 0.025 * mv;
    const byaw = Math.sin(this.bobPhase) * 0.05 * spr * this.moveAmt;
    const still = (1 - this.moveAmt) * calm;
    const breath = Math.sin(this.t * 1.6);
    const breath2 = Math.sin(this.t * 0.9 + 1.3);

    // ---- sway / lag do mouse
    const sw = 0.0011 * f.sway * (1 - 0.8 * ads);
    this.swayTarget.set(
      clampAbs(s.lookDY * sw, 0.08),
      clampAbs(s.lookDX * sw, 0.1),
      clampAbs(s.lookDX * sw * 0.8, 0.09),
    );
    this.swayRot.step(dt, this.swayTarget);
    this.recoilPos.step(dt);
    this.recoilRot.step(dt);
    this.land.step(dt);
    const recR = 1 - 0.55 * ads, recP = 1 - 0.35 * ads;

    // ---- base: interpola quadril → mira (linha de mira no centro da tela)
    const crouch = this.crouchAmt * (1 - ads);
    let px = lerp(hipPos.x, 0, ads) + bx - this.swayRot.x.y * 0.12 - crouch * 0.012;
    let py = lerp(hipPos.y, -m.sightY, ads) + by + breath * 0.0016 * still - crouch * 0.008 + this.airAmt * 0.008 * calm + this.land.x.y * calm;
    let pz = lerp(hipPos.z, m.adsZ, ads) + this.recoilPos.x.z * recP;
    let rx = hipRot.x * (1 - ads) + this.swayRot.x.x + this.recoilRot.x.x * recR + breath2 * 0.004 * still - this.airAmt * 0.03 * calm + this.land.x.x * calm;
    let ry = hipRot.y * (1 - ads) + this.swayRot.x.y + this.recoilRot.x.y * recR + byaw;
    let rz = hipRot.z * (1 - ads) + broll + this.swayRot.x.z + this.recoilRot.x.z * recR + crouch * 0.09;
    px += this.recoilPos.x.x * recP;
    py += this.recoilPos.x.y * recP;

    // corrida: arma inclinada pra baixo e pro lado
    if (spr > 0) {
      const ps = m.id === 'pistol' ? 0.6 : 1;
      px -= 0.01 * spr;
      py -= 0.045 * spr;
      pz += 0.02 * spr;
      rx -= 0.3 * spr * ps;
      ry += 0.48 * spr * ps;
      rz += 0.28 * spr;
    }

    if (special) {
      const o = this.sp.update(dt, dtReal);
      this.holder.position.set(px + o.px, py + o.py, pz + o.pz);
      this.holder.rotation.set(rx + o.rx, ry + o.ry, rz + o.rz);
      return;
    }
    this.sp.update(dt, dtReal);

    // troca: abaixa girando
    px += down * 0.04;
    py -= down * 0.26;
    rx -= down * 0.9;
    rz -= down * 0.35;

    // ---- partes móveis e mãos
    const P = this.poses[m.id];
    applyPose(m.rightArm, m.rightHold, m.rightHold, 0);
    if (m.leftArm && m.leftHold) applyPose(m.leftArm, m.leftHold, m.leftHold, 0);

    if (this.reloading && m.reload !== 'none') {
      this.reloadT += dt;
      const u = clamp01(this.reloadT / this.reloadDur);
      const tilt = seg(u, 0, 0.14) * (1 - seg(u, 0.84, 1));
      const o = this.reloadAnim(m, P, u);
      rz += tilt * (m.reload === 'shells' ? -0.5 : -0.45) + o.rz;
      rx += tilt * 0.12 + o.rx;
      px -= tilt * 0.035;
      py += tilt * 0.015 + o.py;
      pz += o.pz;
    } else {
      this.shellInHand.visible = false;
      if (m.mag && m.magRest) {
        m.mag.position.copy(m.magRest);
        m.mag.rotation.set(0, 0, 0);
        m.mag.visible = true;
      }
      const o = this.actionAnim(m, P);
      rz += o.rz;
      rx += o.rx;
    }

    if (m.id === 'knife') {
      const o = this.meleeAnim(m);
      px += o.px; py += o.py; pz += o.pz;
      rx += o.rx; ry += o.ry; rz += o.rz;
    }

    this.holder.position.set(px, py, pz);
    this.holder.rotation.set(rx, ry, rz);

  }

  /** Slide da pistola, alavanca SMG/fuzil, pump da escopeta, bolt da sniper. */
  private actionAnim(m: WeaponModel, P: ReloadPoses): { rx: number; rz: number } {
    const t = this.sinceShot;
    const out = { rx: 0, rz: 0 };
    if (m.id === 'pistol' && m.slide) {
      m.slide.position.z = 0.032 * pulse(t, 0, 0.09, 0.25);
    } else if ((m.id === 'smg' || m.id === 'rifle') && m.slide) {
      m.slide.position.z = (m.id === 'smg' ? -0.17 : -0.08) + 0.03 * pulse(t, 0, 0.06, 0.3);
    } else if (m.id === 'shotgun' && m.pump && m.leftArm && m.leftHold) {
      const back = seg(t, 0.2, 0.34) * (1 - seg(t, 0.38, 0.52));
      if (t >= 0.34 && !this.cycled) { this.cycled = true; this.ejectCasing(); }
      m.pump.position.z = -0.38 + back * 0.1;
      m.leftArm.position.z += back * 0.1;
      out.rx = back * 0.05;
      out.rz = back * -0.04;
    } else if (m.id === 'sniper' && m.bolt) {
      const reach = seg(t, 0.22, 0.32) * (1 - seg(t, 0.85, 1.0));
      const lift = seg(t, 0.3, 0.4) * (1 - seg(t, 0.7, 0.8));
      const pull = seg(t, 0.4, 0.52) * (1 - seg(t, 0.56, 0.68));
      if (t >= 0.5 && !this.cycled) { this.cycled = true; this.ejectCasing(); }
      m.bolt.rotation.z = lift * 1.2;
      m.bolt.position.z = 0.03 + pull * 0.075;
      if (reach > 0) {
        applyPose(m.rightArm, m.rightHold, P.bolt, reach);
        m.rightArm.position.z += pull * 0.075;
        m.rightArm.position.y += lift * 0.015;
      }
      out.rz = reach * 0.18;
      out.rx = reach * 0.04 + pull * 0.03;
    }
    return out;
  }

  private reloadAnim(m: WeaponModel, P: ReloadPoses, u: number): { rx: number; rz: number; py: number; pz: number } {
    const L = m.leftArm!, H = m.leftHold!;
    const out = { rx: 0, rz: 0, py: 0, pz: 0 };
    if (m.reload === 'mag' || m.reload === 'bolt') {
      // sniper: abre o bolt no começo e fecha no fim
      let a = 0.0, b = 1.0;
      if (m.reload === 'bolt' && m.bolt) {
        const open = seg(u, 0.04, 0.14) * (1 - seg(u, 0.84, 0.94));
        const pull = seg(u, 0.12, 0.2) * (1 - seg(u, 0.78, 0.86));
        m.bolt.rotation.z = open * 1.2;
        m.bolt.position.z = 0.03 + pull * 0.075;
        const reach = seg(u, 0.0, 0.08) * (1 - seg(u, 0.2, 0.28)) + seg(u, 0.72, 0.8) * (1 - seg(u, 0.94, 1));
        applyPose(m.rightArm, m.rightHold, P.bolt, reach);
        m.rightArm.position.z += pull * 0.075 * reach;
        a = 0.18; b = 0.82;
      }
      const w = (x: number) => a + (b - a) * x; // remapeia a linha do tempo
      // mão esquerda
      if (u < w(0.15)) applyPose(L, H, P.grab, seg(u, w(0), w(0.15)));
      else if (u < w(0.32)) applyPose(L, P.grab, P.down, seg(u, w(0.15), w(0.32)));
      else if (u < w(0.45)) applyPose(L, P.down, P.down, 0);
      else if (u < w(0.64)) applyPose(L, P.down, P.grab, seg(u, w(0.45), w(0.64)));
      else if (u < w(0.72)) applyPose(L, P.grab, P.grab, 0);
      else if (m.reload === 'mag' && u < w(0.88)) {
        const c = seg(u, w(0.72), w(0.8));
        applyPose(L, P.grab, P.charge, c);
        const rack = pulse(u, w(0.79), w(0.88), 0.45);
        L.position.z += rack * 0.04;
        if (m.slide) m.slide.position.z = (m.id === 'pistol' ? 0 : m.id === 'smg' ? -0.17 : -0.08) + rack * 0.035;
        out.rx += rack * 0.04;
      } else applyPose(L, m.reload === 'mag' ? P.charge : P.grab, H, seg(u, m.reload === 'mag' ? w(0.88) : w(0.72), w(1)));

      // pente: cai, some, volta na mão, encaixa
      if (m.mag && m.magRest) {
        const mag = m.mag;
        if (u < w(0.15)) {
          mag.position.copy(m.magRest);
          mag.rotation.set(0, 0, 0);
          mag.visible = true;
          out.py += pulse(u, w(0.1), w(0.15), 0.5) * 0.006;
        } else if (u < w(0.34)) {
          const ft = (u - w(0.15)) * this.reloadDur;
          mag.position.set(m.magRest.x - ft * 0.1, m.magRest.y - 4.5 * ft * ft - ft * 0.15, m.magRest.z + ft * 0.08);
          mag.rotation.set(ft * 2.5, 0, ft * 3);
          mag.visible = true;
        } else if (u < w(0.66)) {
          // pente novo acompanha a mão (delta da pose grab)
          mag.visible = u > w(0.4);
          mag.rotation.set(0, 0, 0);
          mag.position.copy(m.magRest).add(_v.copy(L.position).sub(P.grab.p));
        } else {
          mag.position.copy(m.magRest);
          mag.rotation.set(0, 0, 0);
          mag.visible = true;
          // tapa de encaixe
          const slap = pulse(u, w(0.64), w(0.72), 0.25);
          out.py += slap * 0.012;
          out.rx += slap * 0.05;
        }
      }
    } else if (m.reload === 'shells') {
      // insere cartuchos um a um
      const n = Math.max(2, Math.min(6, Math.round(this.reloadDur / 0.5)));
      const a = 0.12, b = 0.8;
      if (u < a) applyPose(L, H, P.down, seg(u, 0, a));
      else if (u < b) {
        const cyc = ((u - a) / (b - a)) * n;
        const ph = cyc - Math.floor(cyc);
        const upT = pulse(ph, 0, 1, 0.55);
        applyPose(L, P.down, P.port, upT);
        // empurra no fim da subida
        const push = pulse(ph, 0.45, 0.75, 0.4);
        L.position.z -= push * 0.04;
        out.py -= push * 0.006;
        out.rx += push * 0.03;
        this.shellInHand.visible = ph < 0.6;
      } else {
        this.shellInHand.visible = false;
        applyPose(L, P.down, H, seg(u, b, 0.9));
        // pump final
        const back = pulse(u, 0.88, 1.0, 0.45);
        if (m.pump) m.pump.position.z = -0.38 + back * 0.1;
        L.position.z += back * 0.1;
        out.rx += back * 0.05;
      }
    }
    return out;
  }

  /** Faca: leve = corte lateral alternando lados; pesado = estocada com recuo lento. */
  // `m` vem do update: this.m pode já ter trocado de arma no meio do frame (faca → outra arma)
  private meleeAnim(m: { top?: THREE.Object3D }): { px: number; py: number; pz: number; rx: number; ry: number; rz: number } {
    const t = this.meleeT;
    const o = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 };
    const blade = m.top!;
    blade.rotation.set(0, 0, 0);
    if (!this.meleeHeavy) {
      const D = 0.43;
      if (t < D) {
        const side = this.meleeSide;
        // corte rápido (0-0.08), segue o arco e volta devagar
        const sw = seg(t, 0, 0.08);
        const back = 1 - seg(t, 0.12, D);
        const arc = sw * back;
        // começa do lado oposto e cruza a tela
        const from = side > 0 ? 1 : -1;
        const x = from * (0.06 - 0.16 * sw) * back;
        o.px = x - 0.03 * arc;
        o.py = 0.03 * arc - 0.02 * Math.abs(x) * 6;
        o.pz = -0.08 * arc;
        o.ry = from * (-0.5 + 1.1 * sw) * back;
        o.rz = from * 0.9 * arc;
        o.rx = -0.25 * arc;
        blade.rotation.z = from * 0.5 * arc;
      }
    } else {
      const D = 0.9;
      if (t < D) {
        const stab = seg(t, 0, 0.07) * (1 - seg(t, 0.2, 0.6));
        o.pz = -0.2 * stab;
        o.px = -0.07 * stab;
        o.py = 0.035 * stab;
        o.rx = -0.25 * stab;
        o.ry = 0.25 * stab;
        o.rz = 0.35 * stab;
        // "puxa" a faca de volta e gira na mão (flourish) durante o cooldown
        const twirl = seg(t, 0.55, 0.85);
        blade.rotation.z = twirl * Math.PI * 2;
        o.py += pulse(t, 0.5, 0.9, 0.5) * 0.02;
      }
    }
    return o;
  }

  private updateCasings(dt: number): void {
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.life <= 0) c.mesh.visible = false;
    }
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function clampAbs(v: number, m: number): number {
  return v > m ? m : v < -m ? -m : v;
}

function r3(): number {
  return (Math.random() * 2 - 1) * 25;
}

