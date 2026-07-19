import type { MatchId, PlayerId } from '../ids.js';
import type { ArenaId, CharacterId } from './content.js';
import type { CombatEvent, FighterResult, FighterState } from './combat.js';

export const GAME_MODES = ['1v1'] as const;
/** Future: '2v2' | '4v4' | 'ffa' | 'boss' — the contract is shaped to absorb them. */
export type GameMode = (typeof GAME_MODES)[number];

/**
 * `intermission` is the gap between rounds of a best-of-3/5.
 *
 * Distinct from `knockout`, which means the MATCH is decided. Collapsing the
 * two would make "someone hit zero HP" and "someone won" the same event, and
 * they are only the same in a best-of-1.
 */
export const MATCH_PHASES = ['countdown', 'combat', 'intermission', 'knockout', 'results'] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'code'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Immutable per-match configuration, fixed at match start. */
export interface MatchConfig {
  readonly matchId: MatchId;
  readonly mode: GameMode;
  readonly arenaId: ArenaId;
  readonly difficulty: Difficulty;
  readonly language: string;
  /** Seeds the shared PRNG (plan §1.1 D4) so both clients agree on crits/FX. */
  readonly seed: number;
  readonly maxHp: number;
  readonly enableUltimate: boolean;
  readonly enableCrits: boolean;
  readonly roundCount: 1 | 3 | 5;
  readonly isRanked: boolean;
}

/** A participant as the match layer sees them. Identity, not stats. */
export interface MatchFighter {
  readonly playerId: PlayerId;
  readonly nickname: string;
  readonly characterId: CharacterId;
  readonly isGuest: boolean;
  readonly level: number;
  /** Which side of the arena. Purely presentational. */
  readonly side: 'left' | 'right';
}

/** A chunk of text to fight over. Streamed ahead of need — never a pause. */
export interface Sentence {
  readonly index: number;
  readonly words: readonly string[];
}

/** 10Hz reconciliation snapshot. */
export interface MatchSnapshot {
  readonly tick: number;
  readonly phase: MatchPhase;
  readonly fighters: readonly FighterState[];
  /** Sudden-death multiplier; 1 until Rage engages. */
  readonly rageMultiplier: number;
  readonly elapsedMs: number;
  /** Current round, 1-based. Always 1 in a best-of-1. */
  readonly round: number;
  /** Rounds won so far, indexed by fighter slot. */
  readonly score: readonly [number, number];
}

/** 30Hz narration batch. */
export interface MatchEventBatch {
  readonly tick: number;
  readonly events: readonly CombatEvent[];
}

export type MatchEndReason = 'knockout' | 'forfeit' | 'disconnect' | 'aborted';

export interface MatchResult {
  readonly matchId: MatchId;
  readonly winnerId: PlayerId | null;
  readonly reason: MatchEndReason;
  readonly durationMs: number;
  readonly fighters: readonly FighterResult[];
  /** XP awarded this match, per player. Empty for guests. */
  readonly xpAwarded: Readonly<Record<string, number>>;
}
