import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Produces a single self-contained index.html (JS, CSS and the inlined worker
// all embedded) so the game can be opened directly in a browser with no server.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist-standalone',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
  },
  // Classic (iife) blob workers have the broadest support, incl. file:// pages.
  worker: { format: 'iife' },
});
