import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SALT_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Room password hashing.
 *
 * Uses node's built-in scrypt rather than argon2. Reasoning:
 *
 *   - A room password is a short-lived, low-value secret shared deliberately
 *     with friends. It is not a credential guarding an account.
 *   - scrypt ships with Node, so there is no native module to build. Adding a
 *     compiled dependency for this would complicate every install and Docker
 *     image for a marginal gain.
 *
 * Real user authentication (phase 4.1) is a different problem with different
 * stakes and gets argon2id. This function is not the place to reuse for that.
 *
 * Hashed rather than compared in plaintext because rooms are logged, dumped in
 * diagnostics, and held in memory — none of which should expose what a player
 * typed, since people reuse passwords even where they shouldn't.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_BYTES);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Strict hex: `Buffer.from` truncates at the first invalid character instead of throwing. */
const isHex = (value: string): boolean => value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');

  /*
   * These guards are load-bearing, not defensive noise.
   *
   * `Buffer.from('zz', 'hex')` does not throw — it returns an EMPTY buffer.
   * Without a strict hex check, a corrupted or attacker-influenced stored value
   * decodes to a zero-length expected hash, scrypt is asked for a zero-length
   * key, and `timingSafeEqual(<empty>, <empty>)` returns true. The result is a
   * hash that accepts every password. Caught by a test for malformed input.
   */
  if (!saltHex || !hashHex) return false;
  if (!isHex(saltHex) || !isHex(hashHex)) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');

  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scryptAsync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
