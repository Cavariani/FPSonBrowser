import { Box3, Vector3 } from 'three';
import type { MapDef, MaterialId } from '../maps/types';

export interface RayHit {
  dist: number;
  point: Vector3;
  normal: Vector3;
  material: MaterialId;
}

/** Corpo físico AABB: pos = centro dos pés. */
export interface Body {
  pos: Vector3;
  vel: Vector3;
  hw: number;
  height: number;
  grounded: boolean;
  stepHeight: number;
}

const EPS = 0.001;
type Axis = 'x' | 'y' | 'z';

/** Colisão e raycast contra as caixas do mapa. */
export class World {
  readonly solids: Box3[] = [];
  readonly shootables: Box3[] = [];
  readonly shootMats: MaterialId[] = [];

  constructor(readonly map: MapDef) {
    for (const b of map.boxes) {
      const box = new Box3(new Vector3(...b.min), new Vector3(...b.max));
      if (b.collide !== false) this.solids.push(box);
      if (b.solid ?? b.collide !== false) {
        this.shootables.push(box);
        this.shootMats.push(b.mat);
      }
    }
  }

  /** O corpo cabe na posição atual (com essa altura)? */
  fits(b: Body): boolean {
    const s = this.solids;
    for (let i = 0; i < s.length; i++) {
      const o = s[i];
      if (
        b.pos.x - b.hw < o.max.x && b.pos.x + b.hw > o.min.x &&
        b.pos.y < o.max.y && b.pos.y + b.height > o.min.y &&
        b.pos.z - b.hw < o.max.z && b.pos.z + b.hw > o.min.z
      ) return false;
    }
    return true;
  }

  private collideAxis(b: Body, axis: Axis, amount: number): boolean {
    if (amount === 0) return false;
    b.pos[axis] += amount;
    let hit = false;
    const s = this.solids;
    for (let i = 0; i < s.length; i++) {
      const o = s[i];
      if (
        b.pos.x - b.hw < o.max.x && b.pos.x + b.hw > o.min.x &&
        b.pos.y < o.max.y && b.pos.y + b.height > o.min.y &&
        b.pos.z - b.hw < o.max.z && b.pos.z + b.hw > o.min.z
      ) {
        hit = true;
        if (axis === 'y') b.pos.y = amount > 0 ? o.min.y - b.height - EPS : o.max.y + EPS;
        else b.pos[axis] = amount > 0 ? o.min[axis] - b.hw - EPS : o.max[axis] + b.hw + EPS;
      }
    }
    return hit;
  }

  /**
   * Move-and-slide por eixo com subida de degrau e "grudar no chão" ao descer degraus.
   * Retorna quanto o corpo subiu/desceu por degrau (para suavizar a câmera).
   */
  moveBody(b: Body, dt: number): number {
    const wasGrounded = b.grounded;
    let stepped = 0;
    const dx = b.vel.x * dt, dy = b.vel.y * dt, dz = b.vel.z * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.2));
    let blockedX = false, blockedZ = false, hitY = false;

    for (let i = 0; i < n; i++) {
      const sx = b.pos.x, sy = b.pos.y, sz = b.pos.z;
      const ix = dx / n, iz = dz / n;
      let hx = this.collideAxis(b, 'x', ix);
      let hz = this.collideAxis(b, 'z', iz);

      if ((hx || hz) && b.grounded && b.stepHeight > 0) {
        const ax = b.pos.x, ay = b.pos.y, az = b.pos.z;
        b.pos.set(sx, sy, sz);
        this.collideAxis(b, 'y', b.stepHeight);
        const raised = b.pos.y - sy;
        const shx = this.collideAxis(b, 'x', ix);
        const shz = this.collideAxis(b, 'z', iz);
        this.collideAxis(b, 'y', -raised);
        const d1 = (ax - sx) ** 2 + (az - sz) ** 2;
        const d2 = (b.pos.x - sx) ** 2 + (b.pos.z - sz) ** 2;
        if (d2 > d1 + 1e-6 && b.pos.y > sy + 0.01) {
          stepped += b.pos.y - sy;
          hx = shx;
          hz = shz;
        } else {
          b.pos.set(ax, ay, az);
        }
      }
      blockedX ||= hx;
      blockedZ ||= hz;

      if (this.collideAxis(b, 'y', dy / n)) {
        hitY = true;
        if (dy < 0) b.grounded = true;
      }
    }

    if (blockedX) b.vel.x = 0;
    if (blockedZ) b.vel.z = 0;
    if (hitY) {
      b.vel.y = 0;
    } else {
      b.grounded = false;
      // Descendo degrau: gruda no chão em vez de "voar" um tick.
      if (wasGrounded && dy <= 0 && b.stepHeight > 0) {
        const y0 = b.pos.y;
        if (this.collideAxis(b, 'y', -b.stepHeight)) {
          b.grounded = true;
          b.vel.y = 0;
          stepped += b.pos.y - y0;
        } else {
          b.pos.y = y0;
        }
      }
    }
    return stepped;
  }

  /** Raycast contra o mapa (slab test). dir deve estar normalizado. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, out?: RayHit): RayHit | null {
    let best = maxDist;
    let bestIdx = -1, bestAxis = 0, bestSign = 0;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const d = [dir.x, dir.y, dir.z];
    const o = [ox, oy, oz];
    const s = this.shootables;
    for (let i = 0; i < s.length; i++) {
      const bmin = s[i].min, bmax = s[i].max;
      let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
      let miss = false;
      for (let a = 0; a < 3; a++) {
        const mn = a === 0 ? bmin.x : a === 1 ? bmin.y : bmin.z;
        const mx = a === 0 ? bmax.x : a === 1 ? bmax.y : bmax.z;
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < mn || o[a] > mx) { miss = true; break; }
          continue;
        }
        const inv = 1 / d[a];
        let t1 = (mn - o[a]) * inv, t2 = (mx - o[a]) * inv;
        let sg = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = sg; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { miss = true; break; }
      }
      if (miss || axis < 0 || tmin < 0) continue;
      if (tmin < best) {
        best = tmin;
        bestIdx = i;
        bestAxis = axis;
        bestSign = sign;
      }
    }
    if (bestIdx < 0) return null;
    const hit = out ?? { dist: 0, point: new Vector3(), normal: new Vector3(), material: 'wall' as MaterialId };
    hit.dist = best;
    hit.point.copy(origin).addScaledVector(dir, best);
    hit.normal.set(0, 0, 0).setComponent(bestAxis, bestSign);
    hit.material = this.shootMats[bestIdx];
    return hit;
  }

  /** Linha de visão livre entre dois pontos. */
  visible(a: Vector3, b: Vector3): boolean {
    const dir = _v.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return true;
    dir.divideScalar(len);
    return this.raycast(a, dir, len - 0.05) === null;
  }
}

const _v = new Vector3();
