import { Router } from 'express';
import { z } from 'zod';
import {
  LEADERBOARD_CATEGORIES,
  findCategory,
  isPeriod,
  type LeaderboardScope,
} from '../../services/leaderboard.js';
import type { LeaderboardService } from '../../services/leaderboardService.js';

/**
 * Public leaderboards.
 *
 * No auth: standings are the game's shop window. Requiring an account to see
 * who is winning would hide the single most persuasive argument for making one.
 *
 * Every handler here is a lookup of an already-computed board — see
 * `LeaderboardService`. Nothing on this path aggregates.
 */

const querySchema = z.object({
  category: z.string().max(32).optional(),
  period: z.string().max(16).optional(),
  // ISO 3166-1 alpha-2. Bounded and pattern-checked so the scope key cannot be
  // used to write unbounded junk into the board cache namespace.
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .optional(),
});

export function createLeaderboardRouter(leaderboards: LeaderboardService): Router {
  const router = Router();

  /** The catalogue, so the client renders tabs without hardcoding them. */
  router.get('/categories', (_req, res) => {
    res.json({
      categories: LEADERBOARD_CATEGORIES.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        minMatches: c.minMatches,
        unit: c.unit,
      })),
    });
  });

  router.get('/', (req, res) => {
    void (async () => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY' } });
        return;
      }

      const category = findCategory(parsed.data.category ?? 'wins');
      const period = parsed.data.period ?? 'alltime';

      if (!category || !isPeriod(period)) {
        res.status(404).json({ error: { code: 'NO_SUCH_BOARD' } });
        return;
      }

      const scope: LeaderboardScope = parsed.data.country
        ? { kind: 'country', code: parsed.data.country.toUpperCase() }
        : { kind: 'global' };

      const board = await leaderboards.read(category.id, period, scope);

      // Boards change on a timer, so a short shared cache costs nothing and
      // absorbs the traffic spike when a match ends and everyone checks.
      res.set('Cache-Control', 'public, max-age=30');
      res.json(board);
    })();
  });

  return router;
}
