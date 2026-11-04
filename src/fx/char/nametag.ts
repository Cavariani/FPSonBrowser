import * as THREE from 'three';

const W = 256, H = 64;

/**
 * Plaquinha com o nome do jogador, flutuando em cima do boneco.
 * Sprite com depthTest: parede tapa o nome (senão vira wallhack de graça).
 */
export class NameTag {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private mat: THREE.SpriteMaterial;
  private text = '';

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, fog: false });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.scale.set(1.5, (1.5 * H) / W, 1);
    this.sprite.renderOrder = 5;
    this.sprite.visible = false;
  }

  get hasText(): boolean {
    return !!this.text;
  }

  set(name: string, color: number): void {
    const text = name.trim().slice(0, 16);
    if (text === this.text) return;
    this.text = text;
    const c = this.canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, W, H);
    this.sprite.visible = !!text;
    if (!text) return;
    c.font = 'bold 34px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const tw = Math.min(W - 8, c.measureText(text).width + 26);
    // fundo escuro com a faixa da cor do jogador embaixo
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.beginPath();
    c.roundRect((W - tw) / 2, 8, tw, 44, 10);
    c.fill();
    c.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    c.fillRect((W - tw) / 2 + 10, 47, tw - 20, 4);
    c.lineWidth = 5;
    c.strokeStyle = 'rgba(0,0,0,0.85)';
    c.strokeText(text, W / 2, 30, W - 30);
    c.fillStyle = '#fff';
    c.fillText(text, W / 2, 30, W - 30);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.mat.dispose();
  }
}
