import type { MatchRecord, UserRecord } from '../db/repositories.js';
import type { UserId } from '@wordwars/shared';

/**
 * Leaderboards.
 *
 * Two rules shape this file.
 *
 * **1. Never computed live.** Boards are built from match rows by a scheduled
 * job and stored (plan §8): a live `GROUP BY` over every match ever played gets
 * slower exactly as the game gets more popular, which is the worst possible
 * time for it to get slower. Everything here is a pure function from rows to a
 * ranked board — the materialiser calls it, the request path only reads what it
 * stored.
 *
 * **2. A board must be honest about what it measures.** One board ranking
 * "the best players" is a lie, because winning most and typing fastest are
 * different achievements. So there are several boards, each declaring its own
 * metric — the same declarative shape as the achievements catalogue, for the
 * same reason: one comparison, no per-board special cases.
 */

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'alltime';

export type LeaderboardCategoryId = 'wins' | 'winrate' | 'wpm' | 'combo' | 'words';

/** `global`, or one country's board. Friends boards land with friends (4.5). */
export type LeaderboardScope =
  { readonly kind: 'global' } | { readonly kind: 'country'; readonly code: string };

/** What one player did inside the period being ranked. */
export interface PlayerAggregate {
  readonly userId: UserId;
  readonly matches: number;
  readonly wins: number;
  readonly words: number;
  readonly bestCombo: number;
  readonly bestWpm: number;
  /** Sum, so the mean can be taken without keeping every match. */
  readonly totalWpm: number;
}

export interface LeaderboardCategory {
  readonly id: LeaderboardCategoryId;
  readonly name: string;
  readonly description: string;
  readonly metric: (a: PlayerAggregate) => number;
  /**
   * Matches required to appear.
   *
   * **This is the whole difference between a leaderboard and a lottery.**
   * Without a floor, the top of any average- or peak-based board is whoever
   * got one lucky match — a player with a single win sits at 100% win rate
   * above someone who won 400 of 500, forever. That board is not measuring
   * skill, it is measuring sample size, and everyone reading it can tell.
   *
   * Volume boards (wins, words) need no floor: you cannot fluke your way to
   * the top of a total.
   */
  readonly minMatches: number;
  /** How the client should render the number. */
  readonly unit: 'count' | 'percent' | 'wpm';
}

export const LEADERBOARD_CATEGORIES: readonly LeaderboardCategory[] = [
  {
    id: 'wins',
    name: 'Most Wins',
    description: 'Total victories.',
    metric: (a) => a.wins,
    minMatches: 1,
    unit: 'count',
  },
  {
    id: 'winrate',
    name: 'Win Rate',
    description: 'Share of matches won.',
    metric: (a) => (a.matches === 0 ? 0 : (a.wins / a.matches) * 100),
    // The strictest floor on the board, because win rate is the stat most
    // flattered by a small sample.
    minMatches: 10,
    unit: 'percent',
  },
  {
    id: 'wpm',
    name: 'Fastest',
    description: 'Best words per minute in a single match.',
    metric: (a) => a.bestWpm,
    minMatches: 3,
    unit: 'wpm',
  },
  {
    id: 'combo',
    name: 'Longest Combo',
    description: 'Highest combo reached in a single match.',
    metric: (a) => a.bestCombo,
    minMatches: 3,
    unit: 'count',
  },
  {
    id: 'words',
    name: 'Most Words',
    description: 'Total words landed.',
    metric: (a) => a.words,
    minMatches: 1,
    unit: 'count',
  },
];

export interface LeaderboardRow {
  readonly rank: number;
  readonly userId: UserId;
  readonly username: string;
  readonly countryCode: string | null;
  readonly level: number;
  readonly score: number;
  /** Shown beside the score so a rank is legible without a second query. */
  readonly matches: number;
}

export interface Leaderboard {
  readonly category: LeaderboardCategoryId;
  readonly period: LeaderboardPeriod;
  readonly scope: LeaderboardScope;
  readonly rows: readonly LeaderboardRow[];
  readonly computedAt: number;
  /**
   * Reported so an empty board can EXPLAIN itself.
   *
   * A blank leaderboard with no explanation reads as broken. "No one has played
   * 10 matches yet" reads as an invitation.
   */
  readonly minMatches: number;
}

/**
 * Folds match rows into per-player totals for the period.
 *
 * Guests are skipped: a leaderboard entry has to survive the session that
 * created it, and a guest identity does not. They are not second-class players
 * anywhere else in the game (their matches are recorded and claimable), but a
 * name on a permanent board needs a permanent owner.
 */
export function aggregate(
  matches: readonly MatchRecord[],
  from: number,
  to: number,
): Map<UserId, PlayerAggregate> {
  const byUser = new Map<UserId, PlayerAggregate>();

  for (const match of matches) {
    if (match.startedAt < from || match.startedAt >= to) continue;

    for (const player of match.players) {
      if (player.userId === null) continue;

      const previous = byUser.get(player.userId);
      byUser.set(player.userId, {
        userId: player.userId,
        matches: (previous?.matches ?? 0) + 1,
        wins: (previous?.wins ?? 0) + (player.isWinner ? 1 : 0),
        words: (previous?.words ?? 0) + player.wordsTyped,
        bestCombo: Math.max(previous?.bestCombo ?? 0, player.maxCombo),
        bestWpm: Math.max(previous?.bestWpm ?? 0, player.peakWpm),
        totalWpm: (previous?.totalWpm ?? 0) + player.avgWpm,
      });
    }
  }

  return byUser;
}

export interface RankOptions {
  readonly category: LeaderboardCategory;
  readonly period: LeaderboardPeriod;
  readonly scope: LeaderboardScope;
  readonly limit: number;
  readonly computedAt: number;
}

/**
 * Ranks aggregates into a board.
 *
 * Ties SHARE a rank (1, 2, 2, 4) rather than being broken arbitrarily. Two
 * players with 30 wins each are genuinely tied, and showing one of them as 3rd
 * because their id sorts later invents a distinction that does not exist. The
 * id is still used to order within a tie, so the board does not reshuffle
 * itself every time the job runs.
 */
export function rank(
  aggregates: Iterable<PlayerAggregate>,
  users: ReadonlyMap<UserId, UserRecord>,
  options: RankOptions,
): Leaderboard {
  const { category, scope } = options;

  const eligible = [...aggregates]
    .filter((a) => a.matches >= category.minMatches)
    .map((a) => ({ aggregate: a, user: users.get(a.userId), score: category.metric(a) }))
    .filter((entry): entry is { aggregate: PlayerAggregate; user: UserRecord; score: number } => {
      if (!entry.user) return false; // Deleted account: drop rather than show a ghost.
      if (entry.score <= 0) return false; // A zero is not a ranking, it is an absence.
      return scope.kind === 'global' || entry.user.countryCode === scope.code;
    })
    .sort((x, y) => y.score - x.score || x.aggregate.userId.localeCompare(y.aggregate.userId));

  const rows: LeaderboardRow[] = [];
  let lastScore = Number.NaN;
  let lastRank = 0;

  for (const [index, entry] of eligible.slice(0, options.limit).entries()) {
    // Competition ranking: a tie keeps the earlier rank, and the next distinct
    // score skips ahead by however many shared it.
    if (entry.score !== lastScore) {
      lastRank = index + 1;
      lastScore = entry.score;
    }

    rows.push({
      rank: lastRank,
      userId: entry.aggregate.userId,
      username: entry.user.username,
      countryCode: entry.user.countryCode,
      level: entry.user.level,
      score: round(entry.score, category.unit),
      matches: entry.aggregate.matches,
    });
  }

  return {
    category: category.id,
    period: options.period,
    scope,
    rows,
    computedAt: options.computedAt,
    minMatches: category.minMatches,
  };
}

/**
 * Start of the period containing `now`, in UTC.
 *
 * UTC, not local time, or the weekly board would roll over at a different
 * moment for every player and two people could see different standings from
 * the same data.
 */
export function periodStart(period: LeaderboardPeriod, now: number): number {
  if (period === 'alltime') return 0;

  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (period === 'monthly') return Date.UTC(year, month, 1);
  if (period === 'daily') return Date.UTC(year, month, day);

  // Weekly runs Monday→Sunday. getUTCDay() is 0 for Sunday, which would
  // otherwise start the week on the day most people consider its end.
  const weekday = (date.getUTCDay() + 6) % 7;
  return Date.UTC(year, month, day - weekday);
}

/** Rounds for display: whole counts, one decimal for rates. */
function round(value: number, unit: LeaderboardCategory['unit']): number {
  return unit === 'percent' ? Math.round(value * 10) / 10 : Math.round(value);
}

export function findCategory(id: string): LeaderboardCategory | undefined {
  return LEADERBOARD_CATEGORIES.find((c) => c.id === id);
}

export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = [
  'daily',
  'weekly',
  'monthly',
  'alltime',
];

export function isPeriod(value: string): value is LeaderboardPeriod {
  return (LEADERBOARD_PERIODS as readonly string[]).includes(value);
}
