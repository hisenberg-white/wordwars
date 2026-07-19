import type { MatchOutcomeForStats, UserStatsRecord } from '../db/repositories.js';

/**
 * Achievements.
 *
 * Declared rather than coded: every achievement is a `metric` function and a
 * `target`, which means progress, unlocking and the progress bar all fall out
 * of one comparison. Hand-written unlock logic per achievement is how a system
 * like this ends up with fourteen subtly different definitions of "done".
 *
 * The catalogue lives on the SERVER and is sent to the client already
 * evaluated. The client never computes whether something is earned — it could
 * not be trusted to, and duplicating the rules would guarantee they drift.
 */

export type AchievementCategory = 'milestone' | 'skill' | 'dedication';

export interface AchievementContext {
  /** Stats AFTER the match just played. */
  readonly stats: UserStatsRecord;
  /** The match that just finished. */
  readonly outcome: MatchOutcomeForStats;
}

export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly xpReward: number;
  readonly target: number;
  /** Current value toward the target. */
  readonly metric: (ctx: AchievementContext) => number;
  /**
   * True when the achievement is a single-match feat rather than a running
   * total — those show as earned-or-not rather than as a progress bar, because
   * "you are 60% of the way to a perfect match" is not a meaningful thing to
   * tell somebody.
   */
  readonly single?: boolean;
}

/**
 * A perfect match needs enough words to be an achievement.
 *
 * Without this, a match that ended in four words on a disconnect would hand
 * out the accuracy award — the most prestigious thing on the list — for
 * essentially nothing.
 */
const MIN_WORDS_FOR_PERFECTION = 25;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-victory',
    name: 'First Blood',
    description: 'Win your first match.',
    category: 'milestone',
    xpReward: 50,
    target: 1,
    metric: (c) => c.stats.wins,
  },
  {
    id: 'ten-wins',
    name: 'Contender',
    description: 'Win 10 matches.',
    category: 'milestone',
    xpReward: 120,
    target: 10,
    metric: (c) => c.stats.wins,
  },
  {
    id: 'hundred-wins',
    name: 'Centurion',
    description: 'Win 100 matches.',
    category: 'milestone',
    xpReward: 600,
    target: 100,
    metric: (c) => c.stats.wins,
  },
  {
    id: 'flawless',
    name: 'Flawless',
    description: `Finish a match of ${MIN_WORDS_FOR_PERFECTION}+ words without a single mistake.`,
    category: 'skill',
    xpReward: 250,
    target: 1,
    single: true,
    metric: (c) =>
      c.outcome.accuracyBp >= 10_000 && c.outcome.wordsTyped >= MIN_WORDS_FOR_PERFECTION ? 1 : 0,
  },
  /*
   * CORRECTED after measuring what a match can actually produce.
   *
   * These were originally 50 and 100. Simulation showed the ceiling is roughly
   * 47: a match ENDS at ~45 words, so a 100 combo was literally unreachable —
   * dead content that mocks anyone who chases it. Counterintuitively a BETTER
   * player peaks lower, because they win faster and therefore type fewer words.
   *
   * If match length ever changes, revisit these. `achievements.reachable.test`
   * fails if a target drifts past what the engine can produce.
   */
  {
    id: 'combo-30',
    name: 'Chain Reaction',
    description: 'Reach a 30 combo in one match.',
    category: 'skill',
    xpReward: 150,
    target: 30,
    single: true,
    metric: (c) => c.outcome.maxCombo,
  },
  {
    id: 'combo-45',
    name: 'Unbroken',
    description: 'Reach a 45 combo in one match.',
    category: 'skill',
    xpReward: 400,
    target: 45,
    single: true,
    metric: (c) => c.outcome.maxCombo,
  },
  {
    id: 'speed-120',
    name: 'Quickdraw',
    description: 'Average 120 WPM across a match.',
    category: 'skill',
    xpReward: 200,
    target: 120,
    single: true,
    metric: (c) => c.outcome.avgWpm,
  },
  {
    id: 'speed-150',
    name: 'Blur',
    description: 'Average 150 WPM across a match.',
    category: 'skill',
    xpReward: 450,
    target: 150,
    single: true,
    metric: (c) => c.outcome.avgWpm,
  },
  {
    id: 'streak-5',
    name: 'On a Roll',
    description: 'Win 5 matches in a row.',
    category: 'skill',
    xpReward: 180,
    target: 5,
    metric: (c) => c.stats.bestStreak,
  },
  {
    id: 'streak-15',
    name: 'Untouchable',
    description: 'Win 15 matches in a row.',
    category: 'skill',
    xpReward: 700,
    target: 15,
    metric: (c) => c.stats.bestStreak,
  },
  {
    id: 'words-1000',
    name: 'Wordsmith',
    description: 'Land 1,000 words.',
    category: 'dedication',
    xpReward: 120,
    target: 1_000,
    metric: (c) => c.stats.totalWords,
  },
  {
    id: 'words-10000',
    name: 'Novelist',
    description: 'Land 10,000 words.',
    category: 'dedication',
    xpReward: 500,
    target: 10_000,
    metric: (c) => c.stats.totalWords,
  },
  {
    id: 'matches-50',
    name: 'Regular',
    description: 'Play 50 matches.',
    category: 'dedication',
    xpReward: 200,
    target: 50,
    metric: (c) => c.stats.matches,
  },
];

export interface AchievementProgress {
  readonly id: string;
  readonly progress: number;
  readonly unlockedAt: number | null;
}

export interface EvaluatedAchievement extends AchievementProgress {
  readonly name: string;
  readonly description: string;
  readonly category: AchievementCategory;
  readonly xpReward: number;
  readonly target: number;
  readonly single: boolean;
  /** 0–1, for the progress bar. */
  readonly fraction: number;
}

/**
 * Works out what a match earned.
 *
 * Pure: given the same stats and outcome it always returns the same answer.
 * `existing` is what the player had before, so an achievement already earned
 * is never awarded twice — and progress on a running total never goes
 * backwards even if a bad match lowers an average.
 */
export function evaluate(
  ctx: AchievementContext,
  existing: ReadonlyMap<string, AchievementProgress>,
): { unlocked: AchievementDef[]; progress: AchievementProgress[]; xpAwarded: number } {
  const unlocked: AchievementDef[] = [];
  const progress: AchievementProgress[] = [];
  let xpAwarded = 0;

  for (const def of ACHIEVEMENTS) {
    const previous = existing.get(def.id);
    if (previous?.unlockedAt) {
      progress.push(previous);
      continue;
    }

    const value = def.metric(ctx);

    /*
     * Single-match feats keep their BEST attempt, cumulative ones take the
     * current total. Without this, a 60-combo followed by a 3-combo match
     * would show the player's progress toward "Unbroken" going down — which
     * reads as the game taking something away from them.
     */
    const best = def.single ? Math.max(previous?.progress ?? 0, value) : value;
    const nowUnlocked = best >= def.target;

    const record: AchievementProgress = {
      id: def.id,
      progress: best,
      unlockedAt: nowUnlocked ? Date.now() : null,
    };

    progress.push(record);

    if (nowUnlocked) {
      unlocked.push(def);
      xpAwarded += def.xpReward;
    }
  }

  return { unlocked, progress, xpAwarded };
}

/** Joins stored progress with the catalogue, for display. */
export function describe(stored: ReadonlyMap<string, AchievementProgress>): EvaluatedAchievement[] {
  return ACHIEVEMENTS.map((def) => {
    const record = stored.get(def.id);
    const progress = Math.min(record?.progress ?? 0, def.target);

    return {
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      xpReward: def.xpReward,
      target: def.target,
      single: def.single ?? false,
      progress,
      unlockedAt: record?.unlockedAt ?? null,
      fraction: def.target === 0 ? 0 : Math.max(0, Math.min(1, progress / def.target)),
    };
  });
}
