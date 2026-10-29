import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

function holeTexture(): THREE.Texture {
  // marca de tiro pixelada 8x8: miolo escuro, borda irregular
  const S = 8;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const px: [number, number, string][] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - 3.5, dy = y - 3.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < 1.6) px.push([x, y, 'rgba(10,10,10,1)']);
      else if (r < 2.8) px.push([x, y, 'rgba(40,36,32,0.95)']);
      else if (r < 3.8 && (x * 7 + y * 3) % 3 !== 0) px.push([x, y, 'rgba(70,64,56,0.7)']);
    }
  }
  for (const [x, y, c] of px) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Marcas de tiro: ring buffer de 64 quadradinhos alinhados à normal. Custo zero por frame. */
export class Decals {
  readonly mesh: THREE.InstancedMesh;
  private head = 0;
  private count = 0;

  constructor(private cap = 64) {
    const mat = new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, alphaTest: 0.2, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    this.mesh.renderOrder = 1;
  }

  add(point: THREE.Vector3, normal: THREE.Vector3, size: number, tint: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.count = Math.min(this.cap, this.count + 1);
    _q.setFromUnitVectors(_z, normal);
    _q2.setFromAxisAngle(_z, Math.random() * Math.PI * 2);
    _q.multiply(_q2);
    _p.copy(point).addScaledVector(normal, 0.006);
    const s = size * (0.8 + Math.random() * 0.4);
    _s.set(s, s, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, _c.setHex(tint));
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
