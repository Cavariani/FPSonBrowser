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
 * Passe final: desenha o render target de baixa resolução na tela com cara de monitor CRT.
 * Curvatura leve, aberração cromática nas bordas, glow nos claros, scanlines por linha de pixel,
 * máscara RGB sutil, grão e flicker — mais o grading quente, flash de dano e dessaturação na morte.
 * Um passe só (~8 leituras de textura por pixel).
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
        float m[16];
        m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
        m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
        float r = 0.0;
        for (int k = 0; k < 16; k++) if (float(k) == i) r = m[k];
        return r / 16.0 - 0.5;
      }

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        // curvatura de tubo (bem leve, não atrapalha a mira)
        vec2 cc = vUv - 0.5;
        float r2 = dot(cc, cc);
        vec2 uv = 0.5 + cc * (1.0 + 0.045 * r2 + 0.03 * r2 * r2);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        // aberração cromática crescendo pras bordas
        vec2 px = 1.0 / uRes;
        vec2 ca = cc * px * 2.2;
        vec3 c;
        c.r = texture2D(tDiffuse, uv + ca).r;
        c.g = texture2D(tDiffuse, uv).g;
        c.b = texture2D(tDiffuse, uv - ca).b;

        // glow barato: borrão de 4 amostras, só o que passa de um limiar volta somado
        vec3 blur = texture2D(tDiffuse, uv + vec2( 1.5,  0.5) * px).rgb
                  + texture2D(tDiffuse, uv + vec2(-1.5, -0.5) * px).rgb
                  + texture2D(tDiffuse, uv + vec2(-0.5,  1.5) * px).rgb
                  + texture2D(tDiffuse, uv + vec2( 0.5, -1.5) * px).rgb;
        blur *= 0.25;
        c += max(blur - 0.55, 0.0) * 0.55;

        // grading quente: sombras levemente frias, luzes douradas
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 warm = c * vec3(1.06, 1.0, 0.9);
        vec3 cool = c * vec3(0.94, 0.98, 1.08);
        c = mix(cool, warm, smoothstep(0.02, 0.35, l));
        c = mix(vec3(l), c, 1.14);
        c = c / (1.0 + c * 0.12) * 1.12;

        // scanlines: escurece a borda de baixo de cada linha de pixel do render interno
        float row = fract(uv.y * uRes.y);
        float scan = 1.0 - 0.16 * smoothstep(0.55, 1.0, row) - 0.05 * smoothstep(0.45, 0.0, row);
        c *= scan;

        // máscara de fósforo RGB (colunas da tela real), bem sutil
        float m = mod(gl_FragCoord.x, 3.0);
        vec3 mask = vec3(m < 1.0 ? 1.06 : 0.97, (m >= 1.0 && m < 2.0) ? 1.06 : 0.97, m >= 2.0 ? 1.06 : 0.97);
        c *= mask;

        // vinheta de tubo
        vec2 d = vUv - 0.5;
        d.x *= uRes.x / max(uRes.y, 1.0) * 0.75;
        float r = length(d);
        float v = smoothstep(0.9, 0.3, r);
        c *= mix(0.68, 1.0, v);
        // cantos arredondados escuros
        vec2 e = abs(uv - 0.5) * 2.0;
        float corner = smoothstep(1.0, 0.94, max(pow(e.x, 6.0) + pow(e.y, 6.0), 0.0));
        c *= corner;

        // dano: bordas vermelhas pulsando
        float edge = smoothstep(0.25, 0.85, r);
        c = mix(c, vec3(0.75, 0.03, 0.02), uDamage * (0.25 + edge * 0.75) * 0.85);

        // morto: dessatura e escurece puxando pro sépia
        float g = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, vec3(g) * vec3(1.0, 0.86, 0.74) * 0.8, uDead * 0.85);

        // flicker e grão de filme
        c *= 1.0 + 0.012 * sin(uTime * 59.0) + 0.008 * sin(uTime * 7.3);
        c += (hash(gl_FragCoord.xy + fract(uTime * 13.7) * 91.0) - 0.5) * 0.035;

        gl_FragColor = vec4(max(c, 0.0), 1.0);
        #include <colorspace_fragment>
        // dither depois da codificação sRGB (tira banding do céu)
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
