import { beforeEach, describe, expect, it } from 'vitest';
import { asPlayerId, type PlayerId, type UserId } from '@wordwars/shared';
import { createMemoryRepositories } from '../db/memory.js';
import type { Repositories } from '../db/repositories.js';
import { AuthService, hashPassword, verifyPassword } from './auth.js';
import { issueGuestToken } from './guestToken.js';

let repos: Repositories;
let auth: AuthService;

const GOOD = {
  email: 'fighter@example.com',
  username: 'RapidWolf',
  password: 'correct horse battery',
};

beforeEach(() => {
  repos = createMemoryRepositories();
  auth = new AuthService(repos);
});

describe('registration', () => {
  it('creates an account and returns a session', async () => {
    const result = await auth.register(GOOD);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.user.username).toBe('RapidWolf');
    expect(result.token).toContain('.');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  /** A leaked user table must never reveal what anyone typed. */
  it('never stores the password', async () => {
    await auth.register(GOOD);

    const stored = await repos.users.findByEmail(GOOD.email);
    expect(stored?.passwordHash).not.toContain(GOOD.password);
    expect(stored?.passwordHash).toContain(':');
  });

  it.each([
    ['invalid email', { ...GOOD, email: 'not-an-email' }, 'invalid-email'],
    ['reserved username', { ...GOOD, username: 'Admin' }, 'invalid-username'],
    ['short password', { ...GOOD, password: 'short' }, 'weak-password'],
    ['common password', { ...GOOD, password: 'password123' }, 'weak-password'],
  ])('rejects %s', async (_label, input, expected) => {
    const result = await auth.register(input);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBe(expected);
  });

  it('refuses a duplicate email', async () => {
    await auth.register(GOOD);
    const second = await auth.register({ ...GOOD, username: 'OtherName' });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toBe('email-taken');
  });

  it('refuses a duplicate username regardless of casing', async () => {
    await auth.register(GOOD);
    const second = await auth.register({
      ...GOOD,
      email: 'other@example.com',
      username: 'rapidwolf',
    });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error).toBe('username-taken');
  });
});

describe('login', () => {
  beforeEach(async () => {
    await auth.register(GOOD);
  });

  it('accepts the right credentials', async () => {
    const result = await auth.login(GOOD.email, GOOD.password);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.user.email).toBe(GOOD.email);
  });

  it('rejects a wrong password', async () => {
    const result = await auth.login(GOOD.email, 'wrong password entirely');
    expect(result.ok).toBe(false);
  });

  /**
   * Account enumeration.
   *
   * A different message for "no such account" would let anyone test whether an
   * address is registered — useful to a spammer, and a privacy leak for the
   * account holder.
   */
  it('gives the same answer for an unknown account as for a wrong password', async () => {
    const unknown = await auth.login('nobody@example.com', GOOD.password);
    const wrong = await auth.login(GOOD.email, 'definitely not it');

    expect(unknown.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (unknown.ok || wrong.ok) throw new Error('unreachable');
    expect(unknown.error).toBe(wrong.error);
  });

  /**
   * And the same TIMING, or the message's discretion is undone by a stopwatch.
   * The service hashes even when no user was found for exactly this reason.
   */
  it('takes comparable time for an unknown account', async () => {
    const time = async (fn: () => Promise<unknown>) => {
      const start = performance.now();
      await fn();
      return performance.now() - start;
    };

    const unknownMs = await time(() => auth.login('nobody@example.com', GOOD.password));
    const wrongMs = await time(() => auth.login(GOOD.email, 'definitely not it'));

    // Generous ratio — this asserts the work happens at all, not a precise
    // constant-time guarantee, which Node cannot promise anyway.
    const ratio = Math.max(unknownMs, wrongMs) / Math.max(1, Math.min(unknownMs, wrongMs));
    expect(ratio).toBeLessThan(5);
  });

  it('is case sensitive about the password', async () => {
    const result = await auth.login(GOOD.email, GOOD.password.toUpperCase());
    expect(result.ok).toBe(false);
  });
});

describe('token authentication', () => {
  it('resolves a valid token back to its user', async () => {
    const registered = await auth.register(GOOD);
    if (!registered.ok) throw new Error('unreachable');

    const user = await auth.authenticate(registered.token);
    expect(user?.username).toBe('RapidWolf');
  });

  it.each(['', 'garbage', 'a.b.c'])('rejects the malformed token %s', async (token) => {
    expect(await auth.authenticate(token)).toBeNull();
  });

  /** A validly-signed token for an account that no longer exists must not work. */
  it('rejects a signed token for an unknown user', async () => {
    const { token } = issueGuestToken('Ghost', asPlayerId('no-such-user'));
    expect(await auth.authenticate(token)).toBeNull();
  });
});

describe('claiming a guest history', () => {
  const guestId = asPlayerId('guest-player-1');

  async function recordGuestMatch(playerId: PlayerId, id: string) {
    await repos.matches.record({
      id,
      startedAt: Date.now(),
      durationMs: 60_000,
      winnerId: playerId,
      players: [
        {
          playerId,
          userId: null,
          nickname: 'SilentFox',
          isWinner: true,
          damageDealt: 4000,
          wordsTyped: 60,
          wordsMissed: 3,
          accuracyBp: 9500,
          avgWpm: 78,
          peakWpm: 120,
          maxCombo: 31,
          ultimatesUsed: 2,
        },
      ],
    });
  }

  /**
   * The payoff for the results-screen prompt. If registering threw away the
   * matches someone just played, "create an account to keep your stats" would
   * be a lie.
   */
  it('adopts matches played as a guest', async () => {
    await recordGuestMatch(guestId, 'm1');
    await recordGuestMatch(guestId, 'm2');

    const { token } = issueGuestToken('SilentFox', guestId);
    const result = await auth.register({ ...GOOD, guestToken: token });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.claimedMatches).toBe(2);

    const history = await repos.matches.recentForUser(result.user.id as UserId, 10);
    expect(history).toHaveLength(2);
  });

  it('claims nothing without a guest token', async () => {
    await recordGuestMatch(guestId, 'm1');

    const result = await auth.register(GOOD);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.claimedMatches).toBe(0);
  });

  /** A forged token must not let someone adopt a stranger's match history. */
  it('ignores an unverifiable guest token', async () => {
    await recordGuestMatch(guestId, 'm1');

    const result = await auth.register({ ...GOOD, guestToken: 'forged.token' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.claimedMatches).toBe(0);
  });

  it('leaves another guest’s matches alone', async () => {
    await recordGuestMatch(guestId, 'mine');
    await recordGuestMatch(asPlayerId('someone-else'), 'theirs');

    const { token } = issueGuestToken('SilentFox', guestId);
    const result = await auth.register({ ...GOOD, guestToken: token });
    if (!result.ok) throw new Error('unreachable');

    expect(result.claimedMatches).toBe(1);
  });
});

describe('password hashing', () => {
  it('round-trips', async () => {
    const hash = await hashPassword('a long enough password');
    await expect(verifyPassword('a long enough password', hash)).resolves.toBe(true);
    await expect(verifyPassword('a different password', hash)).resolves.toBe(false);
  });

  it('salts, so identical passwords hash differently', async () => {
    const a = await hashPassword('same password here');
    const b = await hashPassword('same password here');

    expect(a).not.toBe(b);
    await expect(verifyPassword('same password here', a)).resolves.toBe(true);
  });

  /**
   * Same class of bug as the room-password path: `Buffer.from('zz','hex')`
   * returns an EMPTY buffer, so without strict guards a corrupted hash would
   * accept every password.
   */
  it.each(['', 'no-colon', 'zz:zz', ':', 'a1:', ':a1', 'abc:abc'])(
    'refuses the malformed stored hash %s',
    async (stored) => {
      await expect(verifyPassword('anything at all', stored)).resolves.toBe(false);
    },
  );
});
