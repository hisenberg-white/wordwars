import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Phaser is large and only needed once a match starts. Splitting it out
        // keeps the landing page fast — the first paint should never wait on
        // the game engine.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          // Split so the landing page never downloads the game engine. The
          // chunk is only fetched when GameCanvas dynamically imports it.
          phaser: ['phaser'],
        },
      },
    },
  },
});
