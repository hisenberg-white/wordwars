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
import { registerMatchHandlers } from './handlers/match.js';
import { registerMatchmakingHandlers } from './handlers/matchmaking.js';
import { registerRoomHandlers } from './handlers/room.js';
import { startCountdown } from '../rooms/countdown.js';
import { startMatchForRoom } from '../match/startMatch.js';
import { handleMatchDisconnect, handleReconnect } from '../match/presence.js';
import type { Repositories } from '../db/repositories.js';
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

/** How long the "opponent found" reveal holds before the count begins. */
const QUICK_MATCH_REVEAL_MS = 1_800;

export function createGateway(httpServer: HttpServer, repos: Repositories): GameServer {
  return createGatewayWithContext(httpServer, repos).io;
}

export function createGatewayWithContext(httpServer: HttpServer, repos: Repositories): Gateway {
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

    socketA.emit('mm:found', { roomId: room.id, opponent: b.identity });
    socketB.emit('mm:found', { roomId: room.id, opponent: a.identity });
    io.to(room.id).emit('room:state', ctx.rooms.toState(room));

    logger.info(
      { roomId: room.id, waitedMs: pairing.waitedMs, mode: pairing.mode },
      'Match paired',
    );

    /*
     * Quick match skips the lobby entirely.
     *
     * Both players already committed by pressing Play Now — asking them to
     * ready up against a stranger they cannot talk to would add a step whose
     * only possible outcome is one of them leaving. The brief delay lets the
     * "opponent found" reveal land before the count starts.
     */
    setTimeout(() => {
      if (ctx.rooms.get(room.id)) startCountdown(io, ctx.rooms, room, ctx.onMatchBegin);
    }, QUICK_MATCH_REVEAL_MS);
  };

  // The countdown-complete seam from 2.6, now filled in: this is where a room
  // becomes a live match.
  const ctx = createRealtimeContext(repos, onPaired, (room) => {
    startMatchForRoom(io, ctx, room);
  });

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
    socket.data.userId = null;

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

    // The reattach hook fires once a restored token proves this socket
    // belongs to a match already in progress.
    registerGuestHandlers(socket, (s) => handleReconnect(io, ctx, s), ctx.auth);
    registerMatchmakingHandlers(socket, ctx);
    registerRoomHandlers(socket, ctx, io);
    registerMatchHandlers(socket, ctx, io);

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
        if (rtt >= 0 && rtt < 10_000) {
          socket.data.ping = rtt;

          // Only rebroadcasts when the change is material — see setPing.
          const roomId = socket.data.roomId;
          if (roomId) {
            const room = ctx.rooms.get(asRoomId(roomId));
            if (room && ctx.rooms.setPing(room, socket.data.playerId, rtt)) {
              io.to(room.id).emit('room:state', ctx.rooms.toState(room));
            }
          }
        }

        ack({ ok: true, data: { serverTime: Date.now() } });
      }),
    );

    socket.on('disconnect', (reason) => {
      log.info({ reason }, 'Socket disconnected');

      // A queued player who closes the tab must not be paired with someone who
      // will then wait for a ghost.
      ctx.matchmaking.leave(socket.data.playerId);

      /*
       * Dropping mid-fight PAUSES the match for a grace period (plan §7.3).
       *
       * An instant forfeit punishes the wrong person about half the time: the
       * player whose train went into a tunnel did not choose to quit, and the
       * one left standing did not earn the win.
       */
      const inMatch = ctx.matches.forPlayer(socket.data.playerId) !== null;
      if (inMatch) handleMatchDisconnect(io, ctx, socket);

      const roomId = socket.data.roomId;
      // A player who dropped mid-match keeps their seat — `handleMatchDisconnect`
      // marked them absent, and removing them here would destroy the room they
      // are trying to come back to.
      if (roomId && !inMatch) {
        const room = ctx.rooms.get(asRoomId(roomId));
        if (room) {
          const remaining = ctx.rooms.removeMember(room, socket.data.playerId);
          if (remaining) {
            // Dropping out mid-count must not leave the survivor fighting a
            // ghost when the timer fires.
            if (!ctx.rooms.canStart(remaining)) ctx.rooms.abortCountdown(remaining);
            io.to(remaining.id).emit('room:state', ctx.rooms.toState(remaining));
          }
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
