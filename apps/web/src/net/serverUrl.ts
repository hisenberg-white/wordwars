/**
 * Where the game server lives, from the browser's point of view.
 *
 * **Empty means "the same origin as this page", and that is the default.**
 *
 * The old default was a literal `http://localhost:4000`, which works on the
 * machine running the server and nowhere else. Open the game from another
 * computer — a phone, a tunnel, a colleague's laptop — and the page loads
 * perfectly while every request and the whole socket try to reach a server on
 * *that* machine, where nothing is listening. The game appears to start and
 * then simply never connects.
 *
 * Same-origin removes the question: whatever host the player reached the page
 * on is the host they talk to. In development the Vite dev server proxies
 * `/api`, `/socket.io` and friends through to port 4000 (see vite.config.ts),
 * so one tunnel pointed at the web port carries the entire game. In production
 * the same holds behind any reverse proxy.
 *
 * `VITE_SERVER_URL` remains for the split-origin deployment, where the API has
 * its own hostname. Vite inlines it at build time, so it is a deploy-time
 * decision rather than a runtime one.
 */
const configured = import.meta.env.VITE_SERVER_URL?.trim() ?? '';

/** Base for REST calls. Empty string yields relative, same-origin URLs. */
export const API_BASE = configured.replace(/\/$/, '');

/**
 * Where the socket connects.
 *
 * `undefined` tells socket.io-client to use the page's own origin, which is
 * exactly what we want when the server is proxied. Passing an empty string
 * instead would be interpreted as a relative path and not as "same origin".
 */
export const SOCKET_URL: string | undefined = configured === '' ? undefined : configured;
