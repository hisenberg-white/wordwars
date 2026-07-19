import { Router } from 'express';
import { z } from 'zod';
import { asUserId } from '@wordwars/shared';
import { AuthService, toPublic } from '../../services/auth.js';
import { levelProgress } from '../../services/progression.js';
import { describe as describeAchievements } from '../../services/achievements.js';
import type { Repositories } from '../../db/repositories.js';

const HISTORY_LIMIT = 20;

/**
 * Profile and match history.
 *
 * A profile is ONE row read plus a bounded history query — the stats are
 * denormalised precisely so this never becomes an aggregate over every match a
 * player has ever fought (plan §1.6). That query gets slower exactly as the
 * game gets more popular.
 */
const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export function createProfileRouter(repos: Repositories): Router {
  const router = Router();
  const auth = new AuthService(repos);

  router.get('/me', (req, res) => {
    void (async () => {
      const token = bearer(req.headers.authorization);
      const user = token ? await auth.authenticate(token) : null;

      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
      }

      const [stats, history, achievements] = await Promise.all([
        repos.stats.find(user.id),
        repos.matches.recentForUser(user.id, HISTORY_LIMIT),
        repos.achievements.forUser(user.id),
      ]);

      res.json({
        user: toPublic(user),
        progress: levelProgress(user.xp),
        stats,
        achievements: describeAchievements(achievements),
        history: history.map((match) => ({
          id: match.id,
          startedAt: match.startedAt,
          durationMs: match.durationMs,
          // Only this player's line — the opponent's stats are theirs to show.
          self: match.players.find((p) => p.userId === user.id) ?? null,
          opponent: match.players.find((p) => p.userId !== user.id) ?? null,
        })),
      });
    })();
  });

  /**
   * Paged match history.
   *
   * Separate from `/me`, which returns only the most recent few. A profile
   * should load fast; someone deliberately scrolling their whole history is a
   * different intent and can afford a second request.
   */
  router.get('/history', (req, res) => {
    void (async () => {
      const token = bearer(req.headers.authorization);
      const user = token ? await auth.authenticate(token) : null;

      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
      }

      const parsed = historySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY' } });
        return;
      }

      const { limit, offset } = parsed.data;
      const [matches, total] = await Promise.all([
        repos.matches.recentForUser(user.id, limit, offset),
        repos.matches.countForUser(user.id),
      ]);

      res.json({
        total,
        limit,
        offset,
        matches: matches.map((match) => ({
          id: match.id,
          startedAt: match.startedAt,
          durationMs: match.durationMs,
          self: match.players.find((p) => p.userId === user.id) ?? null,
          opponent: match.players.find((p) => p.userId !== user.id) ?? null,
        })),
      });
    })();
  });

  return router;
}

function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export { asUserId };
