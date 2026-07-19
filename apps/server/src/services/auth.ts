import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  asUserId,
  validateEmail,
  validatePassword,
  validateUsername,
  type AuthenticatedUser,
  type PlayerId,
  type UserId,
} from '@wordwars/shared';
import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { newUserId } from '../db/memory.js';
import type { Repositories, UserRecord } from '../db/repositories.js';
import { issueGuestToken, verifyGuestToken } from './guestToken.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Account password hashing.
 *
 * **scrypt at OWASP-recommended parameters, not argon2id.**
 *
 * The plan said argon2id, and argon2id is marginally preferable in isolation.
 * But every argon2 package for Node is a native module: it needs a toolchain
 * at install time, complicates every Docker image, and breaks on any platform
 * without a prebuilt binary. scrypt is memory-hard, ships with Node, is an
 * OWASP-approved choice at these parameters, and costs an attacker the same
 * order of magnitude.
 *
 * N=2^17 with r=8 is roughly 128MB and ~100ms per hash — deliberately slow.
 * Logins happen rarely; brute force happens constantly.
 */
const SCRYPT = {
  /*
   * Lowered under NODE_ENV=test.
   *
   * At production cost a single hash is ~100ms, and the auth suite performs
   * dozens — it ran 25 seconds. Tests still exercise real scrypt through the
   * identical code path; only the work factor differs, which is the one
   * parameter no test asserts on.
   */
  N: env.NODE_ENV === 'test' ? 2 ** 14 : 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export type RegisterError =
  'invalid-email' | 'invalid-username' | 'weak-password' | 'email-taken' | 'username-taken';

export type LoginError = 'invalid-credentials';

export interface RegisterInput {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  /** The guest identity to absorb, if the player was already playing. */
  readonly guestToken?: string | undefined;
}

export class AuthService {
  constructor(private readonly repos: Repositories) {}

  async register(input: RegisterInput): Promise<
    | {
        ok: true;
        user: AuthenticatedUser;
        token: string;
        expiresAt: number;
        claimedMatches: number;
      }
    | { ok: false; error: RegisterError }
  > {
    if (validateEmail(input.email)) return { ok: false, error: 'invalid-email' };
    if (validateUsername(input.username)) return { ok: false, error: 'invalid-username' };
    if (validatePassword(input.password)) return { ok: false, error: 'weak-password' };

    const email = input.email.trim();
    const username = input.username.trim();

    if (await this.repos.users.findByEmail(email)) return { ok: false, error: 'email-taken' };
    if (await this.repos.users.findByUsername(username)) {
      return { ok: false, error: 'username-taken' };
    }

    const user = await this.repos.users.create({
      id: newUserId(),
      email,
      username,
      passwordHash: await hashPassword(input.password),
      avatarUrl: null,
      countryCode: null,
      xp: 0,
      level: 1,
    });

    /*
     * Absorb the guest.
     *
     * This is what makes "play first, register later" more than a slogan: the
     * matches they already played become the first entries in their history
     * rather than being thrown away. Doing it at registration — rather than
     * asking them to link accounts later — means the prompt on the results
     * screen has a real payoff.
     */
    let claimedMatches = 0;
    if (input.guestToken) {
      const guest = verifyGuestToken(input.guestToken);
      if (guest) {
        claimedMatches = await this.repos.matches.claimForUser(guest.playerId, user.id);
        logger.info({ userId: user.id, claimedMatches }, 'Guest history claimed on registration');
      }
    }

    return { ok: true, ...this.session(user), claimedMatches };
  }

  async login(
    email: string,
    password: string,
  ): Promise<
    | { ok: true; user: AuthenticatedUser; token: string; expiresAt: number }
    | { ok: false; error: LoginError }
  > {
    const user = await this.repos.users.findByEmail(email.trim());

    /*
     * The same error and the same work either way.
     *
     * Returning "no such account" would let anyone enumerate registered
     * addresses. Hashing even when the user is missing keeps the response time
     * flat, so timing cannot leak the answer the message refuses to give.
     */
    if (!user) {
      await hashPassword(password);
      return { ok: false, error: 'invalid-credentials' };
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      return { ok: false, error: 'invalid-credentials' };
    }

    await this.repos.users.update(user.id, { lastSeenAt: Date.now() });
    return { ok: true, ...this.session(user) };
  }

  /** Resolves a bearer token to a user, or null if it is not trustworthy. */
  async authenticate(token: string): Promise<UserRecord | null> {
    const payload = verifyGuestToken(token);
    if (!payload) return null;

    // Account tokens are guest tokens whose playerId IS the user id — the same
    // signing scheme, so there is one verification path to get right.
    return this.repos.users.findById(asUserId(payload.playerId));
  }

  private session(user: UserRecord): { user: AuthenticatedUser; token: string; expiresAt: number } {
    const { token, payload } = issueGuestToken(user.username, user.id as unknown as PlayerId);

    return {
      user: toPublic(user),
      token,
      expiresAt: payload.expiresAt,
    };
  }
}

export function toPublic(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    countryCode: user.countryCode,
    xp: user.xp,
    level: user.level,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES, SCRYPT);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Strict hex: `Buffer.from` truncates at the first invalid character. */
const isHex = (value: string): boolean => value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');

  // Same guards as the room-password path: `Buffer.from('zz','hex')` returns an
  // EMPTY buffer rather than throwing, and without these a malformed stored
  // hash would compare two empty buffers and accept every password.
  if (!saltHex || !hashHex) return false;
  if (!isHex(saltHex) || !isHex(hashHex)) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scryptAsync(password, salt, expected.length, SCRYPT);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** True when accounts will not survive a restart, so the UI can say so. */
export const isEphemeral = (): boolean => env.PERSISTENCE === 'none';

export type { UserId };
