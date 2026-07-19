import { ackError, ackOk, asUserId, friendChallengeSchema } from '@wordwars/shared';
import { logger } from '../../logger.js';
import { FriendService } from '../../services/friends.js';
import type { OnlineRegistry } from '../onlineRegistry.js';
import type { RealtimeContext } from '../context.js';
import type { GameSocket } from '../gateway.js';
import { validated } from '../validate.js';

/**
 * How long a challenge stays live.
 *
 * Long enough to notice a toast and finish the sentence you were typing, short
 * enough that a stale invite from twenty minutes ago never drops you into an
 * abandoned room. The room itself outlives this — expiry only governs whether
 * the invite still looks actionable.
 */
export const CHALLENGE_TTL_MS = 90_000;

/** Character default, matching the room handler until the picker exists. */
const DEFAULT_CHARACTER = 'ninja' as const;

export function registerFriendHandlers(
  socket: GameSocket,
  ctx: RealtimeContext,
  online: OnlineRegistry,
): void {
  const friends = new FriendService(ctx.repos, online);

  socket.on(
    'friend:challenge',
    validated(friendChallengeSchema, async (payload, ack) => {
      const raw = socket.data.userId;

      // Challenging is an account feature: it needs a durable identity on both
      // ends to address, and a guest has neither.
      if (!raw) {
        ack(ackError('UNAUTHENTICATED', 'Sign in to challenge friends.'));
        return;
      }

      const me = asUserId(raw);
      const targetId = asUserId(payload.userId);

      /*
       * Friendship is checked SERVER-side before anything is created.
       *
       * Without this, the challenge event is an open channel to push a popup
       * at any account id in the system — a spam vector wearing a feature's
       * clothes.
       */
      if (!(await friends.canInteract(me, targetId))) {
        ack(ackError('FORBIDDEN', 'You can only challenge friends.'));
        return;
      }

      const sockets = online.socketsFor(targetId);
      if (sockets.length === 0) {
        ack(ackError('UNAVAILABLE', 'They just went offline.'));
        return;
      }

      // The challenger's own room is created first, so accepting lands them
      // somewhere that already exists rather than racing to make it.
      // Private: a challenge is addressed to one person, so the room must not
      // also be advertised in the public browser.
      const room = ctx.rooms.create({
        settings: { isPublic: false },
        passwordHash: null,
      });

      ctx.rooms.addMember(room, socket.data.identity, DEFAULT_CHARACTER);
      socket.data.roomId = room.id;
      void socket.join(room.id);

      const invite = {
        from: socket.data.identity,
        roomId: room.id,
        code: room.code,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      };

      // Every tab they have open, since we cannot know which one they are
      // looking at.
      for (const target of sockets) target.emit('friend:challenged', invite);

      logger.info({ from: me, to: targetId, roomId: room.id }, 'Challenge sent');
      ack(ackOk({ roomId: room.id, code: room.code }));
    }),
  );
}
