import { randomUUID } from 'node:crypto';
import {
  ackError,
  ackOk,
  asPlayerId,
  asRoomCode,
  asRoomId,
  roomChatSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomKickSchema,
  roomReadySchema,
  roomSelectCharacterSchema,
  roomUpdateSchema,
  type ChatMessage,
  type CharacterId,
  type RoomState,
} from '@wordwars/shared';
import { logger } from '../../logger.js';
import { hashPassword, verifyPassword } from '../../services/password.js';
import type { LiveRoom } from '../../rooms/RoomRegistry.js';
import { startCountdown } from '../../rooms/countdown.js';
import { leaveCurrentRoom as leaveRoom } from '../../rooms/leaveRoom.js';
import { systemMessage } from '../../rooms/systemMessage.js';
import type { RealtimeContext } from '../context.js';
import type { GameServer, GameSocket } from '../gateway.js';
import { validated } from '../validate.js';

/** Character defaults until the lobby's picker exists (2.5). */
const DEFAULT_CHARACTER: CharacterId = 'ninja';

export function registerRoomHandlers(
  socket: GameSocket,
  ctx: RealtimeContext,
  io: GameServer,
): void {
  const log = logger.child({ socketId: socket.id });

  const broadcast = (room: LiveRoom): RoomState => {
    const state = ctx.rooms.toState(room);
    io.to(room.id).emit('room:state', state);
    return state;
  };

  /** Shared with matchmaking, so the two cannot drift. See rooms/leaveRoom. */
  const leaveCurrentRoom = (): void => leaveRoom(socket, ctx, io);

  socket.on(
    'room:create',
    validated(roomCreateSchema, async (payload, ack) => {
      ctx.matchmaking.leave(socket.data.playerId);
      leaveCurrentRoom();

      const passwordHash = payload.password ? await hashPassword(payload.password) : null;

      const room = ctx.rooms.create({
        settings: payload.settings,
        passwordHash,
      });

      ctx.rooms.addMember(room, socket.data.identity, DEFAULT_CHARACTER);
      socket.data.roomId = room.id;
      void socket.join(room.id);

      log.info({ roomId: room.id, code: room.code }, 'Room created');
      ack(ackOk(ctx.rooms.toState(room)));
    }),
  );

  socket.on(
    'room:join',
    validated(roomJoinSchema, async (payload, ack) => {
      const room = ctx.rooms.getByCode(asRoomCode(payload.code));

      if (!room) {
        ack(ackError('ROOM_NOT_FOUND'));
        return;
      }

      if (room.phase === 'in-match' && !payload.asSpectator) {
        ack(ackError('ROOM_IN_PROGRESS'));
        return;
      }

      // Password is checked BEFORE the player is detached from their current
      // room — a wrong guess must not cost them the room they were already in.
      if (room.passwordHash) {
        const ok = payload.password
          ? await verifyPassword(payload.password, room.passwordHash)
          : false;

        if (!ok) {
          ack(ackError('WRONG_PASSWORD'));
          return;
        }
      }

      const wantsSpectator = payload.asSpectator === true;

      if (wantsSpectator && !room.settings.allowSpectators) {
        ack(ackError('ROOM_FULL', 'Spectators are not allowed in this room'));
        return;
      }

      if (!wantsSpectator) {
        const players = [...room.members.values()].filter((m) => !m.isSpectator).length;
        if (players >= room.settings.maxPlayers) {
          ack(ackError('ROOM_FULL'));
          return;
        }
      }

      // Rejoining the room you are already in is a no-op, not an error — a
      // refresh on an invite link lands here.
      if (socket.data.roomId === room.id) {
        ack(ackOk(ctx.rooms.toState(room)));
        return;
      }

      ctx.matchmaking.leave(socket.data.playerId);
      leaveCurrentRoom();

      ctx.rooms.addMember(room, socket.data.identity, DEFAULT_CHARACTER, wantsSpectator);
      socket.data.roomId = room.id;
      void socket.join(room.id);

      const state = broadcast(room);
      systemMessage(
        io,
        room,
        `${socket.data.identity.nickname} joined${wantsSpectator ? ' as a spectator' : ''}`,
      );

      log.info({ roomId: room.id, spectator: wantsSpectator }, 'Room joined');
      ack(ackOk(state));
    }),
  );

  socket.on('room:leave', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const room = currentRoom();

    if (room) {
      systemMessage(io, room, `${socket.data.identity.nickname} left`);
    }

    leaveCurrentRoom();
    respond(ackOk(undefined));
  });

  // ---- Lobby ------------------------------------------------------------

  const currentRoom = (): LiveRoom | null => {
    const roomId = socket.data.roomId;
    return roomId ? ctx.rooms.get(asRoomId(roomId)) : null;
  };

  socket.on(
    'room:character',
    validated(roomSelectCharacterSchema, (payload, ack) => {
      const room = currentRoom();
      if (!room) {
        ack(ackError('NOT_IN_MATCH', 'You are not in a room'));
        return;
      }

      if (room.phase !== 'lobby') {
        ack(ackError('ROOM_IN_PROGRESS'));
        return;
      }

      const changed = ctx.rooms.setCharacter(room, socket.data.playerId, payload.characterId);
      ack(ackOk(changed ? broadcast(room) : ctx.rooms.toState(room)));
    }),
  );

  socket.on(
    'room:ready',
    validated(roomReadySchema, (payload, ack) => {
      const room = currentRoom();
      if (!room) {
        ack(ackError('NOT_IN_MATCH', 'You are not in a room'));
        return;
      }

      const changed = ctx.rooms.setReady(room, socket.data.playerId, payload.ready);

      // Un-readying during the count is a legitimate "wait, no" and must stop
      // the fight rather than being ignored because a timer is running.
      if (!payload.ready && ctx.rooms.abortCountdown(room)) {
        systemMessage(
          io,
          room,
          `${socket.data.identity.nickname} is not ready — countdown stopped`,
        );
      }

      ack(ackOk(changed ? broadcast(room) : ctx.rooms.toState(room)));
    }),
  );

  socket.on(
    'room:chat',
    validated(roomChatSchema, (payload, ack) => {
      const room = currentRoom();
      if (!room) {
        ack(ackError('NOT_IN_MATCH', 'You are not in a room'));
        return;
      }

      const message: ChatMessage = {
        id: randomUUID(),
        playerId: socket.data.playerId,
        nickname: socket.data.identity.nickname,
        // Trimmed and length-capped by the schema. Never rendered as HTML on
        // the client, so no sanitisation is needed here — and doing it here
        // would silently mangle legitimate messages containing < or &.
        text: payload.text,
        at: Date.now(),
        system: false,
      };

      io.to(room.id).emit('room:chat', message);
      ack(ackOk(undefined));
    }),
  );

  socket.on(
    'room:update',
    validated(roomUpdateSchema, async (payload, ack) => {
      const room = currentRoom();
      if (!room) {
        ack(ackError('NOT_IN_MATCH', 'You are not in a room'));
        return;
      }

      if (room.hostId !== socket.data.playerId) {
        ack(ackError('NOT_HOST'));
        return;
      }

      if (room.phase !== 'lobby') {
        ack(ackError('ROOM_IN_PROGRESS'));
        return;
      }

      // `definedOnly` is not ceremony: a plain spread would let a key present
      // with an `undefined` value overwrite a real setting with nothing,
      // silently blanking the arena or round count. Only keys the host
      // actually sent should apply.
      room.settings = { ...room.settings, ...definedOnly(payload.settings) };

      if (payload.password !== undefined) {
        room.passwordHash = payload.password ? await hashPassword(payload.password) : null;
      }

      /*
       * Changing the rules un-readies everyone.
       *
       * A player readied up for a best-of-three with Ultimates on. If the host
       * can flip that to best-of-five with Ultimates off and start immediately,
       * "ready" stopped meaning anything. Fighting games make you re-confirm
       * for exactly this reason.
       */
      for (const member of room.members.values()) member.isReady = false;

      systemMessage(io, room, 'Host changed the room settings');
      ack(ackOk(broadcast(room)));
    }),
  );

  socket.on('room:start', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const room = currentRoom();

    if (!room) {
      respond(ackError('NOT_IN_MATCH', 'You are not in a room'));
      return;
    }

    if (room.hostId !== socket.data.playerId) {
      respond(ackError('NOT_HOST'));
      return;
    }

    if (room.phase !== 'lobby') {
      respond(ackError('ROOM_IN_PROGRESS'));
      return;
    }

    const players = [...room.members.values()].filter((m) => !m.isSpectator);
    if (players.length < 2) {
      respond(ackError('NOT_ENOUGH_PLAYERS'));
      return;
    }

    if (!ctx.rooms.canStart(room)) {
      respond(ackError('PLAYERS_NOT_READY'));
      return;
    }

    startCountdown(io, ctx.rooms, room, ctx.onMatchBegin);
    respond(ackOk(undefined));
  });

  socket.on(
    'room:kick',
    validated(roomKickSchema, (payload, ack) => {
      const room = currentRoom();
      if (!room) {
        ack(ackError('NOT_IN_MATCH', 'You are not in a room'));
        return;
      }

      if (room.hostId !== socket.data.playerId) {
        ack(ackError('NOT_HOST'));
        return;
      }

      const targetId = asPlayerId(payload.playerId);
      const target = room.members.get(targetId);
      if (!target) {
        ack(ackOk(ctx.rooms.toState(room)));
        return;
      }

      // Tell the kicked player's socket first, then detach it — otherwise it
      // is no longer in the socket.io room to receive the notice.
      const targetSocket = findSocketByPlayer(io, targetId);
      targetSocket?.emit('room:closed', { reason: 'You were removed from the room' });
      if (targetSocket) {
        targetSocket.data.roomId = null;
        void targetSocket.leave(room.id);
      }

      const remaining = ctx.rooms.removeMember(room, targetId);
      if (!remaining) {
        ack(ackError('ROOM_NOT_FOUND'));
        return;
      }

      systemMessage(io, remaining, `${target.identity.nickname} was removed`);
      ack(ackOk(broadcast(remaining)));
    }),
  );
}

/**
 * Every key optional, and `undefined` removed from every value type.
 *
 * `Partial<T>` is not enough: under `exactOptionalPropertyTypes` its values
 * still include `| undefined`, so spreading one over a fully-populated object
 * widens each field to possibly-undefined. This mapped type expresses what
 * `definedOnly` actually guarantees at runtime.
 */
type DefinedPartial<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drops keys whose value is `undefined`, so a patch cannot blank a setting. */
function definedOnly<T extends object>(patch: T): DefinedPartial<T> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) result[key] = value;
  }

  return result as DefinedPartial<T>;
}

function findSocketByPlayer(io: GameServer, playerId: string): GameSocket | null {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.playerId === playerId) return socket;
  }
  return null;
}
