import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
  asPlayerId,
  asRoomId,
  matchHeartbeatSchema,
} from '@wordwars/shared';
import { corsOrigins } from '../config/env.js';
import { logger } from '../logger.js';
import type { Pairing } from '../matchmaking/MatchmakingService.js';
import { createRealtimeContext, type RealtimeContext } from './context.js';
import { registerGuestHandlers } from './handlers/guest.js';
import { registerMatchmakingHandlers } from './handlers/matchmaking.js';
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

export interface Gateway {
  readonly io: GameServer;
  readonly ctx: RealtimeContext;
}

export function createGateway(httpServer: HttpServer): GameServer {
  return createGatewayWithContext(httpServer).io;
}

export function createGatewayWithContext(httpServer: HttpServer): Gateway {
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
   * Completes a pairing.
   *
   * Lives here rather than in the matchmaking handler because it needs both
   * players' sockets, and a per-socket handler only ever has one of them.
   */
  const onPaired = (pairing: Pairing): void => {
    const [a, b] = pairing.players;

    const socketA = findSocket(io, a.playerId);
    const socketB = findSocket(io, b.playerId);

    // Either player may have closed the tab between queueing and pairing.
    // Whoever is still here goes back to the front of the queue rather than
    // being dropped into a room with a ghost.
    if (!socketA || !socketB) {
      const survivor = socketA ?? socketB;
      const survivorEntry = socketA ? a : b;

      if (survivor) {
        ctx.matchmaking.join({ ...survivorEntry, queuedAt: Date.now() });
        logger.debug({ playerId: survivorEntry.playerId }, 'Requeued after opponent vanished');
      }
      return;
    }

    const room = ctx.rooms.create({
      isQuickMatch: true,
      settings: { mode: pairing.mode, isPublic: true },
    });

    for (const [socket, entry] of [
      [socketA, a],
      [socketB, b],
    ] as const) {
      ctx.rooms.addMember(room, entry.identity, entry.characterId);
      socket.data.roomId = room.id;
      void socket.join(room.id);
    }

    const state = ctx.rooms.toState(room);

    socketA.emit('mm:found', { roomId: room.id, opponent: b.identity });
    socketB.emit('mm:found', { roomId: room.id, opponent: a.identity });
    io.to(room.id).emit('room:state', state);

    logger.info(
      { roomId: room.id, waitedMs: pairing.waitedMs, mode: pairing.mode },
      'Match paired',
    );
  };

  const ctx = createRealtimeContext(onPaired);

  /**
   * This identity is provisional. `guest:init` replaces it with a real
   * generated or restored name, but a socket is never without one — which is
   * why no handler has to null-check identity.
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
    socket.data.ping = null;

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

    registerGuestHandlers(socket);
    registerMatchmakingHandlers(socket, ctx);

    /**
     * Heartbeat / clock sync.
     *
     * The client measures round-trip time from this and displays ping. It also
     * establishes the clock offset used to align the match countdown across
     * two machines with unsynchronised clocks.
     */
    socket.on(
      'match:heartbeat',
      validated(matchHeartbeatSchema, (payload, ack) => {
        // The client's own send time comes back to us, letting the server
        // record a ping for the lobby without a second round trip.
        const rtt = Date.now() - payload.clientTime;
        if (rtt >= 0 && rtt < 10_000) socket.data.ping = rtt;

        ack({ ok: true, data: { serverTime: Date.now() } });
      }),
    );

    socket.on('disconnect', (reason) => {
      log.info({ reason }, 'Socket disconnected');

      // A queued player who closes the tab must not be paired with someone who
      // will then wait for a ghost.
      ctx.matchmaking.leave(socket.data.playerId);

      const roomId = socket.data.roomId;
      if (roomId) {
        const room = ctx.rooms.get(asRoomId(roomId));
        if (room) {
          const remaining = ctx.rooms.removeMember(room, socket.data.playerId);
          if (remaining) io.to(remaining.id).emit('room:state', ctx.rooms.toState(remaining));
        }
      }

      limiter.reset();
    });
  });

  return { io, ctx };
}

/** Finds a connected socket by player id. */
function findSocket(io: GameServer, playerId: string): GameSocket | null {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.playerId === playerId) return socket;
  }
  return null;
}
