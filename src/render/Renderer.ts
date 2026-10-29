import * as THREE from 'three';
import { settings } from '../core/Settings';
import { createPost, type PostInfo } from './PostFX';

/**
 * Render em baixa resolução (pixel retrô) num render target, viewmodel por cima (sem atravessar parede),
 * e um passe final de pós-processo esticando com NearestFilter.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private rt: THREE.WebGLRenderTarget;
  private post = createPost();
  private quad: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly resolution = new THREE.Vector2(1, 1);
  private lastPixel = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.setPixelRatio(1);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    // Sombra do sol (mapa estático: a luz renderiza o shadow map uma vez só).
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      type: THREE.UnsignedByteType,
    });
    // 8 bits em sRGB (hardware codifica/decodifica): sem banding nas sombras.
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.post.material.uniforms.tDiffuse.value = this.rt.texture;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post.material);
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get aspect(): number {
    return window.innerWidth / Math.max(1, window.innerHeight);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    const px = Math.max(1, settings.pixelSize);
    this.lastPixel = px;
    this.resolution.set(Math.max(160, Math.round(w / px)), Math.max(90, Math.round(h / px)));
    this.rt.setSize(this.resolution.x, this.resolution.y);
  }

  render(scene: THREE.Scene, cam: THREE.Camera, vmScene: THREE.Scene | null, vmCam: THREE.Camera | null, info: Omit<PostInfo, 'resolution'>): void {
    if (this.lastPixel !== settings.pixelSize) this.resize();
    const gl = this.gl;
    gl.setRenderTarget(this.rt);
    gl.autoClear = true;
    gl.render(scene, cam);
    if (vmScene && vmCam) {
      gl.autoClear = false;
      gl.clearDepth();
      gl.render(vmScene, vmCam);
      gl.autoClear = true;
    }
    gl.setRenderTarget(null);
    this.post.update({ ...info, resolution: this.resolution });
    gl.render(this.postScene, this.postCam);
  }
}
