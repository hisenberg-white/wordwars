import { describe, expect, it } from 'vitest';
import { asUserId } from '@wordwars/shared';
import type { MatchOutcomeForStats, UserStatsRecord } from '../db/repositories.js';
import {
  ACHIEVEMENTS,
  describe as describeAchievements,
  evaluate,
  type AchievementProgress,
} from './achievements.js';

const USER = asUserId('u1');

const stats = (overrides: Partial<UserStatsRecord> = {}): UserStatsRecord => ({
  userId: USER,
  matches: 1,
  wins: 0,
  losses: 1,
  currentStreak: 0,
  bestStreak: 0,
  totalWords: 50,
  totalDamage: 2000,
  bestCombo: 10,
  bestWpm: 80,
  avgWpm: 70,
  avgAccuracyBp: 9_200,
  ...overrides,
});

const outcome = (overrides: Partial<MatchOutcomeForStats> = {}): MatchOutcomeForStats => ({
  won: false,
  wordsTyped: 50,
  damageDealt: 2000,
  maxCombo: 10,
  avgWpm: 70,
  peakWpm: 90,
  accuracyBp: 9_200,
  ...overrides,
});

const none = new Map<string, AchievementProgress>();
const idsOf = (r: { unlocked: Array<{ id: string }> }) => r.unlocked.map((a) => a.id);

describe('the catalogue', () => {
  it('has unique ids', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it('gives every achievement a positive target and reward', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.target, a.id).toBeGreaterThan(0);
      expect(a.xpReward, a.id).toBeGreaterThan(0);
    }
  });

  /** Rarer feats should pay better, or the reward carries no information. */
  it('pays more for the harder tier of a pair', () => {
    const find = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

    expect(find('hundred-wins').xpReward).toBeGreaterThan(find('ten-wins').xpReward);
    expect(find('combo-45').xpReward).toBeGreaterThan(find('combo-30').xpReward);
    expect(find('words-10000').xpReward).toBeGreaterThan(find('words-1000').xpReward);
  });
});

describe('unlocking', () => {
  it('awards a first victory', () => {
    const result = evaluate({ stats: stats({ wins: 1 }), outcome: outcome({ won: true }) }, none);
    expect(idsOf(result)).toContain('first-victory');
  });

  it('awards nothing before the target is met', () => {
    const result = evaluate({ stats: stats({ wins: 9 }), outcome: outcome() }, none);
    expect(idsOf(result)).not.toContain('ten-wins');
  });

  it('awards exactly at the target', () => {
    const result = evaluate({ stats: stats({ wins: 10 }), outcome: outcome() }, none);
    expect(idsOf(result)).toContain('ten-wins');
  });

  it('pays the XP for everything unlocked at once', () => {
    const result = evaluate({ stats: stats({ wins: 1 }), outcome: outcome({ won: true }) }, none);
    const expected = result.unlocked.reduce((sum, a) => sum + a.xpReward, 0);

    expect(result.xpAwarded).toBe(expected);
    expect(result.xpAwarded).toBeGreaterThan(0);
  });

  /** Nothing is more deflating than being re-awarded something you already had. */
  it('never awards the same achievement twice', () => {
    const first = evaluate({ stats: stats({ wins: 1 }), outcome: outcome({ won: true }) }, none);
    const stored = new Map(first.progress.map((p) => [p.id, p]));

    const second = evaluate({ stats: stats({ wins: 2 }), outcome: outcome({ won: true }) }, stored);

    expect(idsOf(second)).not.toContain('first-victory');
    expect(second.xpAwarded).toBe(0);
  });
});

describe('single-match feats', () => {
  /**
   * Without a word floor, a match that ended in four words on a disconnect
   * would hand out the accuracy award — the most prestigious thing on the
   * list — for essentially nothing.
   */
  it('refuses a perfect match that was too short to count', () => {
    const short = evaluate(
      { stats: stats(), outcome: outcome({ accuracyBp: 10_000, wordsTyped: 5 }) },
      none,
    );
    expect(idsOf(short)).not.toContain('flawless');

    const real = evaluate(
      { stats: stats(), outcome: outcome({ accuracyBp: 10_000, wordsTyped: 40 }) },
      none,
    );
    expect(idsOf(real)).toContain('flawless');
  });

  it('requires genuinely perfect accuracy', () => {
    const result = evaluate(
      { stats: stats(), outcome: outcome({ accuracyBp: 9_990, wordsTyped: 40 }) },
      none,
    );
    expect(idsOf(result)).not.toContain('flawless');
  });

  /**
   * Progress toward a single-match feat must never go DOWN. A 60-combo
   * followed by a 3-combo match showing reduced progress reads as the game
   * taking something away from the player.
   */
  it('keeps the best attempt rather than the latest', () => {
    const great = evaluate({ stats: stats(), outcome: outcome({ maxCombo: 60 }) }, none);
    const stored = new Map(great.progress.map((p) => [p.id, p]));

    const poor = evaluate({ stats: stats(), outcome: outcome({ maxCombo: 3 }) }, stored);
    const combo = poor.progress.find((p) => p.id === 'combo-45')!;

    expect(combo.progress).toBe(60);
  });

  it('tracks cumulative totals by their current value', () => {
    const first = evaluate({ stats: stats({ totalWords: 300 }), outcome: outcome() }, none);
    const stored = new Map(first.progress.map((p) => [p.id, p]));

    const later = evaluate({ stats: stats({ totalWords: 800 }), outcome: outcome() }, stored);

    expect(later.progress.find((p) => p.id === 'words-1000')!.progress).toBe(800);
  });
});

describe('describing for display', () => {
  it('reports every achievement, locked or not', () => {
    expect(describeAchievements(none)).toHaveLength(ACHIEVEMENTS.length);
  });

  it('reports a fraction for the progress bar', () => {
    const result = evaluate({ stats: stats({ wins: 5 }), outcome: outcome() }, none);
    const stored = new Map(result.progress.map((p) => [p.id, p]));

    const tenWins = describeAchievements(stored).find((a) => a.id === 'ten-wins')!;

    expect(tenWins.fraction).toBeCloseTo(0.5, 2);
    expect(tenWins.unlockedAt).toBeNull();
  });

  it('caps a fraction at 1 even when the metric overshoots', () => {
    const result = evaluate({ stats: stats({ wins: 250 }), outcome: outcome() }, none);
    const stored = new Map(result.progress.map((p) => [p.id, p]));

    for (const a of describeAchievements(stored)) {
      expect(a.fraction).toBeLessThanOrEqual(1);
      expect(a.progress).toBeLessThanOrEqual(a.target);
    }
  });

  it('marks unlocked achievements with a timestamp', () => {
    const result = evaluate({ stats: stats({ wins: 1 }), outcome: outcome({ won: true }) }, none);
    const stored = new Map(result.progress.map((p) => [p.id, p]));

    const first = describeAchievements(stored).find((a) => a.id === 'first-victory')!;
    expect(first.unlockedAt).toBeGreaterThan(0);
  });

  it('shows nothing earned for a brand new player', () => {
    expect(describeAchievements(none).every((a) => a.unlockedAt === null)).toBe(true);
    expect(describeAchievements(none).every((a) => a.progress === 0)).toBe(true);
  });
});
