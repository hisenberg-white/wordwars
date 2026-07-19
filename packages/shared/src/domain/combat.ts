import type { PlayerId } from '../ids.js';

/**
 * Combat events — the server's narration of the fight.
 *
 * This union is the single most important type in the game. It is what the
 * renderer animates, what the audio layer reacts to, and what a spectator
 * effectively "watches". Design test (plan §0): given only a stream of these
 * events and no text, a viewer must be able to tell who is winning.
 *
 * Events are produced by the authoritative server and batched at ~30Hz.
 * The client also produces them locally for prediction (plan §1.1 D1) — the
 * same union, so the renderer cannot tell predicted from confirmed. That is
 * deliberate: it keeps the animation path identical and impossible to desync
 * cosmetically.
 */

/** Flavour of a landed hit. Cosmetic only — damage is computed separately. */
export const ATTACK_KINDS = [
  'punch',
  'kick',
  'slash',
  'fireball',
  'arrow',
  'laser',
  'magic',
] as const;

export type AttackKind = (typeof ATTACK_KINDS)[number];

/** Combo tiers. Crossing a boundary is a visible, audible moment. */
export type ComboTier = 0 | 1 | 2 | 3 | 4;

interface BaseEvent {
  /** Server tick this event resolved on. Orders events across a batch. */
  readonly t: number;
}

/** A correctly typed word landed a hit. */
export interface AttackEvent extends BaseEvent {
  readonly type: 'attack';
  readonly actor: PlayerId;
  readonly target: PlayerId;
  readonly damage: number;
  readonly kind: AttackKind;
  readonly combo: number;
  readonly crit: boolean;
  /** Drives hit-stop duration and impact scale. Derived from word length. */
  readonly weight: number;
}

/** A mistyped word. No damage — the cost is the combo (plan §5.3). */
export interface MissEvent extends BaseEvent {
  readonly type: 'miss';
  readonly actor: PlayerId;
  readonly comboLost: number;
}

/** Combo crossed into a new tier — worth a flourish. */
export interface ComboTierEvent extends BaseEvent {
  readonly type: 'combo-tier';
  readonly actor: PlayerId;
  readonly tier: ComboTier;
  readonly combo: number;
}

/** Ultimate meter filled. The next word will be rendered gold. */
export interface UltimateReadyEvent extends BaseEvent {
  readonly type: 'ultimate-ready';
  readonly actor: PlayerId;
}

/** Cinematic. Freezes the scene, ducks the audio, pushes the camera in. */
export interface UltimateEvent extends BaseEvent {
  readonly type: 'ultimate';
  readonly actor: PlayerId;
  readonly target: PlayerId;
  readonly damage: number;
}

/** Sudden-death damage ramp engaged (plan §5.4). */
export interface RageEvent extends BaseEvent {
  readonly type: 'rage';
  readonly multiplier: number;
}

/** Someone hit zero HP. */
export interface KnockoutEvent extends BaseEvent {
  readonly type: 'knockout';
  readonly winner: PlayerId;
  readonly loser: PlayerId;
}

export type CombatEvent =
  | AttackEvent
  | MissEvent
  | ComboTierEvent
  | UltimateReadyEvent
  | UltimateEvent
  | RageEvent
  | KnockoutEvent;

export type CombatEventType = CombatEvent['type'];

/**
 * Per-player mutable combat state. Broadcast at 10Hz for reconciliation —
 * the client predicts between snapshots and corrects toward these values.
 */
export interface FighterState {
  readonly playerId: PlayerId;
  readonly hp: number;
  readonly maxHp: number;
  readonly combo: number;
  readonly maxCombo: number;
  readonly ultimateCharge: number;
  readonly ultimateReady: boolean;
  /** Index of the next word this player must type. */
  readonly wordIndex: number;
}

/** End-of-match per-player summary. Feeds the results screen and the DB. */
export interface FighterResult {
  readonly playerId: PlayerId;
  readonly hpRemaining: number;
  readonly damageDealt: number;
  readonly wordsTyped: number;
  readonly wordsMissed: number;
  readonly accuracy: number;
  readonly avgWpm: number;
  readonly peakWpm: number;
  readonly maxCombo: number;
  readonly ultimatesUsed: number;
}
