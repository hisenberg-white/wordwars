import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Hosts the dev server will answer to, beyond localhost.
 *
 * Vite refuses requests carrying an unexpected `Host` header, and that refusal
 * is a real protection, not red tape: without it any website you happen to have
 * open could point a DNS name at 127.0.0.1 and read from your dev server. So
 * this stays CLOSED by default and opens only when you say so.
 *
 * Set `VITE_ALLOWED_HOSTS` to a comma-separated list when tunnelling. A leading
 * dot matches subdomains, which is what you want for ngrok since the hostname
 * changes every session:
 *
 *   VITE_ALLOWED_HOSTS=.ngrok-free.dev pnpm --filter @wordwars/web dev
 *
 * Note the tunnel also needs the API reachable and allowed:
 *   VITE_SERVER_URL=https://<api-tunnel>   (inlined at startup, not runtime)
 *   CORS_ORIGIN=https://<web-tunnel>       (in apps/server/.env)
 */
const allowedHosts = (process.env['VITE_ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

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
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
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
