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
