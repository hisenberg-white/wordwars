import { Router, type Request } from 'express';
import { z } from 'zod';
import { asUserId, NICKNAME_MAX } from '@wordwars/shared';
import { AuthService, toPublic } from '../../services/auth.js';
import { FriendService, type FriendError, type PresenceLookup } from '../../services/friends.js';
import { OFFLINE_PRESENCE } from '../../services/friends.js';
import type { Repositories } from '../../db/repositories.js';

/**
 * Friends.
 *
 * Every route requires an account: a friendship needs two durable identities,
 * and a guest has none. That is the one place in the product where guests are
 * genuinely excluded, and it is a property of the feature rather than a nudge
 * toward signing up.
 */

/** Client-facing copy. Codes stay in the service; wording lives in one place. */
const MESSAGE: Record<FriendError, string> = {
  'not-found': 'No player with that name.',
  self: 'You cannot add yourself.',
  'already-friends': 'You are already friends.',
  'already-requested': 'Request already sent.',
  blocked: 'You have blocked this player.',
  'friend-limit': 'Your friends list is full.',
  'request-limit': 'Too many pending requests. Wait for some to be answered.',
  'no-request': 'There is no request to accept.',
};

const requestSchema = z.object({ username: z.string().min(1).max(NICKNAME_MAX) });
const targetSchema = z.object({ userId: z.string().min(1).max(64) });

export function createFriendsRouter(
  repos: Repositories,
  presence: PresenceLookup = OFFLINE_PRESENCE,
): Router {
  const router = Router();
  const auth = new AuthService(repos);
  const friends = new FriendService(repos, presence);

  /** Resolves the caller, or ends the response. Returns null when unauthorised. */
  const requireUser = async (req: Request) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    return auth.authenticate(header.slice('Bearer '.length).trim());
  };

  router.get('/', (req, res) => {
    void (async () => {
      const user = await requireUser(req);
      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
      }

      res.json({ friends: await friends.list(user.id) });
    })();
  });

  router.post('/request', (req, res) => {
    void (async () => {
      const user = await requireUser(req);
      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
      }

      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_PAYLOAD' } });
        return;
      }

      const result = await friends.request(user.id, parsed.data.username);
      if (!result.ok) {
        res.status(400).json({ error: { code: result.error, message: MESSAGE[result.error] } });
        return;
      }

      res.json({ target: toPublic(result.target), friends: await friends.list(user.id) });
    })();
  });

  /** Accept, decline/remove and block all act on one target. */
  for (const [path, action] of [
    ['accept', 'accept'],
    ['remove', 'remove'],
    ['block', 'block'],
  ] as const) {
    router.post(`/${path}`, (req, res) => {
      void (async () => {
        const user = await requireUser(req);
        if (!user) {
          res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
          return;
        }

        const parsed = targetSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'INVALID_PAYLOAD' } });
          return;
        }

        const result = await friends[action](user.id, asUserId(parsed.data.userId));
        if (!result.ok) {
          res.status(400).json({ error: { code: result.error, message: MESSAGE[result.error] } });
          return;
        }

        res.json({ friends: await friends.list(user.id) });
      })();
    });
  }

  return router;
}
