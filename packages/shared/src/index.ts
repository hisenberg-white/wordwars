/**
 * @wordwars/shared — the contract between client and server.
 *
 * Consumed as TypeScript source (no build step). Anything exported here is
 * compiled into both the browser bundle and the server bundle, so this package
 * must stay free of runtime dependencies beyond `zod`, and free of any
 * environment assumptions (no `window`, no `process`).
 */

export * from './ids.js';

export * from './domain/player.js';
export * from './domain/auth.js';
export * from './domain/content.js';
export * from './domain/combat.js';
export * from './domain/match.js';
export * from './domain/room.js';

export * from './net/errors.js';
export * from './net/payloads.js';
export * from './net/contract.js';
