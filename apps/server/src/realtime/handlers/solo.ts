import { ackError, ackOk, soloStartSchema, type CharacterId } from '@wordwars/shared';
import { logger } from '../../logger.js';
import { findProfile, newBotId } from '../../match/BotPlayer.js';
import { leaveCurrentRoom } from '../../rooms/leaveRoom.js';
import { startCountdown } from '../../rooms/countdown.js';
import type { RealtimeContext } from '../context.js';
import type { GameServer, GameSocket } from '../gateway.js';
import { validated } from '../validate.js';

/**
 * Practice against the computer.
 *
 * Builds an ordinary private room with an ordinary countdown and an ordinary
 * match — the only unusual thing in it is that one of the two seats is filled
 * by the server. Everything downstream (the arena, the HUD, prediction, the
 * results screen) is the code path a human match already uses, which is the
 * point: a practice mode with its own bespoke pipeline would drift from the
 * real game and quietly stop measuring the same thing.
 */
export function registerSoloHandlers(
  socket: GameSocket,
  ctx: RealtimeContext,
  io: GameServer,
): void {
  const log = logger.child({ socketId: socket.id });

  socket.on(
    'solo:start',
    validated(soloStartSchema, (payload, ack) => {
      const profile = findProfile(payload.difficulty);
      if (!profile) {
        ack(ackError('INVALID_PAYLOAD', 'Unknown difficulty.'));
        return;
      }

      // Practice never interrupts a real fight against a person.
      const liveMatch = ctx.matches.forPlayer(socket.data.playerId);
      if (liveMatch && !liveMatch.isFinished) {
        ack(ackError('ROOM_IN_PROGRESS', 'Finish your current match first.'));
        return;
      }

      ctx.matchmaking.leave(socket.data.playerId);
      leaveCurrentRoom(socket, ctx, io);

      const room = ctx.rooms.create({ settings: { isPublic: false } });
      const botId = newBotId();

      ctx.rooms.addMember(room, socket.data.identity, payload.characterId as CharacterId);

      /*
       * The bot joins as a normal member, marked a guest and named for its
       * difficulty.
       *
       * Naming it honestly matters: a player should never be unsure whether
       * they just lost to a person. The id is prefixed `bot:` as well, which is
       * what stops the result reaching the stats pipeline.
       */
      ctx.rooms.addMember(
        room,
        {
          playerId: botId,
          nickname: profile.name,
          isGuest: true,
          level: 1,
          avatarUrl: null,
          countryCode: null,
        },
        'samurai' as CharacterId,
      );

      room.bot = { playerId: botId, difficulty: profile.id };

      socket.data.roomId = room.id;
      void socket.join(room.id);

      // Same countdown as a quick match, so the fight opens the way every other
      // fight does rather than starting under the player's fingers.
      io.to(room.id).emit('room:state', ctx.rooms.toState(room));
      startCountdown(io, ctx.rooms, room, ctx.onMatchBegin);

      log.info({ roomId: room.id, difficulty: profile.id }, 'Practice match started');
      ack(ackOk({ roomId: room.id }));
    }),
  );
}
