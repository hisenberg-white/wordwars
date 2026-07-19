import { describe, expect, it } from 'vitest';
import { asPlayerId, type UserId } from '@wordwars/shared';
import { createMemoryRepositories, newUserId } from '../db/memory.js';
import type { MatchRecord, Repositories } from '../db/repositories.js';
import { boardKey, LeaderboardService } from './leaderboardService.js';

const NOW = Date.UTC(2025, 0, 15, 12, 0, 0);
const DAY = 86_400_000;

async function makeUser(repos: Repositories, username: string, countryCode: string | null = null) {
  return repos.users.create({
    id: newUserId(),
    email: `${username}@test.dev`,
    username,
    passwordHash: 'x',
    avatarUrl: null,
    countryCode,
    xp: 0,
    level: 3,
  });
}

function record(
  id: string,
  startedAt: number,
  players: Array<{ userId: UserId | null; won: boolean; combo?: number }>,
): MatchRecord {
  return {
    id,
    startedAt,
    durationMs: 60_000,
    winnerId: null,
    players: players.map((p, i) => ({
      playerId: asPlayerId(`p${id}${i}`),
      userId: p.userId,
      nickname: 'Fighter',
      isWinner: p.won,
      damageDealt: 1_000,
      wordsTyped: 40,
      wordsMissed: 1,
      accuracyBp: 9_500,
      avgWpm: 70,
      peakWpm: 95,
      maxCombo: p.combo ?? 20,
      ultimatesUsed: 1,
    })),
  };
}

describe('materialising', () => {
  it('writes a board that can then be read back', async () => {
    const repos = createMemoryRepositories();
    const winner = await makeUser(repos, 'Champion');
    const loser = await makeUser(repos, 'Runnerup');

    for (let i = 0; i < 3; i += 1) {
      await repos.matches.record(
        record(`m${i}`, NOW - 1_000, [
          { userId: winner.id, won: true },
          { userId: loser.id, won: false },
        ]),
      );
    }

    const service = new LeaderboardService(repos);
    const written = await service.rebuild(NOW);
    expect(written).toBeGreaterThan(0);

    const board = await service.read('wins', 'alltime', { kind: 'global' });
    expect(board.rows).toHaveLength(1); // The loser has zero wins, so no row.
    expect(board.rows[0]!.username).toBe('Champion');
    expect(board.rows[0]!.score).toBe(3);
    expect(board.rows[0]!.rank).toBe(1);
    expect(board.rows[0]!.level).toBe(3);
  });

  /**
   * The whole design: reading a board must not depend on the data behind it.
   * A read that hits no store at all would still "work" in a unit test, so
   * assert the STORE is what answers.
   */
  it('serves reads from the store, not from the matches', async () => {
    const repos = createMemoryRepositories();
    const user = await makeUser(repos, 'Solo');
    await repos.matches.record(record('m1', NOW - 1_000, [{ userId: user.id, won: true }]));

    const service = new LeaderboardService(repos);
    await service.rebuild(NOW);

    expect((await service.read('wins', 'alltime', { kind: 'global' })).rows).toHaveLength(1);

    // More matches land, but nothing has rebuilt — the board must not move.
    await repos.matches.record(record('m2', NOW - 500, [{ userId: user.id, won: true }]));
    expect((await service.read('wins', 'alltime', { kind: 'global' })).rows[0]!.score).toBe(1);

    await service.rebuild(NOW);
    expect((await service.read('wins', 'alltime', { kind: 'global' })).rows[0]!.score).toBe(2);
  });

  it('separates periods by when the match happened', async () => {
    const repos = createMemoryRepositories();
    const user = await makeUser(repos, 'Veteran');

    await repos.matches.record(record('old', NOW - 40 * DAY, [{ userId: user.id, won: true }]));
    await repos.matches.record(record('today', NOW - 1_000, [{ userId: user.id, won: true }]));

    const service = new LeaderboardService(repos);
    await service.rebuild(NOW);

    expect((await service.read('wins', 'daily', { kind: 'global' })).rows[0]!.score).toBe(1);
    expect((await service.read('wins', 'alltime', { kind: 'global' })).rows[0]!.score).toBe(2);
  });

  it('builds a board per country actually represented', async () => {
    const repos = createMemoryRepositories();
    const jp = await makeUser(repos, 'Kenji', 'JP');
    const br = await makeUser(repos, 'Ana', 'BR');

    await repos.matches.record(
      record('m1', NOW - 1_000, [
        { userId: jp.id, won: true },
        { userId: br.id, won: true },
      ]),
    );

    const service = new LeaderboardService(repos);
    await service.rebuild(NOW);

    const japan = await service.read('wins', 'alltime', { kind: 'country', code: 'JP' });
    expect(japan.rows.map((r) => r.username)).toEqual(['Kenji']);

    // A country nobody plays from is not built, and reads as empty rather than
    // as an error.
    const nowhere = await service.read('wins', 'alltime', { kind: 'country', code: 'ZZ' });
    expect(nowhere.rows).toEqual([]);
  });

  /**
   * A brand new server has no boards at all. That is a normal state to render,
   * not an error — and it must still carry the qualifier so the screen can
   * explain itself.
   */
  it('returns an empty board before anything has been built', async () => {
    const service = new LeaderboardService(createMemoryRepositories());
    const board = await service.read('winrate', 'weekly', { kind: 'global' });

    expect(board.rows).toEqual([]);
    expect(board.category).toBe('winrate');
    expect(board.period).toBe('weekly');
    expect(board.minMatches).toBe(10);
  });

  it('keeps guests off the board entirely', async () => {
    const repos = createMemoryRepositories();
    const user = await makeUser(repos, 'Registered');

    await repos.matches.record(
      record('m1', NOW - 1_000, [
        { userId: null, won: true },
        { userId: user.id, won: true },
      ]),
    );

    const service = new LeaderboardService(repos);
    await service.rebuild(NOW);

    const board = await service.read('wins', 'alltime', { kind: 'global' });
    expect(board.rows.map((r) => r.username)).toEqual(['Registered']);
  });

  it('names boards distinctly per category, period and scope', () => {
    const keys = new Set([
      boardKey('wins', 'daily', { kind: 'global' }),
      boardKey('wins', 'weekly', { kind: 'global' }),
      boardKey('words', 'daily', { kind: 'global' }),
      boardKey('wins', 'daily', { kind: 'country', code: 'JP' }),
    ]);

    expect(keys.size).toBe(4);
  });

  it('stops cleanly and can be stopped twice', () => {
    const service = new LeaderboardService(createMemoryRepositories());
    service.start(60_000);
    service.stop();
    expect(() => service.stop()).not.toThrow();
  });
});
