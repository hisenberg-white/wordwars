import { NICKNAME_MAX, NICKNAME_MIN, NICKNAME_PATTERN, RESERVED_NICKNAMES } from './player.js';

/**
 * Account rules.
 *
 * Shared so the signup form can give instant feedback using the exact rules
 * the server enforces. As with nicknames, the client copy is a convenience and
 * the server copy is the one that counts — but both reading from here means
 * they cannot disagree about what is allowed.
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

export type PasswordError = 'too-short' | 'too-long' | 'too-common';

/**
 * A short list of the passwords attackers try first.
 *
 * Not a substitute for a real breach corpus — that belongs behind an API — but
 * these few block the overwhelming majority of trivially-guessed accounts at
 * zero cost.
 */
const COMMON_PASSWORDS: readonly string[] = [
  'password',
  'password1',
  'password123',
  '1234567890',
  'qwertyuiop',
  'letmein123',
  'iloveyou1',
  'admin12345',
  'welcome123',
  'wordwars123',
];

/**
 * Length over composition rules.
 *
 * A 10-character minimum with no "must contain a symbol" requirement is both
 * stronger and kinder than the reverse: composition rules reliably produce
 * `Password1!` and push people toward reuse, while length is what actually
 * costs an attacker.
 */
export function validatePassword(password: string): PasswordError | null {
  if (password.length < PASSWORD_MIN) return 'too-short';
  if (password.length > PASSWORD_MAX) return 'too-long';
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) return 'too-common';
  return null;
}

export const PASSWORD_ERROR_MESSAGE: Readonly<Record<PasswordError, string>> = {
  'too-short': `At least ${PASSWORD_MIN} characters`,
  'too-long': `At most ${PASSWORD_MAX} characters`,
  'too-common': 'That password is too easy to guess',
};

export type EmailError = 'invalid';

/**
 * Deliberately permissive.
 *
 * Email validation by regex is a losing game — the real specification allows
 * far more than anyone expects, and strict patterns famously reject valid
 * addresses. This checks the shape and nothing more; deliverability is proven
 * by sending mail, not by a pattern.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): EmailError | null {
  return EMAIL_PATTERN.test(email.trim()) ? null : 'invalid';
}

export type UsernameError = 'too-short' | 'too-long' | 'invalid-characters' | 'reserved';

/** Usernames follow the same rules as guest nicknames, so a guest can keep theirs. */
export function validateUsername(username: string): UsernameError | null {
  const trimmed = username.trim();

  if (trimmed.length < NICKNAME_MIN) return 'too-short';
  if (trimmed.length > NICKNAME_MAX) return 'too-long';
  if (!NICKNAME_PATTERN.test(trimmed)) return 'invalid-characters';

  const normalised = trimmed.toLowerCase().replace(/[\s_]/g, '');
  if (RESERVED_NICKNAMES.includes(normalised)) return 'reserved';

  return null;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  readonly countryCode: string | null;
  readonly xp: number;
  readonly level: number;
}

export interface AuthSession {
  readonly user: AuthenticatedUser;
  readonly token: string;
  readonly expiresAt: number;
}
