import type { V3 } from '../Match';
import type { BeamKind, ProjKind } from './defs';

/**
 * Mensagens compactas das armas malucas (efeitos visuais de projéteis e raios).
 * Vão embrulhadas em `{ k: 'sp', m }` no canal confiável: cliente → host → demais; host → todos.
 * Quem atira simula e decide o dano; os outros só desenham.
 */
export type SpecialMsg =
  /** Projétil nasceu. `v` = velocidades achatadas [vx,vy,vz,...] (coxinha manda 6). Ids n, n+1, ... `c` = carga (estilingue). */
  | { t: 'ps'; a: string; n: number; kd: ProjKind; o: V3; v: number[]; c?: number }
  /** Posições de projéteis teleguiados (pombo, chinelo), ~10 Hz: [n,x,y,z,vx,vy,vz, ...]. */
  | { t: 'pu'; a: string; u: number[] }
  /** Projétil terminou em `p`. w: 0 acertou, 1 mundo, 2 expirou, 3 explodiu, 4 pego de volta. */
  | { t: 'pe'; a: string; n: number; p: V3; w: number }
  /** Raio/jato contínuo, ~15 Hz enquanto ligado. `d` = direção da mira, `e` = ponto final, `e2` = ponto do arco. */
  | { t: 'bm'; a: string; w: BeamKind; on: 0 | 1; o: V3; d: V3; e: V3; e2?: V3; h?: 0 | 1 };

export const END_CODE = { hit: 0, world: 1, expire: 2, explode: 3, caught: 4 } as const;
export type EndReason = keyof typeof END_CODE;
export const END_NAME: EndReason[] = ['hit', 'world', 'expire', 'explode', 'caught'];

export const r2 = (n: number): number => Math.round(n * 100) / 100;
export const v3 = (x: { x: number; y: number; z: number }): V3 => [r2(x.x), r2(x.y), r2(x.z)];
