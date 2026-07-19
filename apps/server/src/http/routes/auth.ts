import { Router } from 'express';
import { z } from 'zod';
import { NICKNAME_MAX, PASSWORD_MAX, PASSWORD_MIN, type AuthSession } from '@wordwars/shared';
import { logger } from '../../logger.js';
import { AuthService, isEphemeral, toPublic } from '../../services/auth.js';
import type { Repositories } from '../../db/repositories.js';

const registerSchema = z.object({
  email: z.string().min(3).max(254),
  username: z.string().min(1).max(NICKNAME_MAX),
  password: z.string().min(1).max(PASSWORD_MAX),
  /** Present when the player was already playing as a guest. */
  guestToken: z.string().max(512).optional(),
});

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(PASSWORD_MAX),
});

/** Client-facing copy. Codes stay on the wire; wording lives in one place. */
const REGISTER_MESSAGE: Record<string, string> = {
  'invalid-email': 'That does not look like an email address.',
  'invalid-username': 'Letters, numbers, underscores and spaces only.',
  'weak-password': `Passwords need at least ${PASSWORD_MIN} characters.`,
  'email-taken': 'An account already uses that email.',
  'username-taken': 'That name is taken.',
};

export function createAuthRouter(repos: Repositories): Router {
  const router = Router();
  const auth = new AuthService(repos);

  router.post('/register', (req, res) => {
    void (async () => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_PAYLOAD' } });
        return;
      }

      const result = await auth.register(parsed.data);

      if (!result.ok) {
        // 409 for a collision with an existing account, 400 for bad input —
        // the client shows different copy for "try another name" than for
        // "fix this field".
        const status = result.error.endsWith('-taken') ? 409 : 400;

        res.status(status).json({
          error: { code: result.error, message: REGISTER_MESSAGE[result.error] },
        });
        return;
      }

      logger.info({ userId: result.user.id, claimed: result.claimedMatches }, 'Account created');

      const session: AuthSession = {
        user: result.user,
        token: result.token,
        expiresAt: result.expiresAt,
      };

      res
        .status(201)
        .json({ ...session, claimedMatches: result.claimedMatches, ephemeral: isEphemeral() });
    })();
  });

  router.post('/login', (req, res) => {
    void (async () => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_PAYLOAD' } });
        return;
      }

      const result = await auth.login(parsed.data.email, parsed.data.password);

      if (!result.ok) {
        // Deliberately the same response whether the account exists or the
        // password was wrong — see AuthService.login.
        res.status(401).json({
          error: { code: 'invalid-credentials', message: 'Wrong email or password.' },
        });
        return;
      }

      const session: AuthSession = {
        user: result.user,
        token: result.token,
        expiresAt: result.expiresAt,
      };

      res.json({ ...session, ephemeral: isEphemeral() });
    })();
  });

  /** Who am I — used on page load to restore a session from a stored token. */
  router.get('/me', (req, res) => {
    void (async () => {
      const token = bearerToken(req.headers.authorization);
      if (!token) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
      }

      const user = await auth.authenticate(token);
      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED' } });
        return;
      }

      const stats = await repos.stats.find(user.id);
      res.json({ user: toPublic(user), stats, ephemeral: isEphemeral() });
    })();
  });

  return router;
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
