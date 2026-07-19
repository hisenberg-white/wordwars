import type { MatchResult, PlayerId, UserId } from '@wordwars/shared';
import { logger } from '../logger.js';
import type { MatchOutcomeForStats, Repositories } from '../db/repositories.js';
import { levelForXp, xpForMatch } from '../services/progression.js';
import { evaluate } from '../services/achievements.js';

/**
 * Persists a finished match and updates progression.
 *
 * Runs AFTER `match:end` has been broadcast, never before. The results screen
 * must appear the instant the fight ends — making the players wait on a
 * database write to see who won would put storage latency in front of the
 * single most satisfying moment in the product.
 *
 * Guests are recorded too, with a null userId. Their matches are real matches:
 * they appear in history, and registering later adopts them (see 4.1).
 */
export async function recordMatchResult(
  repos: Repositories,
  result: MatchResult,
  /** playerId → userId for whoever was signed in. Guests are simply absent. */
  accounts: ReadonlyMap<PlayerId, UserId>,
  nicknames: ReadonlyMap<PlayerId, string>,
): Promise<void> {
  try {
    await repos.matches.record({
      id: result.matchId,
      startedAt: Date.now() - result.durationMs,
      durationMs: result.durationMs,
      winnerId: result.winnerId,
      players: result.fighters.map((fighter) => ({
        playerId: fighter.playerId,
        userId: accounts.get(fighter.playerId) ?? null,
        nickname: nicknames.get(fighter.playerId) ?? 'Fighter',
        isWinner: fighter.playerId === result.winnerId,
        damageDealt: fighter.damageDealt,
        wordsTyped: fighter.wordsTyped,
        wordsMissed: fighter.wordsMissed,
        accuracyBp: Math.round(fighter.accuracy * 100),
        avgWpm: fighter.avgWpm,
        peakWpm: fighter.peakWpm,
        maxCombo: fighter.maxCombo,
        ultimatesUsed: fighter.ultimatesUsed,
      })),
    });

    for (const fighter of result.fighters) {
      const userId = accounts.get(fighter.playerId);
      if (!userId) continue; // Guests have no durable stats to update.

      const outcome: MatchOutcomeForStats = {
        won: fighter.playerId === result.winnerId,
        wordsTyped: fighter.wordsTyped,
        damageDealt: fighter.damageDealt,
        maxCombo: fighter.maxCombo,
        avgWpm: fighter.avgWpm,
        peakWpm: fighter.peakWpm,
        accuracyBp: Math.round(fighter.accuracy * 100),
      };

      await repos.stats.apply(userId, outcome);

      const user = await repos.users.findById(userId);
      if (!user) continue;

      const award = xpForMatch(outcome);

      /*
       * Achievements are evaluated against stats AFTER this match, so a win
       * that takes somebody to exactly 10 wins unlocks "Contender" for the
       * match that earned it rather than the one after.
       */
      const stats = await repos.stats.find(userId);
      let achievementXp = 0;

      if (stats) {
        const existing = await repos.achievements.forUser(userId);
        const result = evaluate({ stats, outcome }, existing);

        await repos.achievements.save(userId, result.progress);
        achievementXp = result.xpAwarded;

        if (result.unlocked.length > 0) {
          logger.info(
            { userId, unlocked: result.unlocked.map((a) => a.id) },
            'Achievements unlocked',
          );
        }
      }

      const xp = user.xp + award.total + achievementXp;
      await repos.users.update(userId, { xp, level: levelForXp(xp) });
    }
  } catch (error) {
    /*
     * A failed write must never break the game.
     *
     * The match is already over and both players have their result. Losing a
     * stats row is a bad day for one player's profile; throwing here would
     * take down the room teardown path with it.
     */
    logger.error({ err: error, matchId: result.matchId }, 'Failed to record match result');
  }
}
