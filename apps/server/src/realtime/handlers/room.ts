import {
  ackError,
  ackOk,
  asRoomCode,
  asRoomId,
  roomCreateSchema,
  roomJoinSchema,
  type CharacterId,
  type RoomState,
} from '@wordwars/shared';
import { logger } from '../../logger.js';
import { hashPassword, verifyPassword } from '../../services/password.js';
import type { LiveRoom } from '../../rooms/RoomRegistry.js';
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

  /**
   * Detaches the player from whatever room they are in.
   *
   * Called before any join. Clicking a friend's invite link while sitting in
   * another room should move you, not fail — a dead-end error there would be
   * technically defensible and genuinely annoying.
   */
  const leaveCurrentRoom = (): void => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = ctx.rooms.get(asRoomId(roomId));
    socket.data.roomId = null;
    void socket.leave(roomId);

    if (!room) return;

    const remaining = ctx.rooms.removeMember(room, socket.data.playerId);
    if (remaining) broadcast(remaining);
  };

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
      log.info({ roomId: room.id, spectator: wantsSpectator }, 'Room joined');
      ack(ackOk(state));
    }),
  );

  socket.on('room:leave', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    leaveCurrentRoom();
    respond(ackOk(undefined));
  });
}
