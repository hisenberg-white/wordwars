import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { corsOrigins, isProduction } from '../config/env.js';
import { logger } from '../logger.js';
import { healthRouter } from './routes/health.js';
import { createAuthRouter } from './routes/auth.js';
import { createProfileRouter } from './routes/profile.js';
import { createLeaderboardRouter } from './routes/leaderboard.js';
import { createFriendsRouter } from './routes/friends.js';
import { OFFLINE_PRESENCE, type PresenceLookup } from '../services/friends.js';
import { LeaderboardService } from '../services/leaderboardService.js';
import type { Repositories } from '../db/repositories.js';

/**
 * The REST surface.
 *
 * Deliberately thin. Gameplay lives entirely on the socket layer; HTTP exists
 * for health checks, and later for auth, profiles, leaderboards and admin —
 * things that are request/response shaped and cacheable.
 */
export function createApp(
  repos: Repositories,
  /*
   * Defaulted so tests and scripts can build an app with one argument, while
   * the real server passes the instance it also starts and stops. An app that
   * silently owned an unstarted timer would serve permanently empty boards.
   */
  leaderboards: LeaderboardService = new LeaderboardService(repos),
  /*
   * The SAME registry the socket gateway writes to, so the friends list and the
   * challenge button never disagree about who is online. Defaults to
   * always-offline for tests that build an app without a gateway.
   */
  presence: PresenceLookup = OFFLINE_PRESENCE,
): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The game canvas and the API are served from different origins in dev;
      // CORP would otherwise block asset loads.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // CSP is left at helmet's default in production and disabled in dev,
      // where Vite's HMR needs inline scripts. Spread rather than passing
      // `undefined`, so the key is absent instead of explicitly unset.
      ...(isProduction ? {} : { contentSecurityPolicy: false as const }),
    }),
  );

  app.use(
    cors({
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '64kb' }));

  app.use('/health', healthRouter);
  app.use('/api/auth', createAuthRouter(repos));
  app.use('/api/profile', createProfileRouter(repos));
  app.use('/api/leaderboard', createLeaderboardRouter(leaderboards, repos));
  app.use('/api/friends', createFriendsRouter(repos, presence));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND' } });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled HTTP error');
    res.status(500).json({ error: { code: 'INTERNAL' } });
  });

  return app;
}
