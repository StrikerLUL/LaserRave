import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      // Required for SharedArrayBuffer, which onnxruntime-web (used by the
      // AI song analysis worker) needs for its threaded WASM build.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    // Stale hashed assets from previous builds otherwise pile up in dist/ forever
    // (this directory had grown to 120 MB / 118 files).
    emptyOutDir: true,
    // three.js is ~600 kB on its own and changes only on dependency upgrades.
    // Splitting it out means editing app code no longer invalidates the browser
    // cache entry for the engine.
    // Vite 8 uses Rolldown, whose manualChunks only accepts the function form.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          return null;
        },
      },
    },
    // The vendor chunk is legitimately over the default 500 kB warning limit.
    chunkSizeWarningLimit: 800,
  },
});
