import { ackError, ackOk, matchmakingJoinSchema } from '@wordwars/shared';
import { logger } from '../../logger.js';
import type { RealtimeContext } from '../context.js';
import type { GameSocket } from '../gateway.js';
import { validated } from '../validate.js';

/**
 * Quick-match queueing.
 *
 * The pairing itself is handled centrally in the gateway (it needs both
 * sockets, which this per-socket handler cannot reach), so these handlers only
 * manage queue membership.
 */
export function registerMatchmakingHandlers(socket: GameSocket, ctx: RealtimeContext): void {
  const log = logger.child({ socketId: socket.id });

  socket.on(
    'mm:join',
    validated(matchmakingJoinSchema, (payload, ack) => {
      const { playerId } = socket.data;

      if (ctx.matchmaking.isQueued(playerId)) {
        ack(ackError('ALREADY_IN_QUEUE'));
        return;
      }

      // Being in a room and in the queue at once would let a player get pulled
      // into a second match mid-lobby.
      if (socket.data.roomId !== null) {
        ack(ackError('ALREADY_IN_ROOM'));
        return;
      }

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
