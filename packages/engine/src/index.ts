/**
 * @wordwars/engine — the combat rules.
 *
 * Pure and deterministic. No I/O, no clock, no `Math.random()`, no dependency
 * on the server or the browser. Time is injected; randomness is derived from
 * the match seed by position (see rng.ts).
 *
 * The same code runs in two places: the client uses it to predict its own
 * attacks the instant a word is committed, and the server uses it as the
 * authority (plan §1.1 D1). That only works because it is deterministic — so
 * if you are tempted to reach for the clock or a random number in here,
 * the lint rules will stop you, and they are right to.
 */

export * from './constants.js';
export * from './formulas.js';
export * from './match.js';
export * from './rng.js';
export * from './types.js';
