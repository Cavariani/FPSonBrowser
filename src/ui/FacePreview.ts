import * as THREE from 'three';
import { loadFaceTexture } from '../core/faceTexture';
import { CharacterModel } from '../fx/Character';

const W = 220;
const H = 260;
const SPIN = 0.55; // rad/s

/**
 * Preview 3D do boneco (menu). Renderer próprio, fundo transparente.
 * O loop só roda entre start() e stop(); dispose() libera tudo (GL, geometrias, texturas).
 */
export class FacePreview {
  readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
  private model: CharacterModel;
  private tex: THREE.Texture | null = null;
  private face: string | null = null;
  private faceReq = 0;
  private angle = Math.PI * 0.12;
  private raf = 0;
  private last = 0;
  private dragging = false;
  private lastX = 0;
  private disposed = false;
  private offs: (() => void)[] = [];

  constructor(color: number, seed = 7) {
    const c = this.canvas;
    c.className = 'face-canvas';
    c.width = W; c.height = H;
    c.style.touchAction = 'none';

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
    key.position.set(-1.5, 3, -4); // luz vem do lado da câmera (frente do boneco = -z)
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6cc4ff, 0.8);
    rim.position.set(3, 1.5, 3);
    this.scene.add(rim);

    this.model = new CharacterModel(color, seed);
    this.model.root.rotation.y = this.angle;
    this.scene.add(this.model.root);

    // frente do boneco = -z → câmera em -z olhando pro peito/cabeça
    this.camera.position.set(0, 1.2, -4.3);
    this.camera.lookAt(0, 0.9, 0);

    const down = (e: PointerEvent) => {
      this.dragging = true; this.lastX = e.clientX;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignora */ }
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.angle += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    };
    const up = () => { this.dragging = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    this.offs.push(
      () => c.removeEventListener('pointerdown', down),
      () => c.removeEventListener('pointermove', move),
      () => c.removeEventListener('pointerup', up),
      () => c.removeEventListener('pointercancel', up),
    );
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer || this.disposed) return this.renderer;
    try {
      const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.setSize(W, H, false);
      r.setClearColor(0x000000, 0);
      this.renderer = r;
    } catch (e) {
      console.warn('[face] WebGL indisponível para o preview', e);
    }
    return this.renderer;
  }

  /** Troca a foto (data URL) ou remove (null). */
  setFace(face: string | null): void {
    if (face === this.face || this.disposed) return;
    this.face = face;
    const req = ++this.faceReq;
    if (!face) { this.applyTex(null); return; }
    loadFaceTexture(face).then(
      (tex) => { if (req !== this.faceReq || this.disposed) tex.dispose(); else this.applyTex(tex); },
      () => { if (req === this.faceReq) this.applyTex(null); },
    );
  }

  private applyTex(tex: THREE.Texture | null): void {
    (this.model as any).setFace?.(tex); // setFace é do agente de arte; defensivo enquanto não existir
    this.tex?.dispose();
    this.tex = tex;
    this.renderOnce();
  }

  start(): void {
    if (this.raf || this.disposed || !this.ensureRenderer()) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (!this.dragging) this.angle += SPIN * dt;
      this.draw(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.dragging = false;
  }

  private renderOnce(): void {
    if (!this.raf && this.renderer) this.draw(0);
  }

  private draw(dt: number): void {
    this.model.root.rotation.y = this.angle;
    this.model.update(dt, { speed: 0, grounded: true, crouched: false, pitch: 0, weapon: 'pistol' });
    this.renderer?.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.offs.forEach((f) => f());
    this.offs = [];
    (this.model as any).setFace?.(null);
    this.scene.remove(this.model.root);
    this.model.dispose();
    this.tex?.dispose();
    this.tex = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.canvas.remove();
  }
}
