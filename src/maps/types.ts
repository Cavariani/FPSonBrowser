/** Materiais do mapa. MapBuilder decide a aparência de cada um. */
export type MaterialId =
  | 'sand' | 'sandDark' | 'stone' | 'wall' | 'wallDark' | 'plaster'
  | 'wood' | 'crate' | 'metal' | 'door' | 'roof' | 'trim' | 'cloth' | 'glass'
  // adições: água, lâmpada (emissivo) e "pintura" (cor vem toda do tint).
  | 'water' | 'lamp' | 'paint';

export type Vec3 = [number, number, number];

export interface MapBox {
  min: Vec3;
  max: Vec3;
  mat: MaterialId;
  /** false = só visual (ex. toldo alto, decoração). Padrão true. */
  collide?: boolean;
  /** Bloqueia tiro? Padrão = collide. */
  solid?: boolean;
  /** Só colisão, não desenha (ex. tronco de palmeira, que é desenhada à parte). */
  hidden?: boolean;
  /** Cor multiplicadora (sRGB hex) para variar casas, pintar objetos 'paint' etc. */
  tint?: number;
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

/** Direção para onde a face aponta: n = -z, s = +z, w = -x, e = +x, u = cima (pintado no chão). */
export type Facing = 'n' | 's' | 'e' | 'w' | 'u';

/** Placa / cartaz desenhado em canvas (só visual). */
export interface MapSign {
  /** Centro da placa (já encostada na superfície). */
  pos: Vec3;
  face: Facing;
  w: number;
  h: number;
  lines: string[];
  bg?: string;
  fg?: string;
  border?: string;
  /** Estilos especiais. */
  kind?: 'text' | 'letter' | 'rug';
  /** Rotação (rad) só para face 'u'. */
  rot?: number;
}

/** Toldo listrado inclinado, preso numa parede (só visual). */
export interface MapAwning {
  /** Linha na parede: de a até b (x,z), na altura y. */
  a: [number, number];
  b: [number, number];
  y: number;
  face: Exclude<Facing, 'u'>;
  depth: number;
  drop: number;
  color: 'red' | 'green' | 'blue' | 'yellow';
}

export interface MapPalm {
  pos: Vec3;
  /** Altura aproximada (m). */
  h: number;
  /** Rotação (rad). */
  yaw: number;
}

export interface MapDef {
  name: string;
  /** Limites jogáveis aproximados (para neblina/céu/minimapa). */
  bounds: { min: Vec3; max: Vec3 };
  boxes: MapBox[];
  spawns: SpawnPoint[];
  /** Pontos de navegação para bots (no chão). Bots andam entre nós conectados por linha de visão. */
  navNodes: Vec3[];
  sunDir: Vec3;
  fogColor: number;
  skyTop: number;
  skyBottom: number;
  /** Opcionais (visuais). */
  signs?: MapSign[];
  awnings?: MapAwning[];
  palms?: MapPalm[];
}
