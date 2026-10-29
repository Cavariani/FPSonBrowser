import * as THREE from 'three';
import { bus } from '../core/events';
import { flashTexture } from './vm/build';
import { Decals } from './particles/Decals';
import { ParticlePool, type SpawnOpts } from './particles/ParticlePool';
import { Tracers } from './particles/Tracers';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _zAxis = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Cores de poeira/lasca por material do mapa. [poeira, lasca, marca] */
const MAT_FX: Record<string, [number, number, number]> = {
  sand: [0xdcc48e, 0xc2a46a, 0x5a4a30],
  sandDark: [0xc4a46c, 0xa88a54, 0x4a3c26],
  stone: [0xb4aea6, 0x8f8a83, 0x3a3836],
  wall: [0xe2d2b0, 0xc8b48c, 0x4a4234],
  wallDark: [0xb09c7c, 0x8c7a5e, 0x3a3226],
  plaster: [0xf0e8d8, 0xd8ccb4, 0x55504a],
  wood: [0xa8784a, 0x7a4a26, 0x2a1a0e],
  crate: [0xb08850, 0x80592c, 0x2e1e0e],
  door: [0x9a6a40, 0x6e4422, 0x2a1a0e],
  roof: [0xb06a4a, 0x8a4a30, 0x3a2016],
  trim: [0xe0dace, 0xc0b8a8, 0x4a4640],
  cloth: [0xd05a48, 0xa83a2c, 0x5a2a20],
  metal: [0x9aa0a8, 0x6a7078, 0x2a2c30],
  lamp: [0xfff4c8, 0xe8d8a0, 0x3a3830],
  paint: [0xd0c8b8, 0xa89880, 0x3a3630],
  water: [0xc8e8ff, 0x8cc8f0, 0x40505a],
  glass: [0xd8f0ff, 0xa8d8f4, 0x50606a],
};
const RED = [0xd8342c, 0xb8241e, 0xe84a3a, 0x8e1a16];
const POP = [0xffffff, 0xffe9a0, 0xff6a50];

const pick = (a: readonly number[]) => a[(Math.random() * a.length) | 0];
const rnd = (a: number) => (Math.random() * 2 - 1) * a;

/** Presets mutáveis de spawn (evita alocar objeto por partícula). */
const O = {
  dust: { sx: 0.08, sy: 0.08, sz: 0.08, life: 0.5, gravity: -0.4, drag: 4, floor: -Infinity, flutter: false, spin: 3, shrink: 0.8 } as SpawnOpts,
  chip: { sx: 0.03, sy: 0.03, sz: 0.03, life: 0.7, gravity: 11, drag: 0.8, floor: -Infinity, flutter: false, spin: 18, shrink: 0.3 } as SpawnOpts,
  spark: { sx: 0.012, sy: 0.012, sz: 0.06, life: 0.22, gravity: 9, drag: 1.5, floor: -Infinity, flutter: false, spin: 0, shrink: 0.5 } as SpawnOpts,
  cube: { sx: 0.04, sy: 0.04, sz: 0.04, life: 0.8, gravity: 12, drag: 0.6, floor: -Infinity, flutter: false, spin: 14, shrink: 0.3 } as SpawnOpts,
};

interface Flash {
  life: number;
  pos: THREE.Vector3;
  size: number;
  rot: number;
}

/**
 * Efeitos no mundo: tracers, impactos (poeira/lascas/faíscas + marca de tiro), impacto em carne estilizado
 * (cubinhos vermelhos low-poly + puff), burst na morte, muzzle flash de outros atores e um "pop" no kill.
 * Tudo em pools/InstancedMesh; 1 PointLight reaproveitada no mundo.
 */
export class Effects {
  private tracers = new Tracers(96);
  private decals = new Decals(64);
  private debris: ParticlePool;
  private glow: ParticlePool;
  private flashMesh: THREE.InstancedMesh;
  private flashes: Flash[] = [];
  private light = new THREE.PointLight(0xffb868, 0, 9, 2);
  private lightPower = 0;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.debris = new ParticlePool(box, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x202020 }), 700);
    this.glow = new ParticlePool(box, new THREE.MeshBasicMaterial({ color: 0xffffff }), 200);

    const fm = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), fm, 16);
    this.flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flashMesh.frustumCulled = false;
    this.flashMesh.count = 0;
    for (let i = 0; i < 16; i++) this.flashes.push({ life: 0, pos: new THREE.Vector3(), size: 0.5, rot: 0 });

    this.scene.add(this.tracers.mesh, this.decals.mesh, this.debris.mesh, this.glow.mesh, this.flashMesh, this.light);
    this.wire();
  }

  // ------------------------------------------------------------ eventos

  private wire(): void {
    bus.on('weapon:fire', (e) => {
      const pellets = e.ends.length;
      const width = pellets > 1 ? 0.022 : e.weapon === 'sniper' ? 0.05 : 0.032;
      const color = e.weapon === 'sniper' ? 0xbfe8ff : pellets > 1 ? 0xffc870 : 0xffe9a0;
      if (e.local) {
        // ponto aproximado do cano do viewmodel, a partir da câmera do mundo
        const q = this.camera.quaternion;
        _r.set(1, 0, 0).applyQuaternion(q);
        _u.set(0, 1, 0).applyQuaternion(q);
        _f.set(0, 0, -1).applyQuaternion(q);
        _v.copy(this.camera.position).addScaledVector(_r, 0.12).addScaledVector(_u, -0.1).addScaledVector(_f, 0.4);
        _v2.copy(_v).addScaledVector(_f, 0.6);
        this.flashLightAt(_v2, e.weapon === 'shotgun' || e.weapon === 'sniper' ? 1.4 : 1);
      } else {
        const d = e.dirs[0];
        _r.crossVectors(d, UP);
        if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
        _r.normalize();
        _v.copy(e.origin).addScaledVector(d, 0.65).addScaledVector(_r, 0.16);
        _v.y -= 0.22;
        this.addFlash(_v, e.weapon === 'shotgun' || e.weapon === 'sniper' ? 0.85 : 0.6);
        if (this.camera.position.distanceToSquared(_v) < 40 * 40) this.flashLightAt(_v, 0.8);
      }
      for (let i = 0; i < pellets; i++) {
        // escopeta: nem todo chumbo tem risco (fica mais limpo)
        if (pellets > 1 && i % 2 === 1) continue;
        this.tracers.spawn(_v, e.ends[i], color, width, e.weapon === 'sniper' ? 500 : 330, e.weapon === 'sniper' ? 9 : 4);
      }
    });

    bus.on('weapon:impact', (e) => {
      if (e.surface === 'flesh') this.fleshHit(e.point, e.normal);
      else this.worldHit(e.point, e.normal, e.material ?? 'wall');
    });

    bus.on('actor:death', (e) => this.deathBurst(e.pos, e.dir, e.headshot));

    bus.on('hit:confirm', (e) => {
      if (!e.killed) return;
      // "pop": flash rápido + estilhaços claros
      this.addFlash(e.point, e.headshot ? 0.9 : 0.6);
      for (let i = 0; i < 10; i++) {
        O.spark.life = 0.18 + Math.random() * 0.15;
        O.spark.floor = -Infinity;
        this.glow.spawn(e.point.x, e.point.y, e.point.z, rnd(4), rnd(3) + 1.5, rnd(4), pick(POP), O.spark);
      }
    });
  }

  private flashLightAt(p: THREE.Vector3, power: number): void {
    this.light.position.copy(p);
    this.lightPower = Math.max(this.lightPower, power);
  }

  private addFlash(p: THREE.Vector3, size: number): void {
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.life < best.life) best = f;
    best.life = 0.05;
    best.pos.copy(p);
    best.size = size * (0.85 + Math.random() * 0.4);
    best.rot = Math.random() * Math.PI * 2;
  }

  private worldHit(p: THREE.Vector3, n: THREE.Vector3, mat: string): void {
    const fx = MAT_FX[mat] ?? MAT_FX.wall;
    const floor = n.y > 0.6 ? p.y : p.y - 1.6;
    // poeira
    const puffs = mat === 'metal' || mat === 'glass' ? 1 : 3;
    for (let i = 0; i < puffs; i++) {
      const s = 0.06 + Math.random() * 0.06;
      O.dust.sx = O.dust.sy = O.dust.sz = s;
      O.dust.life = 0.35 + Math.random() * 0.35;
      const sp = 0.6 + Math.random() * 1.2;
      this.debris.spawn(p.x + n.x * 0.04, p.y + n.y * 0.04, p.z + n.z * 0.04,
        n.x * sp + rnd(0.5), n.y * sp + rnd(0.5) + 0.3, n.z * sp + rnd(0.5), fx[0], O.dust);
    }
    // lascas
    const chips = mat === 'cloth' ? 3 : 5;
    for (let i = 0; i < chips; i++) {
      const s = 0.015 + Math.random() * 0.025;
      O.chip.sx = s; O.chip.sy = s * (mat === 'wood' || mat === 'crate' || mat === 'door' ? 2.2 : 1); O.chip.sz = s;
      O.chip.life = 0.4 + Math.random() * 0.5;
      O.chip.floor = floor;
      const sp = 2 + Math.random() * 2.5;
      this.debris.spawn(p.x + n.x * 0.03, p.y + n.y * 0.03, p.z + n.z * 0.03,
        n.x * sp + rnd(1.8), n.y * sp + rnd(1.8) + 1.5, n.z * sp + rnd(1.8), Math.random() < 0.5 ? fx[1] : fx[0], O.chip);
    }
    // faíscas no metal / brilho no vidro
    if (mat === 'metal' || mat === 'glass') {
      const k = mat === 'metal' ? 8 : 5;
      for (let i = 0; i < k; i++) {
        O.spark.life = 0.12 + Math.random() * 0.18;
        O.spark.floor = floor;
        const sp = 3 + Math.random() * 4;
        this.glow.spawn(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02,
          n.x * sp + rnd(3), n.y * sp + rnd(3) + 1, n.z * sp + rnd(3), mat === 'metal' ? (Math.random() < 0.5 ? 0xffd060 : 0xfff2b0) : 0xe8f8ff, O.spark);
      }
    }
    this.decals.add(p, n, 0.1, 0xffffff);
  }

  /** Impacto em carne: cubinhos vermelhos low-poly + puffzinho. */
  private fleshHit(p: THREE.Vector3, n: THREE.Vector3): void {
    const floor = p.y - 1.4;
    for (let i = 0; i < 7; i++) {
      O.cube.sx = O.cube.sy = O.cube.sz = 0.02 + Math.random() * 0.035;
      O.cube.life = 0.45 + Math.random() * 0.4;
      O.cube.floor = floor;
      const sp = 1.5 + Math.random() * 2.5;
      this.debris.spawn(p.x, p.y, p.z, n.x * sp + rnd(1.8), 0.8 + Math.random() * 2.5, n.z * sp + rnd(1.8), pick(RED), O.cube);
    }
    for (let i = 0; i < 2; i++) {
      O.dust.sx = O.dust.sy = O.dust.sz = 0.07 + Math.random() * 0.06;
      O.dust.life = 0.2 + Math.random() * 0.15;
      this.debris.spawn(p.x, p.y, p.z, n.x * 0.8 + rnd(0.4), rnd(0.4), n.z * 0.8 + rnd(0.4), 0xc8302a, O.dust);
    }
  }

  /** Morte: burst estilizado de cubos vermelhos + nuvem. */
  private deathBurst(pos: THREE.Vector3, dir: THREE.Vector3, headshot: boolean): void {
    const cy = pos.y + (headshot ? 1.6 : 1.1);
    const floor = pos.y + 0.01;
    const push = 2.0;
    for (let i = 0; i < 26; i++) {
      O.cube.sx = O.cube.sy = O.cube.sz = 0.035 + Math.random() * 0.05;
      O.cube.life = 1.2 + Math.random() * 1.0;
      O.cube.floor = floor;
      const a = Math.random() * Math.PI * 2, sp = 1.2 + Math.random() * 3;
      this.debris.spawn(pos.x + rnd(0.15), cy + rnd(0.25), pos.z + rnd(0.15),
        Math.cos(a) * sp + dir.x * push, 2 + Math.random() * 4, Math.sin(a) * sp + dir.z * push, pick(RED), O.cube);
    }
    for (let i = 0; i < 7; i++) {
      O.dust.sx = O.dust.sy = O.dust.sz = 0.18 + Math.random() * 0.15;
      O.dust.life = 0.4 + Math.random() * 0.3;
      this.debris.spawn(pos.x + rnd(0.3), cy + rnd(0.3), pos.z + rnd(0.3), rnd(1.2), Math.random(), rnd(1.2), i < 3 ? 0xb8342c : 0xd8d0c8, O.dust);
    }
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    this.tracers.update(dt);
    this.debris.update(dt);
    this.glow.update(dt);

    // flashes de outros (billboard)
    let n = 0;
    const cq = this.camera.quaternion;
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      _qz.setFromAxisAngle(_zAxis, f.rot);
      _q.copy(cq).multiply(_qz);
      _s.set(f.size, f.size, f.size);
      _m.compose(f.pos, _q, _s);
      this.flashMesh.setMatrixAt(n++, _m);
    }
    this.flashMesh.count = n;
    if (n > 0) this.flashMesh.instanceMatrix.needsUpdate = true;

    // luz única do mundo
    this.lightPower = Math.max(0, this.lightPower - dt * 18);
    this.light.intensity = this.lightPower * this.lightPower * 9;

  }
}
