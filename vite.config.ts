import { defineConfig } from 'vite';

// base relativo pra funcionar no GitHub Pages (/FPSonBrowser/)
export default defineConfig({
  base: './',
  server: { port: 5199 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
