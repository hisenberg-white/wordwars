import { ackError, ackOk, matchWordSchema } from '@wordwars/shared';
import type { RealtimeContext } from '../context.js';
import type { GameSocket } from '../gateway.js';
import { validatedVoid } from '../validate.js';

export function registerMatchHandlers(socket: GameSocket, ctx: RealtimeContext): void {
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
