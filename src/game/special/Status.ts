import type { SpecialId, StatusKind } from './defs';

interface Rec {
  burn: number; burnBy: string; burnAcc: number;
  shock: number;
  blind: number; blindDur: number;
  stun: number;
  /** "Empurrado": queda dentro da janela conta como kill de quem empurrou. */
  pushT: number; pushBy: string; pushW: SpecialId | null;
}

const KINDS: StatusKind[] = ['burn', 'shock', 'blind', 'stun'];
const fresh = (): Rec => ({ burn: 0, burnBy: '', burnAcc: 0, shock: 0, blind: 0, blindDur: 1, stun: 0, pushT: 0, pushBy: '', pushW: null });

/** Efeitos de status por actor (queimando, choque, cegueira de pombo, atordoado). Roda em todas as máquinas. */
export class StatusManager {
  private m = new Map<string, Rec>();

  private rec(id: string): Rec {
    let r = this.m.get(id);
    if (!r) this.m.set(id, (r = fresh()));
    return r;
  }

  apply(id: string, kind: StatusKind, dur: number, by = ''): void {
    const r = this.rec(id);
    switch (kind) {
      case 'burn': r.burn = Math.max(r.burn, dur); r.burnBy = by || r.burnBy; break;
      case 'shock': r.shock = Math.max(r.shock, dur); break;
      case 'blind': r.blind = Math.max(r.blind, dur); r.blindDur = Math.max(r.blindDur, r.blind); break;
      case 'stun': r.stun = Math.max(r.stun, dur); break;
    }
  }

  /** Segundos restantes. */
  left(id: string, kind: StatusKind): number {
    const r = this.m.get(id);
    return r ? r[kind] : 0;
  }

  has(id: string, kind: StatusKind): boolean {
    return this.left(id, kind) > 0;
  }

  /** Cegueira do pombo 0..1 (1 = tela cheia de cocô; some nos últimos ~0.9 s). */
  blind(id: string): number {
    const r = this.m.get(id);
    if (!r || r.blind <= 0) return 0;
    return Math.min(1, r.blind / 0.9);
  }

  markPush(id: string, by: string, weapon: SpecialId | null, t: number): void {
    const r = this.rec(id);
    r.pushT = t; r.pushBy = by; r.pushW = weapon;
  }

  pushOf(id: string): { by: string; weapon: SpecialId | null } | null {
    const r = this.m.get(id);
    return r && r.pushT > 0 && r.pushBy ? { by: r.pushBy, weapon: r.pushW } : null;
  }

  clearPush(id: string): void {
    const r = this.m.get(id);
    if (r) r.pushT = 0;
  }

  clear(id: string): void {
    this.m.delete(id);
  }

  clearAll(): void {
    this.m.clear();
  }

  /**
   * Avança os timers. `burnTick` só é passado no host (dano por tempo é autoritativo lá).
   * `onEnd` avisa quando um status acaba (para sons/efeitos).
   */
  update(dt: number, onEnd: (id: string, kind: StatusKind) => void, burnTick: ((id: string, by: string) => void) | null): void {
    for (const [id, r] of this.m) {
      for (const k of KINDS) {
        if (r[k] > 0) {
          r[k] -= dt;
          if (r[k] <= 0) {
            r[k] = 0;
            if (k === 'blind') r.blindDur = 1;
            if (k === 'burn') r.burnAcc = 0;
            onEnd(id, k);
          }
        }
      }
      if (r.pushT > 0) r.pushT -= dt;
      if (r.burn > 0) {
        r.burnAcc += dt;
        while (r.burnAcc >= 0.5) {
          r.burnAcc -= 0.5;
          burnTick?.(id, r.burnBy);
        }
      }
      if (r.burn <= 0 && r.shock <= 0 && r.blind <= 0 && r.stun <= 0 && r.pushT <= 0) this.m.delete(id);
    }
  }
}
