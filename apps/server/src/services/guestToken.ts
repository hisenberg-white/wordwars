import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { asPlayerId, type PlayerId } from '@wordwars/shared';
import { env } from '../config/env.js';

/**
 * Guest session tokens.
 *
 * **Stateless and signed**, not a server-side session record. The payload
 * travels with the client and is trusted only because it carries a valid HMAC.
 *
 * Why stateless: a guest must survive a page refresh, a server restart, and
 * being routed to a different process by the load balancer. A session store
 * would mean either sticky routing or a Redis lookup on every connect — and
 * Redis is explicitly optional until phase 4 (PERSISTENCE=none). Signing gives
 * us all three properties for the price of one HMAC.
 *
 * What this protects: a player cannot forge someone else's playerId, or grant
 * themselves a reserved nickname by editing localStorage.
 *
 * What it does NOT protect: anyone holding the token IS that guest. It is a
 * bearer credential. For a throwaway guest identity with no purchases and no
 * private data attached that is the right trade — but it is the reason
 * registered accounts get real auth in phase 4.1 rather than an upgraded
 * version of this.
 */

export interface GuestTokenPayload {
  readonly playerId: PlayerId;
  readonly nickname: string;
  readonly expiresAt: number;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

function sign(payload: string): string {
  return b64url(createHmac('sha256', env.SESSION_SECRET).update(payload).digest());
}

export function issueGuestToken(
  nickname: string,
  playerId?: PlayerId,
): {
  token: string;
  payload: GuestTokenPayload;
} {
  const payload: GuestTokenPayload = {
    playerId: playerId ?? asPlayerId(randomUUID()),
    nickname,
    expiresAt: Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  };

  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { token: `${body}.${sign(body)}`, payload };
}

/**
 * Verifies and decodes a token. Returns null for anything untrustworthy —
 * malformed, wrong signature, expired, or structurally implausible.
 *
 * Every failure returns the same `null`. Distinguishing "bad signature" from
 * "expired" in the response would tell an attacker which half of their guess
 * was right; the client's recovery is identical either way (get a new
 * identity), so there is nothing to gain from the detail.
 */
export function verifyGuestToken(token: string): GuestTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts as [string, string];

  const expected = Buffer.from(sign(body), 'utf8');
  const actual = Buffer.from(signature, 'utf8');

  // Length check first: timingSafeEqual throws on mismatched lengths, and the
  // length of a signature is not secret.
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as GuestTokenPayload).playerId !== 'string' ||
      typeof (decoded as GuestTokenPayload).nickname !== 'string' ||
      typeof (decoded as GuestTokenPayload).expiresAt !== 'number'
    ) {
      return null;
    }

    const payload = decoded as GuestTokenPayload;
    if (payload.expiresAt <= Date.now()) return null;

    return payload;
  } catch {
    // A signature we produced should always decode. If it does not, something
    // is wrong enough that refusing is the only safe answer.
    return null;
  }
}
