import { pino } from 'pino';
import { env } from './config/env.js';

/**
 * Structured logging.
 *
 * Pretty-printed in development, JSON in production so log aggregation can
 * index it. Child loggers carry context (socket id, match id) so a single
 * match can be traced end to end without threading a request id by hand.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.LOG_PRETTY
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
  // `null` (not `undefined`) is what strips the default pid/hostname bindings.
  base: null,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    remove: true,
  },
});

export type Logger = typeof logger;
