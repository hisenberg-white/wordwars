import { describe, expect, it } from 'vitest';
import { BOT_PROFILES, findProfile, isBotId, newBotId } from './BotPlayer.js';

/**
 * The computer opponent.
 *
 * Exists because the honest state of a new game is that nobody else is online.
 */

describe('the ladder', () => {
  it('has unique ids and rises in difficulty', () => {
    expect(new Set(BOT_PROFILES.map((p) => p.id)).size).toBe(BOT_PROFILES.length);

    for (let i = 1; i < BOT_PROFILES.length; i += 1) {
      expect(BOT_PROFILES[i]!.wpm).toBeGreaterThan(BOT_PROFILES[i - 1]!.wpm);
      expect(BOT_PROFILES[i]!.accuracy).toBeGreaterThanOrEqual(BOT_PROFILES[i - 1]!.accuracy);
    }
  });

  /**
   * A bot that cannot be beaten teaches nothing. The top rung is demanding and
   * still under what a strong human reaches.
   */
  it('tops out below the human ceiling', () => {
    const hardest = BOT_PROFILES[BOT_PROFILES.length - 1]!;
    expect(hardest.wpm).toBeLessThan(140);
    expect(hardest.accuracy).toBeLessThan(1);
  });

  /** The player most in need of practice is the one a fast bot would bury. */
  it('starts genuinely slow', () => {
    expect(BOT_PROFILES[0]!.wpm).toBeLessThan(45);
  });

  /**
   * Every bot misses sometimes. A flawless opponent would teach the wrong
   * lesson about why accuracy is the mechanic that matters.
   */
  it('never makes a bot perfect', () => {
    for (const profile of BOT_PROFILES) {
      expect(profile.accuracy).toBeLessThan(1);
      expect(profile.accuracy).toBeGreaterThan(0.5);
    }
  });

  it('resolves by id and rejects anything else', () => {
    expect(findProfile('rookie')?.wpm).toBe(BOT_PROFILES[0]!.wpm);
    expect(findProfile('nonsense')).toBeUndefined();
  });
});

describe('bot identity', () => {
  /**
   * The marker is load-bearing: it is what keeps a practice result out of the
   * stats pipeline, so a player cannot farm a machine onto the leaderboards.
   */
  it('marks bot ids so they can never be mistaken for a person', () => {
    const id = newBotId();

    expect(isBotId(id)).toBe(true);
    expect(isBotId('a-normal-player-id')).toBe(false);
    expect(isBotId('')).toBe(false);
  });

  it('issues a distinct id per bot', () => {
    const ids = new Set(Array.from({ length: 50 }, () => String(newBotId())));
    expect(ids.size).toBe(50);
  });
});
