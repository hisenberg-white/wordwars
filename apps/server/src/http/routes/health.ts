import { Router } from 'express';
import { env } from '../../config/env.js';

export const healthRouter: Router = Router();

const startedAt = Date.now();

/** Liveness. Cheap, dependency-free — answers "is this process alive". */
healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    uptimeMs: Date.now() - startedAt,
    persistence: env.PERSISTENCE,
    version: process.env['npm_package_version'] ?? '0.0.0',
  });
});

/**
 * Readiness. Answers "can this process serve traffic".
 *
 * Separate from liveness on purpose: an orchestrator should restart on a failed
 * liveness probe but merely stop routing on a failed readiness probe. Once
 * Postgres and Redis exist they get checked here, never in `/health`.
 */
healthRouter.get('/ready', (_req, res) => {
  res.json({ status: 'ready', checks: { persistence: env.PERSISTENCE } });
});
