import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
  asPlayerId,
  matchHeartbeatSchema,
} from '@wordwars/shared';
import { corsOrigins } from '../config/env.js';
import { logger } from '../logger.js';
import { RateLimiter, ruleFor } from './rateLimit.js';
import { validated } from './validate.js';

export type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export function createGateway(httpServer: HttpServer): GameServer {
  const io: GameServer = new Server(httpServer, {
    // WebSocket only. Long-polling fallback degrades combat feel past the point
    // of being worth supporting (plan §7) — a player on polling would rather
    // know it failed than fight with 400ms of input lag.
    transports: ['websocket'],
    cors: {
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    },
    // Tuned for a fighting game: notice a dropped opponent fast, because the
    // reconnect-pause overlay (plan §7.3) is a better experience than a frozen
    // fight where nobody knows what happened.
    pingInterval: 10_000,
    pingTimeout: 8_000,
    maxHttpBufferSize: 16_384,
  });

  /**
   * Every socket gets an identity the moment it connects, before any handler
   * runs. Keeping `SocketData` fully populated at all times means no handler
   * has to null-check identity, and there is no window where a socket exists
   * without one.
   *
   * This is a provisional identity — real guest naming and token reclamation
   * arrive with `guest:init` in step 2.2.
   */
  io.use((socket, next) => {
    const playerId = asPlayerId(randomUUID());

    socket.data.playerId = playerId;
    socket.data.identity = {
      playerId,
      nickname: 'Challenger',
      isGuest: true,
      level: 1,
      avatarUrl: null,
      countryCode: null,
    };
    socket.data.roomId = null;
    socket.data.matchId = null;

    next();
  });

  io.on('connection', (socket) => {
    const log = logger.child({ socketId: socket.id, playerId: socket.data.playerId });
    log.info('Socket connected');

    const limiter = new RateLimiter();

    // Rate limiting is applied as a catch-all so a new event cannot be added
    // without inheriting a limit. Opting out has to be deliberate.
    socket.use(([event], next) => {
      if (limiter.consume(String(event), ruleFor(String(event)), Date.now())) {
        next();
        return;
      }
      log.warn({ event }, 'Rate limited');
      socket.emit('error', { code: 'RATE_LIMITED', detail: String(event) });
    });

    /**
     * Heartbeat / clock sync.
     *
     * The client measures round-trip time from this and displays ping. It also
     * establishes the clock offset used to align the match countdown across
     * two machines with unsynchronised clocks.
     */
    socket.on(
      'match:heartbeat',
      validated(matchHeartbeatSchema, (_payload, ack) => {
        ack({ ok: true, data: { serverTime: Date.now() } });
      }),
    );

    socket.on('disconnect', (reason) => {
      log.info({ reason }, 'Socket disconnected');
      limiter.reset();
    });
  });

  return io;
}
