/** Teclado + mouse com pointer lock. Edges ("pressed") são zeradas a cada frame via endFrame(). */
export class Input {
  readonly keys = new Set<string>();
  private pressedKeys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  mouseButtons = 0;
  private pressedButtons = 0;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.ctrlKey && e.code === 'KeyW') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      const bit = 1 << e.button;
      if (!(this.mouseButtons & bit)) this.pressedButtons |= bit;
      this.mouseButtons |= bit;
    });
    window.addEventListener('mouseup', (e) => (this.mouseButtons &= ~(1 << e.button)));
    window.addEventListener('wheel', (e) => {
      if (this.locked) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.keys.clear();
        this.mouseButtons = 0;
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock(): void {
    const p = this.el.requestPointerLock({ unadjustedMovement: true } as any) as unknown as Promise<void> | undefined;
    // unadjustedMovement não existe em todo navegador: tenta de novo sem
    p?.catch?.(() => this.el.requestPointerLock());
  }

  unlock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  pressed(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  mouseDown(button = 0): boolean {
    return (this.mouseButtons & (1 << button)) !== 0;
  }

  mousePressed(button = 0): boolean {
    return (this.pressedButtons & (1 << button)) !== 0;
  }

  endFrame(): void {
    this.pressedKeys.clear();
    this.pressedButtons = 0;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
