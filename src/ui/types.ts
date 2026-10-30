import type { CheatsHud } from '../game/Cheats';
import type { SpecialId } from '../game/special/defs';
import type { WeaponDef } from '../game/weaponDefs';

export interface ScoreRow {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  level: number;
  money: number;
  /** Arma na mão (comum ou maluca). */
  weapon: string;
  ping: number;
  isLocal: boolean;
  isBot: boolean;
  alive: boolean;
  color: number;
}

/** Tudo que o HUD precisa, entregue a cada frame pelo Game. */
export interface HudState {
  health: number;
  weapon: WeaponDef;
  ammo: number;
  reloading: boolean;
  reloadProgress: number;
  switching: boolean;
  /** Spread atual em radianos e FOV vertical (graus) — para converter em pixels na mira dinâmica. */
  spread: number;
  fov: number;
  zoomed: boolean;
  /** 'gungame' = modo da loja (id antigo). */
  mode: 'gungame' | 'treino';
  money: number;
  armor: number;
  /** Nível na escada de malucas (0 = mais fraca) e a escada inteira. */
  level: number;
  ladder: SpecialId[];
  /** Loja (tecla B): aberta, categoria (-1 = menu) e item na mão. */
  shop: { open: boolean; page: number; held: string };
  dead: boolean;
  respawnIn: number;
  killerName: string;
  /** Foto (data URL) de quem matou o jogador local, se ele tiver uma. */
  killerFace: string | null;
  showScoreboard: boolean;
  scoreboard: ScoreRow[];
  /** Líder da escada. */
  leader: { name: string; level: number; isLocal: boolean } | null;
  fps: number;
  speed: number;
  /** Yaw do jogador local (rad), para indicador de dano e minimapa. */
  yaw: number;
  /** Progresso da mira (ADS) 0..1. */
  ads: number;
  sprinting: boolean;
  /** Posição do jogador local no plano XZ. */
  posX: number;
  posZ: number;
  /** Todos os outros actors (todo mundo é inimigo). */
  radar: RadarBlip[];

  // ---- armas malucas (pickups). Quando `special` não é null, `weapon`/`ammo` acima já descrevem a arma maluca
  // (name, short, mag = munição máxima), então o HUD antigo mostra o nome e a munição sem mudanças.
  /** Arma maluca na mão, ou null. `ammo` é inteiro (segundos restantes arredondados pra cima, nas armas de jato). */
  special: SpecialHud | null;
  /** Estilingue esticando, 0..1 (0 = não está esticando). */
  charge: number;
  /** Cocô de pombo na tela: 0..1 (1 = coberta; some em ~3 s). O SpecialFX já desenha um overlay DOM. */
  blind: number;
  /** Vapor do café na tela: 0..1 (1 = embaçada; some em ~2 s). O SpecialFX já desenha um overlay DOM. */
  steam: number;
  /** Pegando fogo (queimando). */
  burning: boolean;
  /** Atordoado: mira travada (hoje nenhuma arma aplica; o tijolo agora mata de um acerto). */
  stunned: boolean;
  /** Tomando choque do chuveiro. */
  shocked: boolean;
  /** Pickups ativos no mapa (para o minimapa). */
  pickups: PickupBlip[];
  /** Killstreaks-cheat: streak, guardados, ativo, timer e caixas de ESP já projetadas. */
  cheats: CheatsHud;
}

export interface SpecialHud {
  id: SpecialId;
  name: string;
  short: string;
  /** Dica de controle ("Segure para dar choque"). */
  hint: string;
  ammo: number;
  maxAmmo: number;
  /** 'sec' = munição em segundos (raio/jato); 'shot' = nº de usos. */
  unit: 'sec' | 'shot';
  /** Cor 0xRRGGBB da arma (distinta entre as 13). */
  color: number;
  /** Em uso agora: jato ligado, pipa no ar, golpe carregado armando. */
  active: boolean;
}

export interface PickupBlip {
  id: number;
  kind: SpecialId;
  x: number;
  z: number;
}

export interface RadarBlip {
  id: string;
  x: number;
  z: number;
  alive: boolean;
}

export interface LobbyPlayer {
  name: string;
  ping: number;
  isHost: boolean;
  isLocal: boolean;
}

export interface LobbyInfo {
  status: 'offline' | 'connecting' | 'connected' | 'error';
  code: string | null;
  isHost: boolean;
  players: LobbyPlayer[];
  error?: string;
}

/** O que o menu pode pedir para o jogo. */
export interface MenuCallbacks {
  playOffline(): void;
  /** Cria sala e retorna o código. */
  createRoom(): Promise<string>;
  joinRoom(code: string): Promise<void>;
  resume(): void;
  leave(): void;
}
