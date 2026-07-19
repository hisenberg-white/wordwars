import { createServer } from 'node:http';
import { env, isDevelopment } from './config/env.js';
import { logger } from './logger.js';
import { createApp } from './http/app.js';
import { createMemoryRepositories } from './db/memory.js';
import { createGateway } from './realtime/gateway.js';
import { LeaderboardService } from './services/leaderboardService.js';

/*
 * Persistence.
 *
 * `PERSISTENCE=none` uses the in-memory repositories — a real runtime, not a
 * stub, but everything is lost on restart. The Prisma implementation lands
 * behind the same interfaces once Postgres is available (see db/repositories).
 */
const repositories = createMemoryRepositories();

/*
 * Leaderboards are materialised on a timer, never computed per request
 * (plan §8). Started here so the boards exist before the first visitor.
 */
const leaderboards = new LeaderboardService(repositories);
leaderboards.start(env.LEADERBOARD_REBUILD_MS);

const app = createApp(repositories, leaderboards);
const httpServer = createServer(app);
const io = createGateway(httpServer, repositories);

httpServer.listen(env.PORT, env.HOST, () => {
  logger.info(
    {
      host: env.HOST,
      port: env.PORT,
      env: env.NODE_ENV,
      persistence: env.PERSISTENCE,
    },
    `WordWars server listening on http://${env.HOST}:${env.PORT}`,
  );

  if (env.PERSISTENCE === 'none') {
    logger.warn(
      'PERSISTENCE=none — running fully in memory. Everything works, including ' +
        'accounts and stats, but ALL DATA IS LOST ON RESTART. Set PERSISTENCE=full ' +
        'with Postgres for durable storage.',
    );
  }
});

/**
 * Graceful shutdown.
 *
 * Matches are in-process state (plan §1.1 D2), so an abrupt exit drops live
 * fights. We stop accepting new connections, tell existing sockets to go away
 * so they can reconnect elsewhere, then exit. The hard timeout exists because a
 * shutdown that hangs forever is worse than one that drops a few sockets.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    leaderboards.stop();
    await io.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  // An uncaught exception leaves the process in an unknown state. In
  // development we keep running so the dev loop is not interrupted; in
  // production we exit and let the orchestrator restart us clean.
  if (!isDevelopment) process.exit(1);
});
