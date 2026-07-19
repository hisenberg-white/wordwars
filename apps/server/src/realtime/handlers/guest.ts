import {
  type GuestInitResult,
  ackError,
  ackOk,
  asPlayerId,
  guestInitSchema,
  validateNickname,
} from '@wordwars/shared';
import { logger } from '../../logger.js';
import { issueGuestToken, verifyGuestToken } from '../../services/guestToken.js';
import { generateNickname } from '../../services/nickname.js';
import type { GameSocket } from '../gateway.js';
import { validated } from '../validate.js';

/**
 * `guest:init` — establish, restore, or rename a guest identity.
 *
 * One event covers all three because they are the same operation with
 * different inputs, and collapsing them removes a class of race where a client
 * renames before its identity exists:
 *
 *   { }                      → brand new guest, generated name
 *   { token }                → restore the identity behind that token
 *   { token, nickname }      → restore, then rename
 *   { nickname }             → new guest with a chosen name
 *
 * A fresh token is always reissued, because the nickname is inside the signed
 * payload — a rename that did not reissue would leave the client holding a
 * token that reverts the name on next connect.
 */
export function registerGuestHandlers(socket: GameSocket): void {
  const log = logger.child({ socketId: socket.id });

  socket.on(
    'guest:init',
    validated(guestInitSchema, (payload, ack) => {
      const restored = payload.token ? verifyGuestToken(payload.token) : null;

      // A token that fails verification is not an error the player can act on.
      // Silently issuing a fresh identity is the right recovery: an expired
      // token after a fortnight away should look like a normal visit, not a
      // failure state.
      let nickname = restored?.nickname ?? generateNickname();
      const playerId = restored ? asPlayerId(restored.playerId) : undefined;

      if (payload.nickname !== undefined) {
        const problem = validateNickname(payload.nickname);
        if (problem) {
          ack(ackError('INVALID_PAYLOAD', problem));
          return;
        }
        nickname = payload.nickname.trim();
      }

      const { token, payload: issued } = issueGuestToken(nickname, playerId);

      socket.data.playerId = issued.playerId;
      socket.data.identity = {
        playerId: issued.playerId,
        nickname: issued.nickname,
        isGuest: true,
        level: 1,
        avatarUrl: null,
        countryCode: null,
      };

      const result: GuestInitResult = {
        identity: socket.data.identity,
        token: {
          token,
          playerId: issued.playerId,
          expiresAt: issued.expiresAt,
        },
      };

      log.debug(
        { playerId: issued.playerId, restored: restored !== null },
        'Guest identity issued',
      );

      // Emitted as well as acked: the player may be in a room, and other
      // screens subscribe to this rather than threading the ack result through.
      socket.emit('session:issued', result);
      ack(ackOk(result));
    }),
  );
}
