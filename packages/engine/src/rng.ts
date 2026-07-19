/**
 * Deterministic randomness.
 *
 * **This is position-addressed, not sequential — and that distinction is the
 * whole point.**
 *
 * A conventional seeded PRNG produces its Nth value only after the previous
 * N-1 have been drawn. That works when one machine consumes the stream, but
 * here two do: the client predicts only its OWN attacks, while the server
 * resolves both players interleaved by arrival time. The two would consume
 * draws in different orders and disagree about which hits crit — a desync that
 * shows as one screen playing a critical the other never saw.
 *
 * Hashing `(seed, slot, index)` instead means any value can be computed in
 * isolation, in any order, on any machine, and always comes out the same. The
 * client can evaluate word 12 without ever having seen words 1–11.
 *
 * Not cryptographic and does not need to be: it decides whether a punch
 * sparkles. A player who predicted their own crits would gain nothing, because
 * the server independently computes the same answer and its result is the one
 * that counts.
 */

/**
 * Integer avalanche mix (MurmurHash3 finalizer, extended to fold in extra
 * words). `Math.imul` keeps multiplication in 32-bit lanes so the result is
 * identical across JS engines rather than drifting through float precision.
 */
function mix32(seed: number, a: number, b: number): number {
  let h = seed | 0;

  h = Math.imul(h ^ (a | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ 0x9e3779b9, 0x27d4eb2f);
  h ^= h >>> 15;

  return h >>> 0;
}

/**
 * A stable float in [0, 1) for a given coordinate in the match.
 *
 * `slot` distinguishes the two fighters so both players rolling on the same
 * word index do not share a result — otherwise crits would always land in
 * lockstep, which looks obviously fake.
 */
export function rollUnit(seed: number, slot: number, index: number): number {
  return mix32(seed, slot, index) / 0x1_0000_0000;
}

/** Picks an item deterministically from a non-empty list. */
export function pickDeterministic<T>(
  items: readonly T[],
  seed: number,
  slot: number,
  index: number,
): T {
  const chosen = items[mix32(seed, slot, index) % items.length];
  if (chosen === undefined) throw new Error('pickDeterministic called with an empty list');
  return chosen;
}
