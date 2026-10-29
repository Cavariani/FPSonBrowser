import { RECIPES } from './recipes';
import { hashStr, mulberry32 } from './dsp';

/**
 * Worker de síntese: gera todos os samples fora da thread principal (a geração custa
 * alguns segundos de CPU no total) e devolve cada variante assim que fica pronta.
 */
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<{ sr: number }>) => void) | null;
  postMessage(msg: unknown, transfer: Transferable[]): void;
};

scope.onmessage = (ev) => {
  const sr = ev.data.sr;
  for (const r of RECIPES) {
    for (let v = 0; v < r.variants; v++) {
      try {
        const data = r.build(mulberry32(hashStr(r.name) + v * 7919), sr, v);
        scope.postMessage({ name: r.name, variant: v, data }, [data.buffer as ArrayBuffer]);
      } catch (err) {
        console.error('[audio] falha ao gerar', r.name, err);
      }
    }
  }
};
