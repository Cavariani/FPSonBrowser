import * as THREE from 'three';

export interface PostInfo {
  time: number;
  /** 0..1, flash vermelho / vinheta de dano. */
  damage: number;
  /** 0..1 enquanto morto (dessatura). */
  dead: number;
  /** Resolução interna (px) do render target. */
  resolution: THREE.Vector2;
}

/**
 * Passe final: desenha o render target de baixa resolução na tela.
 * Color grading quente, contraste/saturação leves, vinheta, flash de dano,
 * dessaturação quando morto e dither 4x4 sutil (tira banding do céu).
 */
export function createPost(): { material: THREE.ShaderMaterial; update(info: PostInfo): void } {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uDamage: { value: 0 },
      uDead: { value: 0 },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uDamage;
      uniform float uDead;
      uniform float uTime;
      uniform vec2 uRes;
      varying vec2 vUv;

      float bayer4(vec2 p) {
        vec2 q = mod(floor(p), 4.0);
        float i = q.x + q.y * 4.0;
        // matriz de Bayer 4x4 (0..15)
        float m[16];
        m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
        m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
        float r = 0.0;
        for (int k = 0; k < 16; k++) if (float(k) == i) r = m[k];
        return r / 16.0 - 0.5;
      }

      void main() {
        vec3 c = texture2D(tDiffuse, vUv).rgb; // linear

        // grading quente: sombras levemente frias, luzes douradas
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 warm = c * vec3(1.06, 1.0, 0.9);
        vec3 cool = c * vec3(0.94, 0.98, 1.08);
        c = mix(cool, warm, smoothstep(0.02, 0.35, l));
        // saturação
        c = mix(vec3(l), c, 1.12);
        // curva suave (ombro) para não estourar as paredes ao sol
        c = c / (1.0 + c * 0.12) * 1.1;

        // vinheta
        vec2 d = vUv - 0.5;
        d.x *= uRes.x / max(uRes.y, 1.0) * 0.75;
        float r = length(d);
        float v = smoothstep(0.9, 0.3, r);
        c *= mix(0.72, 1.0, v);

        // dano: bordas vermelhas pulsando
        float edge = smoothstep(0.25, 0.85, r);
        c = mix(c, vec3(0.75, 0.03, 0.02), uDamage * (0.25 + edge * 0.75) * 0.85);

        // morto: dessatura e escurece puxando pro sépia
        float g = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, vec3(g) * vec3(1.0, 0.86, 0.74) * 0.8, uDead * 0.85);

        gl_FragColor = vec4(max(c, 0.0), 1.0);
        #include <colorspace_fragment>
        // dither depois da codificação sRGB
        gl_FragColor.rgb += bayer4(gl_FragCoord.xy) / 255.0 * 1.5;
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  return {
    material,
    update(info) {
      material.uniforms.uDamage.value = info.damage;
      material.uniforms.uDead.value = info.dead;
      material.uniforms.uTime.value = info.time;
      material.uniforms.uRes.value.copy(info.resolution);
    },
  };
}
