import type { CombatEvent, MatchPhase, PlayerId } from '@wordwars/shared';

/**
 * Per-fighter engine state.
 *
 * Mutable by design: the engine is called on every word by every player, and
 * allocating a fresh immutable tree per keystroke is exactly the sort of hot
 * path that shows up as GC stutter mid-combo (plan §6.4). Mutation is contained
 * — nothing outside this package writes to it.
 */
export interface EngineFighter {
  readonly playerId: PlayerId;
  /** 0 or 1. Feeds the deterministic RNG so the two fighters roll differently. */
  readonly slot: number;

  hp: number;
  combo: number;
  maxCombo: number;
  ultimateCharge: number;
  ultimateReady: boolean;

  /** Next word this fighter is expected to commit. */
  wordIndex: number;

  // Accumulated for the results screen and the stats pipeline.
  damageDealt: number;
  damageTaken: number;
  wordsTyped: number;
  wordsMissed: number;
  charsTyped: number;
  ultimatesUsed: number;

  /** Match-relative ms of the last successful word; null before the first. */
  lastWordAtMs: number | null;
  /** Match-relative ms of the first successful word, for WPM. */
  firstWordAtMs: number | null;
  /** Best instantaneous WPM observed, for the results screen. */
  peakWpm: number;
}

export interface EngineMatchState {
  readonly matchId: string;
  readonly seed: number;
  readonly maxHp: number;
  readonly enableUltimate: boolean;
  readonly enableCrits: boolean;

  phase: MatchPhase;
  /** Monotonic counter, incremented per resolved action. Orders events. */
  tickCount: number;
  elapsedMs: number;
  rageMultiplier: number;

  fighters: readonly [EngineFighter, EngineFighter];

  winnerId: PlayerId | null;
}

export interface EngineConfig {
  readonly matchId: string;
  readonly seed: number;
  readonly players: readonly [PlayerId, PlayerId];
  readonly maxHp?: number;
  readonly enableUltimate?: boolean;
  readonly enableCrits?: boolean;
}

/**
 * A committed word.
 *
 * `wordLength` rather than the word itself — the engine never needs the text,
 * and not accepting it keeps a whole category of accidental coupling (locale,
 * casing, sanitisation) out of the combat layer.
 */
export interface WordAttempt {
  readonly playerId: PlayerId;
  readonly wordIndex: number;
  readonly wordLength: number;
  /** True if the player mistyped anywhere in the word, even if repaired. */
  readonly dirty: boolean;
  /** Match-relative ms at which the word was committed. */
  readonly atMs: number;
}

export type RejectionReason = 'unknown-player' | 'wrong-word-index' | 'match-over';

/** What changed as a result of an action. */
export interface MatchDelta {
  readonly events: readonly CombatEvent[];
  readonly terminal: boolean;
  /** Set when the attempt was refused; `events` is then empty. */
  readonly rejected?: RejectionReason;
}

export const EMPTY_DELTA: MatchDelta = { events: [], terminal: false };
