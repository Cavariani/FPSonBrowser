export interface Settings {
  name: string;
  sensitivity: number;
  /** FOV vertical em graus. */
  fov: number;
  volume: number;
  /** Tamanho do "pixel" do render (1 = nativo, 3 = bem retrô). Maior = mais rápido. */
  pixelSize: number;
  invertY: boolean;
  botCount: number;
  botDifficulty: number; // 0..1
  mode: 'gungame' | 'treino';
  /** "Cara" do boneco: data URL (JPEG 128x128) ou null. Se não couber no localStorage, fica só em memória. */
  face: string | null;
}

const KEY = 'fpsdoclt.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 2,
  fov: 78,
  volume: 0.7,
  pixelSize: 2,
  invertY: false,
  botCount: 5,
  botDifficulty: 0.5,
  mode: 'gungame',
  face: null,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
      if (typeof s.face !== 'string' || !s.face.startsWith('data:image/')) s.face = null;
      return s;
    }
  } catch {
    /* localStorage bloqueado: segue com padrão */
  }
  return { ...DEFAULT_SETTINGS };
}

export const settings: Settings = load();

const listeners = new Set<(s: Settings) => void>();

export function saveSettings(patch: Partial<Settings> = {}): void {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Quota estourada (a foto pode ser grande): persiste o resto e mantém a face só em memória.
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...settings, face: null }));
    } catch {
      /* ignora */
    }
  }
  for (const l of listeners) l(settings);
}

export function onSettingsChange(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
