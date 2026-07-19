import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Hosts the dev server will answer to, beyond localhost.
 *
 * Vite refuses requests carrying an unexpected `Host` header, and that refusal
 * is a real protection rather than red tape: without it, any website you happen
 * to have open could point a DNS name at 127.0.0.1 and read from your dev
 * server. So this stays CLOSED by default and opens only when asked.
 *
 * Read from `.env` via `loadEnv` rather than `process.env` directly, because
 * `pnpm dev` goes through Turborepo and an inline environment variable does not
 * reliably reach the task process. Putting it in `apps/web/.env` always works:
 *
 *   VITE_ALLOWED_HOSTS=.ngrok-free.dev
 *
 * A leading dot matches subdomains, which is what tunnels need since the
 * hostname changes every session.
 *
 * The tunnel also needs the API reachable, which is two more settings:
 *   VITE_SERVER_URL=https://<api-tunnel>   (inlined at startup, not runtime)
 *   CORS_ORIGIN=https://<web-tunnel>       (in apps/server/.env)
 */
/** Where the game server actually runs. Only the dev proxy needs to know. */
const SERVER_TARGET = process.env['VITE_PROXY_TARGET'] ?? 'http://localhost:4000';

function tunnelHosts(mode: string, root: string): string[] {
  const env = loadEnv(mode, root, '');

  return (env['VITE_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const allowedHosts = tunnelHosts(mode, root);

  return {
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

      /*
       * The game server, served through this one.
       *
       * Without this, the browser has to reach port 4000 directly, which only
       * ever works on the machine running it: open the game from a phone or a
       * tunnel and the page loads while every request and the socket try to
       * find a server on the VIEWER's computer. Proxying makes the whole game
       * same-origin, so a single tunnel pointed at this port carries it all.
       *
       * `ws: true` on /socket.io is the load-bearing part — the fight is a
       * WebSocket, and a proxy that forwards only HTTP gives you a lobby that
       * loads and a match that never starts.
       */
      proxy: {
        '/socket.io': { target: SERVER_TARGET, ws: true, changeOrigin: true },
        '/api': { target: SERVER_TARGET, changeOrigin: true },
        '/health': { target: SERVER_TARGET, changeOrigin: true },
        '/metrics': { target: SERVER_TARGET, changeOrigin: true },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          // Phaser is large and only needed once a match starts. Splitting it
          // out keeps the landing page fast — the first paint should never wait
          // on the game engine.
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            // Split so the landing page never downloads the game engine. The
            // chunk is only fetched when GameCanvas dynamically imports it.
            phaser: ['phaser'],
          },
        },
      },
    },
  };
});
