import { describe, expect, it } from 'vitest';
import type { MatchOutcomeForStats } from '../db/repositories.js';
import { levelForXp, levelProgress, xpForMatch, xpToReachLevel } from './progression.js';

const outcome = (overrides: Partial<MatchOutcomeForStats> = {}): MatchOutcomeForStats => ({
  won: false,
  wordsTyped: 60,
  damageDealt: 4000,
  maxCombo: 15,
  avgWpm: 75,
  peakWpm: 110,
  accuracyBp: 9_300,
  ...overrides,
});

describe('XP awards', () => {
  /**
   * The rule that matters most. A player who loses and gains nothing has been
   * told the last ninety seconds were worthless — and they will not queue
   * again. The base award is the largest single component for exactly this
   * reason.
   */
  it('pays meaningfully for a loss', () => {
    const lost = xpForMatch(outcome({ won: false }));
    const won = xpForMatch(outcome({ won: true }));

    expect(lost.total).toBeGreaterThan(0);
    expect(lost.total).toBeGreaterThan(won.total * 0.6);
  });

  it('pays more for a win', () => {
    expect(xpForMatch(outcome({ won: true })).total).toBeGreaterThan(
      xpForMatch(outcome({ won: false })).total,
    );
  });

  /**
   * Performance over outcome: a clean, high-combo loss should out-earn a
   * sloppy win, or the incentive points at farming weak opponents rather than
   * at playing well.
   */
  it('rewards a strong loss above a scrappy win', () => {
    const strongLoss = xpForMatch(outcome({ won: false, accuracyBp: 9_900, maxCombo: 40 }));
    const scrappyWin = xpForMatch(outcome({ won: true, accuracyBp: 8_000, maxCombo: 4 }));

    expect(strongLoss.total).toBeGreaterThan(scrappyWin.total);
  });

  it('pays nothing extra below the accuracy floor', () => {
    expect(xpForMatch(outcome({ accuracyBp: 8_000 })).accuracy).toBe(0);
    expect(xpForMatch(outcome({ accuracyBp: 4_000 })).accuracy).toBe(0);
  });

  it('scales the accuracy bonus toward perfection', () => {
    const good = xpForMatch(outcome({ accuracyBp: 9_000 })).accuracy;
    const perfect = xpForMatch(outcome({ accuracyBp: 10_000 })).accuracy;

    expect(perfect).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(0);
  });

  /** One freak streak must not out-earn a whole match of solid play. */
  it('caps the combo bonus', () => {
    const huge = xpForMatch(outcome({ maxCombo: 500 }));
    const large = xpForMatch(outcome({ maxCombo: 45 }));

    expect(huge.combo).toBe(large.combo);
  });

  it('breaks the award down for the results screen', () => {
    const award = xpForMatch(outcome({ won: true }));
    expect(award.base + award.win + award.accuracy + award.combo).toBe(award.total);
  });
});

describe('levels', () => {
  it('starts everyone at level 1', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-50)).toBe(1);
  });

  it('never goes backwards as XP grows', () => {
    let previous = 0;
    for (let xp = 0; xp < 60_000; xp += 250) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  /**
   * The first levels must arrive fast. A new player who sees no progress after
   * their first couple of matches has no reason to believe there is any.
   */
  it('reaches level 2 within a couple of matches', () => {
    const perMatch = xpForMatch(outcome({ won: false })).total;
    expect(levelForXp(perMatch * 2)).toBeGreaterThanOrEqual(2);
  });

  it('slows down at higher levels', () => {
    const earlyCost = xpToReachLevel(3) - xpToReachLevel(2);
    const laterCost = xpToReachLevel(20) - xpToReachLevel(19);

    expect(laterCost).toBeGreaterThan(earlyCost * 3);
  });

  it('keeps level 10 a real commitment without being unreachable', () => {
    const perMatch = xpForMatch(outcome({ won: true })).total;
    const matches = xpToReachLevel(10) / perMatch;

    expect(matches).toBeGreaterThan(20);
    expect(matches).toBeLessThan(80);
  });

  it('agrees with its own thresholds', () => {
    for (let level = 1; level <= 30; level += 1) {
      expect(levelForXp(xpToReachLevel(level))).toBe(level);
      if (level > 1) expect(levelForXp(xpToReachLevel(level) - 1)).toBe(level - 1);
    }
  });
});

describe('level progress', () => {
  it('reports a fraction through the current level', () => {
    const midway = Math.round((xpToReachLevel(3) + xpToReachLevel(4)) / 2);
    const progress = levelProgress(midway);

    expect(progress.level).toBe(3);
    expect(progress.fraction).toBeGreaterThan(0.3);
    expect(progress.fraction).toBeLessThan(0.7);
  });

  it('is empty at the start of a level and full at the end', () => {
    expect(levelProgress(xpToReachLevel(5)).fraction).toBeCloseTo(0, 2);
    expect(levelProgress(xpToReachLevel(6) - 1).fraction).toBeGreaterThan(0.98);
  });

  it('stays within [0, 1]', () => {
    for (const xp of [0, 1, 500, 5_000, 250_000]) {
      const { fraction } = levelProgress(xp);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});
