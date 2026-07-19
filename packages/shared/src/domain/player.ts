import type { PlayerId } from '../ids.js';

/**
 * Identity. A guest and a registered user are the same shape to the game
 * layer — this is what makes "never block gameplay behind login" cheap to
 * honour. Only the persistence layer cares about the difference.
 */
export interface PlayerIdentity {
  readonly playerId: PlayerId;
  readonly nickname: string;
  readonly isGuest: boolean;
  readonly level: number;
  readonly avatarUrl: string | null;
  readonly countryCode: string | null;
}

/** Issued on connect; lets a player reclaim their identity after a refresh. */
export interface SessionToken {
  readonly token: string;
  readonly playerId: PlayerId;
  readonly expiresAt: number;
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;

/**
 * Nicknames allow letters, digits, underscore and single interior spaces.
 * Deliberately narrow: it keeps name plates legible at small sizes and
 * sidesteps homoglyph impersonation in leaderboards.
 */
export const NICKNAME_PATTERN = /^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/;

/**
 * Names that would let a player pose as part of the game itself.
 *
 * Not a profanity filter — that is a moderation problem with a moderation
 * solution (reports, in the schema already). This is narrowly about
 * impersonation: "Admin" telling someone in lobby chat to hand over their
 * account is a support incident we can prevent with a 10-entry list.
 */
export const RESERVED_NICKNAMES: readonly string[] = [
  'admin',
  'administrator',
  'moderator',
  'mod',
  'system',
  'server',
  'wordwars',
  'official',
  'support',
  'staff',
];

export type NicknameError = 'too-short' | 'too-long' | 'invalid-characters' | 'reserved';

/**
 * The single definition of a valid nickname.
 *
 * Shared so the client can give instant feedback as the player types and the
 * server can reject with identical rules. The client copy is a convenience;
 * the server copy is the one that counts (it never trusts the client), but
 * both reading from here means they cannot disagree about what is allowed.
 */
export function validateNickname(raw: string): NicknameError | null {
  const trimmed = raw.trim();

  if (trimmed.length < NICKNAME_MIN) return 'too-short';
  if (trimmed.length > NICKNAME_MAX) return 'too-long';
  if (!NICKNAME_PATTERN.test(trimmed)) return 'invalid-characters';

  const normalised = trimmed.toLowerCase().replace(/[\s_]/g, '');
  if (RESERVED_NICKNAMES.includes(normalised)) return 'reserved';

  return null;
}

export const NICKNAME_ERROR_MESSAGE: Readonly<Record<NicknameError, string>> = {
  'too-short': `At least ${NICKNAME_MIN} characters`,
  'too-long': `At most ${NICKNAME_MAX} characters`,
  'invalid-characters': 'Letters, numbers, underscores and spaces only',
  reserved: 'That name is reserved',
};
