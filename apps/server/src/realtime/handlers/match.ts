import { ackError, ackOk, asRoomId, matchWordSchema } from '@wordwars/shared';
import { startCountdown } from '../../rooms/countdown.js';
import type { RealtimeContext } from '../context.js';
import type { GameServer, GameSocket } from '../gateway.js';
import { validatedVoid } from '../validate.js';

export function registerMatchHandlers(
  socket: GameSocket,
  ctx: RealtimeContext,
  io: GameServer,
): void {
  /**
   * The hot path.
   *
   * Fire-and-forget: no acknowledgement, because a round trip per word would
   * add latency to the one action that must feel instantaneous. The client has
   * already played its own attack animation by prediction (plan §1.1 D1); the
   * server's reply arrives as the authoritative event batch a few ms later.
   */
  socket.on(
    'match:word',
    validatedVoid(matchWordSchema, (payload) => {
      const match = ctx.matches.forPlayer(socket.data.playerId);
      if (!match || match.isFinished) return;

      match.submitWord(socket.data.playerId, payload);
    }),
  );

  /**
   * A rematch vote.
   *
   * Mutual, not host-driven: after a close match the loser deserves an equal
   * say in whether it happens again. Votes are broadcast so each player can
   * see the other is still there and still willing — a button that gives no
   * feedback until both sides press it is a button people give up on.
   */
  socket.on('match:rematch', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const roomId = socket.data.roomId;

    if (!roomId) {
      respond(ackError('NOT_IN_MATCH', 'You are not in a room'));
      return;
    }

    const room = ctx.rooms.get(asRoomId(roomId));
    if (!room || room.phase !== 'post-match') {
      respond(ackError('ROOM_NOT_FOUND'));
      return;
    }

    const everyoneAgreed = ctx.rooms.voteRematch(room, socket.data.playerId);

    if (!everyoneAgreed) {
      // Show the vote so the other player knows someone is waiting on them.
      io.to(room.id).emit('room:state', ctx.rooms.toState(room));
      respond(ackOk(undefined));
      return;
    }

    ctx.rooms.resetForRematch(room);
    io.to(room.id).emit('room:state', ctx.rooms.toState(room));

    startCountdown(io, ctx.rooms, room, ctx.onMatchBegin);
    respond(ackOk(undefined));
  });

  socket.on('match:forfeit', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const match = ctx.matches.forPlayer(socket.data.playerId);

    if (!match || match.isFinished) {
      respond(ackError('MATCH_NOT_FOUND'));
      return;
    }

    const opponent = match.fighters.find((f) => f.playerId !== socket.data.playerId);
    match.abort('forfeit', opponent?.playerId ?? null);

    respond(ackOk(undefined));
  });

  // NOTE: `match:heartbeat` is deliberately handled in the gateway, not here.
  // Ping and clock sync must work outside a match too, and registering it in
  // both places would double-acknowledge every heartbeat.
}
