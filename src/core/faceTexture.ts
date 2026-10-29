import * as THREE from 'three';

/** Carrega uma data URL (jpeg/png) numa THREE.Texture pronta pra usar como "cara" do boneco. */
export function loadFaceTexture(dataUrl: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => reject(new Error('imagem inválida'));
    img.src = dataUrl;
  });
}
