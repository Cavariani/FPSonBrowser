import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// base relativo pra funcionar em qualquer hospedagem estática (GitHub Pages, Vercel)
export default defineConfig({
  base: './',
  server: { port: 5199 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
