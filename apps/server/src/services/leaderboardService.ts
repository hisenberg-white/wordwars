import type { UserId } from '@wordwars/shared';
import { logger } from '../logger.js';
import type { Repositories, UserRecord } from '../db/repositories.js';
import {
  aggregate,
  findCategory,
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_PERIODS,
  periodStart,
  rank,
  type Leaderboard,
  type LeaderboardCategoryId,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from './leaderboard.js';

/**
 * Builds and serves materialised leaderboards.
 *
 * The split that matters: `rebuild()` does all the work on a timer, `read()`
 * does a single key lookup. A request never aggregates. That is the entire
 * design (plan §8) — a live board query gets slower exactly as the game gets
 * more popular.
 */

/** How many entries a board keeps. Nobody scrolls to 500th place. */
const BOARD_SIZE = 100;

const DEFAULT_INTERVAL_MS = 5 * 60_000;

export function boardKey(
  category: LeaderboardCategoryId,
  period: LeaderboardPeriod,
  scope: LeaderboardScope,
): string {
  return `${category}:${period}:${scope.kind === 'global' ? 'global' : `country:${scope.code}`}`;
}

export class LeaderboardService {
  private timer: NodeJS.Timeout | null = null;
  private lastRebuildAt = 0;

  constructor(private readonly repos: Repositories) {}

  /**
   * Reads a board.
   *
   * Returns an empty board rather than null when nothing has been computed
   * yet: a brand new server has no rows, and that is a normal state to render,
   * not an error to handle.
   */
  async read(
    category: LeaderboardCategoryId,
    period: LeaderboardPeriod,
    scope: LeaderboardScope,
  ): Promise<Leaderboard> {
    const stored = await this.repos.leaderboards.get(boardKey(category, period, scope));
    const definition = findCategory(category);

    if (!stored) {
      return {
        category,
        period,
        scope,
        rows: [],
        computedAt: this.lastRebuildAt,
        minMatches: definition?.minMatches ?? 1,
      };
    }

    return JSON.parse(stored.json) as Leaderboard;
  }

  /**
   * Recomputes every board.
   *
   * Country boards are derived from whoever actually appears in the data, not
   * from a hardcoded country list — a board for a country with no players is
   * noise, and the list of countries with players is not knowable in advance.
   */
  async rebuild(now = Date.now()): Promise<number> {
    const startedAt = Date.now();

    // One read of the widest window, then every narrower period is a filter
    // over the same rows. Re-querying per period would multiply the only
    // expensive step in the job by four for no benefit.
    const matches = await this.repos.matches.since(0);

    const userIds = new Set<UserId>();
    for (const match of matches) {
      for (const player of match.players) if (player.userId) userIds.add(player.userId);
    }

    const users = new Map<UserId, UserRecord>();
    for (const id of userIds) {
      const user = await this.repos.users.findById(id);
      if (user) users.set(id, user);
    }

    const countries = new Set<string>();
    for (const user of users.values()) if (user.countryCode) countries.add(user.countryCode);

    const scopes: LeaderboardScope[] = [
      { kind: 'global' },
      ...[...countries].map((code): LeaderboardScope => ({ kind: 'country', code })),
    ];

    let written = 0;

    for (const period of LEADERBOARD_PERIODS) {
      const aggregates = aggregate(matches, periodStart(period, now), now + 1);

      for (const category of LEADERBOARD_CATEGORIES) {
        for (const scope of scopes) {
          const board = rank(aggregates.values(), users, {
            category,
            period,
            scope,
            limit: BOARD_SIZE,
            computedAt: now,
          });

          await this.repos.leaderboards.put({
            key: boardKey(category.id, period, scope),
            json: JSON.stringify(board),
            computedAt: now,
          });
          written += 1;
        }
      }
    }

    this.lastRebuildAt = now;

    logger.info(
      {
        boards: written,
        matches: matches.length,
        players: users.size,
        tookMs: Date.now() - startedAt,
      },
      'Leaderboards rebuilt',
    );

    return written;
  }

  /**
   * Starts the rebuild timer.
   *
   * `unref()` so a pending rebuild never holds the process open — a server
   * asked to shut down should not linger for up to five minutes to refresh a
   * board nobody is reading.
   */
  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.timer) return;

    void this.rebuild().catch((error: unknown) => {
      logger.error({ err: error }, 'Initial leaderboard build failed');
    });

    this.timer = setInterval(() => {
      // A failed rebuild must never kill the timer, or one transient database
      // blip freezes the boards until the next deploy.
      void this.rebuild().catch((error: unknown) => {
        logger.error({ err: error }, 'Leaderboard rebuild failed');
      });
    }, intervalMs);

    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
