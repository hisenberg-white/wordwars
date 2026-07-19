import { Router } from 'express';
import { isProduction } from '../../config/env.js';
import { eventLoopStats, resetEventLoopStats } from '../../observability/eventLoop.js';
import type { RealtimeContext } from '../../realtime/context.js';
import type { GameServer } from '../../realtime/gateway.js';
import type { OnlineRegistry } from '../../realtime/onlineRegistry.js';

/**
 * Operational metrics.
 *
 * Exists so capacity is a MEASUREMENT rather than an opinion. The load test
 * (5.8) reads this; in production it feeds whatever scrapes it.
 *
 * Deliberately not on `/health`: liveness must stay cheap and dependency-free
 * so an orchestrator's probe never becomes the thing that overloads the box.
 */

export interface MetricsSources {
  readonly io: GameServer;
  readonly ctx: RealtimeContext;
  readonly online: OnlineRegistry;
}

/**
 * Holder for the gateway, filled in after it exists.
 *
 * The gateway needs the HTTP server, which needs the app, which needs the
 * gateway to report on — so the route is mounted with an empty holder and the
 * server fills it a few lines later. Mounting the router afterwards instead
 * would place it BEHIND the 404 catch-all, where it would never match.
 */
export interface MetricsHolder {
  current: MetricsSources | null;
}

export function createMetricsRouter(holder: MetricsHolder): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/', (_req, res) => {
    const sources = holder.current;
    if (!sources) {
      res.status(503).json({ error: { code: 'NOT_READY' } });
      return;
    }

    const memory = process.memoryUsage();

    res.json({
      uptimeMs: Date.now() - startedAt,

      /*
       * The load-bearing number. Every match shares this loop, so lag here is
       * lag in every live fight simultaneously — see observability/eventLoop.
       */
      eventLoop: eventLoopStats(),

      connections: {
        sockets: sources.io.engine.clientsCount,
        accounts: sources.online.size,
      },

      matches: {
        live: sources.ctx.matches.size,
        rooms: sources.ctx.rooms.size,
        queued: sources.ctx.matchmaking.size,
      },

      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      },
    });
  });

  /**
   * Resets the event-loop histogram.
   *
   * The histogram is cumulative since boot, so one stall during startup would
   * sit in the p99 forever and mask a healthy steady state. A load test resets
   * between tiers to measure each one honestly.
   *
   * Refused in production: it is a measurement tool, and letting anonymous
   * traffic erase the signal an operator is watching is not a trade worth
   * making for the convenience of not passing a flag.
   */
  router.post('/reset', (_req, res) => {
    if (isProduction) {
      res.status(403).json({ error: { code: 'FORBIDDEN' } });
      return;
    }

    resetEventLoopStats();
    res.json({ status: 'reset' });
  });

  return router;
}
