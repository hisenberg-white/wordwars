import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('letmein');
    await expect(verifyPassword('letmein', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('letmein');
    await expect(verifyPassword('letmeout', hash)).resolves.toBe(false);
  });

  it('is case sensitive', async () => {
    const hash = await hashPassword('LetMeIn');
    await expect(verifyPassword('letmein', hash)).resolves.toBe(false);
  });

  /** A shared salt would make identical passwords visibly identical. */
  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');

    expect(a).not.toBe(b);
    await expect(verifyPassword('same', a)).resolves.toBe(true);
    await expect(verifyPassword('same', b)).resolves.toBe(true);
  });

  it('never stores the password in the hash', async () => {
    const hash = await hashPassword('supersecret');
    expect(hash).not.toContain('supersecret');
  });

  /**
   * Regression: `Buffer.from('zz', 'hex')` returns an EMPTY buffer rather than
   * throwing. Before the strict hex guard, a malformed stored hash decoded to
   * zero length, scrypt was asked for a zero-length key, and
   * `timingSafeEqual(<empty>, <empty>)` returned true — a stored value that
   * accepted every password. Each case below reached that path.
   */
  it.each([
    ['empty', ''],
    ['no separator', 'no-colon'],
    ['non-hex on both sides', 'zz:zz'],
    ['both sides empty', ':'],
    ['empty hash', 'a1:'],
    ['empty salt', ':a1'],
    ['odd-length hex', 'abc:abc'],
    ['non-hex hash', 'a1b2:nothex'],
  ])('returns false for a malformed stored value (%s)', async (_label, stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('handles unicode passwords', async () => {
    const hash = await hashPassword('пароль🔥');
    await expect(verifyPassword('пароль🔥', hash)).resolves.toBe(true);
    await expect(verifyPassword('пароль', hash)).resolves.toBe(false);
  });
});
