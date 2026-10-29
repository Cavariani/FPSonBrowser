/** Tamanho máximo da data URL da face (caracteres) — bem abaixo do limite de ~16 KB validado na rede. */
export const FACE_MAX_CHARS = 12 * 1024;
const SIZES = [128, 96, 64];
const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

function decode(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir essa imagem.')); };
    img.src = url;
  });
}

/** Imagem qualquer → center-crop quadrado → 128x128 → JPEG com data URL ≤ FACE_MAX_CHARS. */
export async function processFaceImage(blob: Blob): Promise<string> {
  if (!blob.type.startsWith('image/')) throw new Error('Isso não é uma imagem.');
  if (blob.size > MAX_INPUT_BYTES) throw new Error('Imagem grande demais (máx. 30 MB).');
  const img = await decode(blob);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (!w || !h) throw new Error('Imagem vazia.');
  const s = Math.min(w, h);
  const sx = (w - s) / 2, sy = (h - s) / 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível.');
  for (const size of SIZES) {
    canvas.width = size; canvas.height = size;
    ctx.fillStyle = '#fff'; // PNG transparente vira fundo branco (é uma folha de papel)
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    for (const q of QUALITIES) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= FACE_MAX_CHARS) return url;
    }
  }
  throw new Error('Não consegui comprimir essa imagem.');
}

function imageFrom(files: FileList | File[] | null | undefined): File | null {
  if (!files) return null;
  for (const f of Array.from(files)) if (f.type.startsWith('image/')) return f;
  return null;
}

/**
 * Controles da foto do boneco: escolher arquivo, colar (Ctrl+V), arrastar, trocar e remover.
 * Só reage a paste/drop enquanto está visível e destravado.
 */
export class FacePicker {
  readonly el = document.createElement('div');
  onChange: (face: string | null) => void = () => {};

  private input = document.createElement('input');
  private pick = document.createElement('button');
  private remove = document.createElement('button');
  private msg = document.createElement('div');
  private face: string | null = null;
  private locked = false;
  private token = 0;
  private offs: (() => void)[] = [];

  constructor() {
    this.el.className = 'facepick';
    this.input.type = 'file'; this.input.accept = 'image/*'; this.input.hidden = true;
    this.pick.type = 'button'; this.pick.className = 'btn small';
    this.remove.type = 'button'; this.remove.className = 'btn small ghost'; this.remove.textContent = 'REMOVER';
    this.msg.className = 'hint face-msg';
    const row = document.createElement('div');
    row.className = 'facerow';
    row.append(this.pick, this.remove);
    this.el.append(row, this.msg, this.input);

    this.pick.addEventListener('click', () => { if (!this.locked) this.input.click(); });
    this.remove.addEventListener('click', () => { if (!this.locked) this.set(null); });
    this.input.addEventListener('change', () => {
      const f = imageFrom(this.input.files);
      this.input.value = '';
      if (f) void this.submit(f);
    });

    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(t, fn as EventListener);
      this.offs.push(() => window.removeEventListener(t, fn as EventListener));
    };
    on('paste', (e) => {
      if (!this.active()) return;
      const f = imageFrom(e.clipboardData?.files);
      if (!f) return;
      e.preventDefault();
      void this.submit(f);
    });
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    on('dragover', (e) => {
      if (!this.active() || !hasFiles(e)) return;
      e.preventDefault();
      this.el.dispatchEvent(new CustomEvent('facedrag', { bubbles: true, detail: true }));
    });
    on('dragleave', (e) => {
      if (e.relatedTarget === null) this.el.dispatchEvent(new CustomEvent('facedrag', { bubbles: true, detail: false }));
    });
    on('drop', (e) => {
      this.el.dispatchEvent(new CustomEvent('facedrag', { bubbles: true, detail: false }));
      if (!this.active() || !hasFiles(e)) return;
      e.preventDefault();
      const f = imageFrom(e.dataTransfer?.files);
      if (f) void this.submit(f);
      else this.say('Solte um arquivo de imagem.', true);
    });
    this.render();
  }

  private active(): boolean {
    return !this.locked && this.el.getClientRects().length > 0;
  }

  /** Processa (crop/resize/compressão) e aplica uma imagem. Usado por arquivo, colar e arrastar. */
  async submit(blob: Blob): Promise<void> {
    const t = ++this.token;
    this.say('Processando…');
    try {
      const url = await processFaceImage(blob);
      if (t !== this.token) return;
      this.set(url);
    } catch (e) {
      if (t === this.token) this.say(e instanceof Error ? e.message : 'Falhou.', true);
    }
  }

  private set(face: string | null): void {
    this.face = face;
    this.render();
    this.onChange(face);
  }

  /** Atualiza o estado exibido sem disparar onChange. */
  setFace(face: string | null): void {
    this.face = face;
    this.render();
  }

  setLocked(locked: boolean, why = ''): void {
    this.locked = locked;
    this.render(locked ? why : undefined);
  }

  private say(text: string, err = false): void {
    this.msg.textContent = text;
    this.msg.style.color = err ? 'var(--red)' : '';
  }

  private render(note?: string): void {
    this.pick.textContent = this.face ? 'TROCAR FOTO' : 'ESCOLHER FOTO';
    this.remove.style.display = this.face ? '' : 'none';
    this.pick.disabled = this.locked;
    this.remove.disabled = this.locked;
    this.say(note || 'Opcional: suba, cole (Ctrl+V) ou arraste uma imagem. Vira a cara do boneco pra todo mundo.');
  }

  dispose(): void {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.el.remove();
  }
}
