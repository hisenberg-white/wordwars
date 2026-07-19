import { describe, expect, it } from 'vitest';
import { asPlayerId, asUserId } from '@wordwars/shared';
import type { MatchRecord, UserRecord } from '../db/repositories.js';
import {
  aggregate,
  findCategory,
  LEADERBOARD_CATEGORIES,
  periodStart,
  rank,
  type PlayerAggregate,
} from './leaderboard.js';

const user = (id: string, overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: asUserId(id),
  email: `${id}@test.dev`,
  username: id,
  passwordHash: 'x',
  avatarUrl: null,
  countryCode: null,
  xp: 0,
  level: 1,
  createdAt: 0,
  lastSeenAt: 0,
  ...overrides,
});

const agg = (id: string, overrides: Partial<PlayerAggregate> = {}): PlayerAggregate => ({
  userId: asUserId(id),
  matches: 20,
  wins: 10,
  words: 500,
  bestCombo: 20,
  bestWpm: 80,
  totalWpm: 1_400,
  ...overrides,
});

const usersOf = (...records: UserRecord[]) => new Map(records.map((u) => [u.id, u]));

const match = (
  startedAt: number,
  players: Array<{
    user: string | null;
    won: boolean;
    words?: number;
    combo?: number;
    wpm?: number;
  }>,
): MatchRecord => ({
  id: `m${startedAt}`,
  startedAt,
  durationMs: 60_000,
  winnerId: null,
  players: players.map((p, i) => ({
    playerId: asPlayerId(`p${i}`),
    userId: p.user ? asUserId(p.user) : null,
    nickname: p.user ?? 'Guest',
    isWinner: p.won,
    damageDealt: 1_000,
    wordsTyped: p.words ?? 40,
    wordsMissed: 2,
    accuracyBp: 9_500,
    avgWpm: p.wpm ?? 70,
    peakWpm: p.wpm ?? 90,
    maxCombo: p.combo ?? 15,
    ultimatesUsed: 1,
  })),
});

const category = (id: string) => findCategory(id)!;

describe('the catalogue', () => {
  it('has unique ids', () => {
    expect(new Set(LEADERBOARD_CATEGORIES.map((c) => c.id)).size).toBe(
      LEADERBOARD_CATEGORIES.length,
    );
  });

  /**
   * Volume boards must NOT have a qualifier — you cannot fluke your way to the
   * top of a total, and a floor would only hide new players from a board they
   * legitimately belong on.
   */
  it('puts a floor on rate and peak boards but not on totals', () => {
    expect(category('wins').minMatches).toBe(1);
    expect(category('words').minMatches).toBe(1);
    expect(category('winrate').minMatches).toBeGreaterThan(1);
    expect(category('wpm').minMatches).toBeGreaterThan(1);
    expect(category('combo').minMatches).toBeGreaterThan(1);
  });
});

describe('aggregation', () => {
  it('folds a player’s matches into one row', () => {
    const result = aggregate(
      [
        match(100, [{ user: 'a', won: true, words: 40, combo: 20, wpm: 80 }]),
        match(200, [{ user: 'a', won: false, words: 30, combo: 35, wpm: 60 }]),
      ],
      0,
      1_000,
    );

    const a = result.get(asUserId('a'))!;
    expect(a.matches).toBe(2);
    expect(a.wins).toBe(1);
    expect(a.words).toBe(70);
    expect(a.bestCombo).toBe(35); // peak, not latest
    expect(a.bestWpm).toBe(80);
  });

  it('ignores matches outside the window', () => {
    const rows = [match(50, [{ user: 'a', won: true }]), match(500, [{ user: 'a', won: true }])];

    expect(aggregate(rows, 100, 1_000).get(asUserId('a'))!.matches).toBe(1);
  });

  /**
   * A board entry has to outlive the session that created it, and a guest
   * identity does not. Guests are first-class everywhere else in the game.
   */
  it('leaves guests off entirely', () => {
    const result = aggregate(
      [
        match(100, [
          { user: null, won: true },
          { user: 'a', won: false },
        ]),
      ],
      0,
      1_000,
    );

    expect(result.size).toBe(1);
    expect(result.has(asUserId('a'))).toBe(true);
  });
});

describe('ranking', () => {
  it('orders by the category metric, highest first', () => {
    const board = rank(
      [agg('a', { wins: 5 }), agg('b', { wins: 30 }), agg('c', { wins: 12 })],
      usersOf(user('a'), user('b'), user('c')),
      {
        category: category('wins'),
        period: 'alltime',
        scope: { kind: 'global' },
        limit: 10,
        computedAt: 0,
      },
    );

    expect(board.rows.map((r) => r.username)).toEqual(['b', 'c', 'a']);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  /**
   * THE point of the qualifier.
   *
   * Without it a player who won their only match sits at 100% above someone
   * who won 400 of 500 — permanently. That board measures sample size, not
   * skill, and every reader can tell.
   */
  it('keeps a one-match wonder off the win-rate board', () => {
    const board = rank(
      [agg('fluke', { matches: 1, wins: 1 }), agg('grinder', { matches: 500, wins: 400 })],
      usersOf(user('fluke'), user('grinder')),
      {
        category: category('winrate'),
        period: 'alltime',
        scope: { kind: 'global' },
        limit: 10,
        computedAt: 0,
      },
    );

    expect(board.rows.map((r) => r.username)).toEqual(['grinder']);
    expect(board.rows[0]!.score).toBe(80);
  });

  /** Ties are real. Inventing an order between them invents a distinction. */
  it('shares a rank between equal scores and then skips ahead', () => {
    const board = rank(
      [agg('a', { wins: 30 }), agg('b', { wins: 30 }), agg('c', { wins: 10 })],
      usersOf(user('a'), user('b'), user('c')),
      {
        category: category('wins'),
        period: 'alltime',
        scope: { kind: 'global' },
        limit: 10,
        computedAt: 0,
      },
    );

    expect(board.rows.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  /** Or the board reshuffles itself every five minutes for no reason. */
  it('orders tied players stably across rebuilds', () => {
    const build = (order: PlayerAggregate[]) =>
      rank(order, usersOf(user('a'), user('b'), user('c')), {
        category: category('wins'),
        period: 'alltime',
        scope: { kind: 'global' },
        limit: 10,
        computedAt: 0,
      }).rows.map((r) => r.username);

    const forwards = build([agg('a', { wins: 7 }), agg('b', { wins: 7 }), agg('c', { wins: 7 })]);
    const backwards = build([agg('c', { wins: 7 }), agg('b', { wins: 7 }), agg('a', { wins: 7 })]);

    expect(forwards).toEqual(backwards);
  });

  it('filters to one country when scoped', () => {
    const board = rank(
      [agg('a', { wins: 30 }), agg('b', { wins: 20 })],
      usersOf(user('a', { countryCode: 'JP' }), user('b', { countryCode: 'BR' })),
      {
        category: category('wins'),
        period: 'alltime',
        scope: { kind: 'country', code: 'JP' },
        limit: 10,
        computedAt: 0,
      },
    );

    expect(board.rows.map((r) => r.username)).toEqual(['a']);
  });

  it('drops players whose account no longer exists', () => {
    const board = rank([agg('ghost', { wins: 99 }), agg('a', { wins: 3 })], usersOf(user('a')), {
      category: category('wins'),
      period: 'alltime',
      scope: { kind: 'global' },
      limit: 10,
      computedAt: 0,
    });

    expect(board.rows.map((r) => r.username)).toEqual(['a']);
  });

  /** Zero wins is not 400th place, it is an absence from the board. */
  it('omits zero scores', () => {
    const board = rank([agg('a', { wins: 0 })], usersOf(user('a')), {
      category: category('wins'),
      period: 'alltime',
      scope: { kind: 'global' },
      limit: 10,
      computedAt: 0,
    });

    expect(board.rows).toHaveLength(0);
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => agg(`u${i}`, { wins: i + 1 }));
    const users = usersOf(...many.map((a) => user(a.userId)));

    const board = rank(many, users, {
      category: category('wins'),
      period: 'alltime',
      scope: { kind: 'global' },
      limit: 10,
      computedAt: 0,
    });

    expect(board.rows).toHaveLength(10);
    expect(board.rows[0]!.score).toBe(50);
  });

  /** So an empty board can explain itself rather than looking broken. */
  it('reports the qualifier alongside the rows', () => {
    const board = rank([], new Map(), {
      category: category('winrate'),
      period: 'weekly',
      scope: { kind: 'global' },
      limit: 10,
      computedAt: 5,
    });

    expect(board.rows).toHaveLength(0);
    expect(board.minMatches).toBe(category('winrate').minMatches);
    expect(board.computedAt).toBe(5);
  });
});

describe('period windows', () => {
  // Wednesday 15 January 2025, 12:00 UTC.
  const now = Date.UTC(2025, 0, 15, 12, 0, 0);

  it('starts the day at UTC midnight', () => {
    expect(periodStart('daily', now)).toBe(Date.UTC(2025, 0, 15));
  });

  /** Monday, not Sunday — otherwise the week starts on the day most people
   * consider its end. */
  it('starts the week on Monday', () => {
    expect(periodStart('weekly', now)).toBe(Date.UTC(2025, 0, 13));
  });

  it('starts the week on Monday even when today IS Sunday', () => {
    const sunday = Date.UTC(2025, 0, 19, 23, 0, 0);
    expect(periodStart('weekly', sunday)).toBe(Date.UTC(2025, 0, 13));
  });

  it('starts the month on the first', () => {
    expect(periodStart('monthly', now)).toBe(Date.UTC(2025, 0, 1));
  });

  it('reaches back to the beginning for all-time', () => {
    expect(periodStart('alltime', now)).toBe(0);
  });

  /** Same data must produce the same window everywhere, or two players see
   * different standings from identical rows. */
  it('does not depend on the machine’s timezone', () => {
    expect(periodStart('daily', now)).toBe(Date.UTC(2025, 0, 15));
    expect(new Date(periodStart('monthly', now)).getUTCDate()).toBe(1);
  });
});
