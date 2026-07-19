import { ackError, ackOk, matchmakingJoinSchema } from '@wordwars/shared';
import { logger } from '../../logger.js';
import type { RealtimeContext } from '../context.js';
import type { GameServer, GameSocket } from '../gateway.js';
import { leaveCurrentRoom } from '../../rooms/leaveRoom.js';
import { validated } from '../validate.js';

/**
 * Quick-match queueing.
 *
 * The pairing itself is handled centrally in the gateway (it needs both
 * sockets, which this per-socket handler cannot reach), so these handlers only
 * manage queue membership.
 */
export function registerMatchmakingHandlers(
  socket: GameSocket,
  ctx: RealtimeContext,
  io: GameServer,
): void {
  const log = logger.child({ socketId: socket.id });

  socket.on(
    'mm:join',
    validated(matchmakingJoinSchema, (payload, ack) => {
      const { playerId } = socket.data;

      if (ctx.matchmaking.isQueued(playerId)) {
        ack(ackError('ALREADY_IN_QUEUE'));
        return;
      }

      /*
       * A live fight is the one thing Quick Match must not interrupt.
       *
       * Leaving here would abandon an opponent mid-match, which is a forfeit
       * wearing a button's clothes — if that is what the player wants, it
       * should be the forfeit button that says so.
       */
      if (ctx.matches.forPlayer(playerId) !== null) {
        ack(ackError('ROOM_IN_PROGRESS', 'Finish or forfeit your current match first.'));
        return;
      }

      /*
       * Otherwise, being in a room is not a reason to refuse — it is a reason
       * to LEAVE it. Rejecting made Quick Match a dead end for anyone who had
       * already played: a room survives into `post-match` after the fight
       * ends, so the player most likely to want another match was the one
       * guaranteed to be told no.
       *
       * Being in a room AND in the queue at once is still forbidden — that
       * would let somebody get pulled into a second match mid-lobby — which is
       * exactly why this leaves first rather than simply allowing both.
       */
      leaveCurrentRoom(socket, ctx, io);

      const queuedAt = Date.now();

      // Estimate BEFORE joining: once `join` runs the player may already be
      // paired, and quoting a wait to someone who is no longer waiting is
      // both wrong and briefly confusing on screen.
      const estimatedWaitMs = ctx.matchmaking.estimateWaitMs(payload.mode);

      ack(ackOk({ queuedAt }));
      socket.emit('mm:searching', { queuedAt, estimatedWaitMs });

      ctx.matchmaking.join({
        playerId,
        identity: socket.data.identity,
        characterId: payload.characterId,
        mode: payload.mode,
        queuedAt,
      });

      log.debug({ playerId, mode: payload.mode }, 'Joined matchmaking queue');
    }),
  );

  socket.on('mm:leave', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const left = ctx.matchmaking.leave(socket.data.playerId);

    if (left) socket.emit('mm:cancelled');
    respond(ackOk(undefined));
  });
}
