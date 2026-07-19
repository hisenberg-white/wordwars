import { asRoomId, type PlayerId } from '@wordwars/shared';
import { logger } from '../logger.js';
import type { RealtimeContext } from '../realtime/context.js';
import type { GameServer, GameSocket } from '../realtime/gateway.js';

/**
 * How long a dropped player has to come back (plan §7.3).
 *
 * Twenty seconds is enough to survive a WiFi hiccup, a laptop lid, or a phone
 * switching to mobile data — the realistic causes of a mid-match drop. It is
 * also short enough that the surviving player does not feel abandoned: past
 * about half a minute, waiting stops feeling like suspense and starts feeling
 * like being stood up.
 */
export const RECONNECT_GRACE_MS = 20_000;

/**
 * A disconnect this early means the match barely happened.
 *
 * Recorded but excluded from ranked stats, so a rage-quit in the opening
 * seconds cannot be farmed into a win record.
 */
export const RANKED_MINIMUM_MS = 15_000;

const timers = new Map<PlayerId, ReturnType<typeof setTimeout>>();

/**
 * Handles a player dropping mid-match.
 *
 * The fight PAUSES rather than ending. An instant forfeit punishes the wrong
 * person about half the time — the player whose train went into a tunnel did
 * not choose to quit, and the player left standing did not earn the win.
 */
export function handleMatchDisconnect(
  io: GameServer,
  ctx: RealtimeContext,
  socket: GameSocket,
): void {
  const playerId = socket.data.playerId;
  const match = ctx.matches.forPlayer(playerId);
  if (!match || match.isFinished) return;

  const room = ctx.rooms.forPlayer(playerId);
  if (!room) return;

  // The member STAYS in the room, marked absent. Removing them would destroy
  // the seat they need to come back to.
  ctx.rooms.setConnected(room, playerId, false);
  match.pause();

  const resumeDeadline = Date.now() + RECONNECT_GRACE_MS;
  const nickname = room.members.get(playerId)?.identity.nickname ?? 'Opponent';

  io.to(room.id).emit('match:paused', { playerId, nickname, resumeDeadline });
  io.to(room.id).emit('room:state', ctx.rooms.toState(room));

  logger.info({ matchId: match.matchId, playerId }, 'Match paused — player disconnected');

  clearTimer(playerId);
  timers.set(
    playerId,
    setTimeout(() => {
      timers.delete(playerId);

      // They may already be back; the reconnect path clears this timer, but a
      // re-check costs nothing and closes the race.
      if (match.isFinished || !match.isPaused) return;

      const opponent = match.fighters.find((f) => f.playerId !== playerId);
      match.abort('disconnect', opponent?.playerId ?? null);

      logger.info({ matchId: match.matchId, playerId }, 'Reconnect window expired — forfeit');
    }, RECONNECT_GRACE_MS),
  );
}

/**
 * Reattaches a returning player.
 *
 * Called after `guest:init` restores their identity — which is the whole
 * reason guest sessions are signed and stateless (2.2). The new socket knows
 * nothing about the match; the token is what proves it belongs to one.
 */
export function handleReconnect(io: GameServer, ctx: RealtimeContext, socket: GameSocket): void {
  const playerId = socket.data.playerId;

  const room = ctx.rooms.forPlayer(playerId);
  if (!room) return;

  socket.data.roomId = room.id;
  void socket.join(room.id);

  ctx.rooms.setConnected(room, playerId, true);
  io.to(room.id).emit('room:state', ctx.rooms.toState(room));

  const match = ctx.matches.forPlayer(playerId);
  if (!match || match.isFinished) return;

  clearTimer(playerId);
  socket.data.matchId = asRoomId(match.matchId) as never;

  match.resume();

  // Everything the returning client needs to rebuild: the authoritative state,
  // and all text issued so far (regenerated from the seed, never stored).
  io.to(room.id).emit('match:resumed', {
    snapshot: match.snapshot(),
    sentences: match.issuedSentences(),
  });

  logger.info({ matchId: match.matchId, playerId }, 'Player reconnected — match resumed');
}

function clearTimer(playerId: PlayerId): void {
  const timer = timers.get(playerId);
  if (timer) clearTimeout(timer);
  timers.delete(playerId);
}

/** Cancels any pending forfeit, e.g. when a match ends for another reason. */
export function cancelReconnectTimer(playerId: PlayerId): void {
  clearTimer(playerId);
}
