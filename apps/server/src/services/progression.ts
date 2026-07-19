import type { MatchOutcomeForStats } from '../db/repositories.js';

/**
 * XP and levels.
 *
 * Pure, so the curve can be reasoned about and tested rather than discovered
 * by playing for a week. Two rules shape every number here:
 *
 *   1. **Losing must still pay.** A player who loses and gains nothing has
 *      been told the last ninety seconds were worthless. The base award is the
 *      largest single component precisely so that showing up is rewarded — the
 *      win bonus is a bonus, not the whole point.
 *   2. **Performance beats outcome.** A clean, high-combo loss out-earns a
 *      sloppy win. That keeps the incentive pointed at playing WELL rather
 *      than at farming easy opponents.
 */

export const XP_BASE = 60;
export const XP_WIN_BONUS = 45;

/** Accuracy below this earns nothing extra; it is the floor of competence. */
const ACCURACY_FLOOR_BP = 8_000;
const XP_ACCURACY_MAX = 45;

/** Combo contribution, capped so a single freak streak cannot dominate. */
const XP_PER_COMBO = 1.5;
const XP_COMBO_MAX = 60;

export interface XpAward {
  readonly total: number;
  readonly base: number;
  readonly win: number;
  readonly accuracy: number;
  readonly combo: number;
}

export function xpForMatch(outcome: MatchOutcomeForStats): XpAward {
  const win = outcome.won ? XP_WIN_BONUS : 0;

  // Scaled from the floor rather than from zero: 80% accuracy earns nothing,
  // 100% earns the full bonus. Rewarding the gap between 40% and 60% would
  // pay for flailing.
  const accuracyRange = 10_000 - ACCURACY_FLOOR_BP;
  const above = Math.max(0, outcome.accuracyBp - ACCURACY_FLOOR_BP);
  const accuracy = Math.round((above / accuracyRange) * XP_ACCURACY_MAX);

  const combo = Math.min(XP_COMBO_MAX, Math.round(outcome.maxCombo * XP_PER_COMBO));

  return {
    base: XP_BASE,
    win,
    accuracy,
    combo,
    total: XP_BASE + win + accuracy + combo,
  };
}

/**
 * Cumulative XP required to reach a level.
 *
 * A gentle exponent rather than a linear cost: the first few levels arrive
 * within a handful of matches so a new player sees progress immediately, and
 * later ones take long enough to mean something. Level 2 lands after roughly
 * two matches, level 10 after about forty.
 */
const LEVEL_COEFFICIENT = 200;
const LEVEL_EXPONENT = 1.6;

export function xpToReachLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(LEVEL_COEFFICIENT * (level - 1) ** LEVEL_EXPONENT);
}

/** The level a given total XP has earned. */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;

  let level = 1;
  // Bounded so a corrupt XP value cannot spin forever.
  while (level < 200 && xpToReachLevel(level + 1) <= xp) level += 1;
  return level;
}

export interface LevelProgress {
  readonly level: number;
  readonly xp: number;
  readonly currentLevelAt: number;
  readonly nextLevelAt: number;
  /** 0–1 through the current level, for the progress bar. */
  readonly fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const currentLevelAt = xpToReachLevel(level);
  const nextLevelAt = xpToReachLevel(level + 1);

  const span = nextLevelAt - currentLevelAt;
  const fraction = span <= 0 ? 1 : Math.max(0, Math.min(1, (xp - currentLevelAt) / span));

  return { level, xp, currentLevelAt, nextLevelAt, fraction };
}
