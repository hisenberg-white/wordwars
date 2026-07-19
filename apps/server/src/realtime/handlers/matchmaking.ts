import { ackError, ackOk, asRoomId, matchmakingJoinSchema } from '@wordwars/shared';
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
       * Asking to queue while in a live match forfeits it.
       *
       * This looks harsh and is the opposite of what I first wrote, which
       * refused with ROOM_IN_PROGRESS to avoid abandoning an opponent. That
       * refusal turned out to be how a player becomes PERMANENTLY unable to
       * play: a guest's id survives reloads, so a match left stranded by any
       * bug answers for them forever and every Play click is refused, with no
       * way out short of restarting the server. A wall with no door is worse
       * than a forfeit.
       *
       * It is also not really silent. A player inside a live match is looking
       * at the arena, not at Play Now — reaching this line means they left the
       * fight already. Forfeiting hands the opponent the win they are owed
       * instead of leaving them in a match against nobody.
       */
      const liveMatch = ctx.matches.forPlayer(playerId);

      if (liveMatch && !liveMatch.isFinished) {
        const opponent = liveMatch.fighters.find((f) => f.playerId !== playerId);
        liveMatch.abort('forfeit', opponent?.playerId ?? null);
        log.info({ playerId, matchId: liveMatch.matchId }, 'Left a live match to requeue');
      }

      const current = socket.data.roomId ? ctx.rooms.get(asRoomId(socket.data.roomId)) : null;

      /*
       * A pairing already underway is NOT abandoned.
       *
       * A client can emit this more than once — a re-render, a reconnect, an
       * impatient second click — and for the brief window between "opponent
       * found" and the countdown, obeying the second one is catastrophic: it
       * pulls the player out of the room they were just matched into, leaving
       * their opponent alone in a fight against nobody while they go back to
       * searching. Both players lose the match they had, and neither is told
       * why.
       *
       * So a request to queue while a viable pairing is pending is treated as
       * the duplicate it almost certainly is: acknowledged, and ignored.
       *
       * Scoped to quick-match rooms that have not started yet. A room the
       * player chose to sit in, or one left over from a finished match, is
       * still theirs to leave — that was the original ALREADY_IN_ROOM dead end
       * and it must stay fixed.
       */
      const pairingPending =
        current !== null &&
        current.isQuickMatch &&
        (current.phase === 'lobby' || current.phase === 'countdown') &&
        ctx.rooms.hasOpponent(current);

      if (pairingPending && current) {
        ack(ackOk({ queuedAt: Date.now() }));
        socket.emit('room:state', ctx.rooms.toState(current));
        return;
      }

      /*
       * Otherwise, being in a room is not a reason to refuse — it is a reason
       * to LEAVE it. Rejecting made Quick Match a dead end for anyone who had
       * already played: a room survives into `post-match` after the fight
       * ends, so the player most likely to want another match was the one
       * guaranteed to be told no.
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
