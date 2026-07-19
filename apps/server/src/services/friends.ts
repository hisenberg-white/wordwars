import type { UserId } from '@wordwars/shared';
import type { Repositories, UserRecord } from '../db/repositories.js';

/**
 * Friends.
 *
 * The point of a friends list in a fighting game is to **start a fight**. Not
 * to collect names, not to show a number on a profile. Every decision here is
 * made against that: the list is sorted by who you can actually play right now,
 * it carries live presence, and the primary action on a row is Challenge.
 *
 * The rest of this file is the unglamorous half — the rules that stop a social
 * feature becoming a harassment vector. Those are not optional extras; a
 * friends system without them is a worse feature than no friends system.
 */

/**
 * Caps.
 *
 * The outgoing-request cap is the anti-spam measure that matters: without it
 * one account can paper the entire player base with requests. Capping the
 * SENDER's pending requests (rather than the recipient's inbox) puts the limit
 * on the person doing it, so a popular player is never the one punished.
 */
export const MAX_FRIENDS = 200;
export const MAX_PENDING_OUTGOING = 50;

export type FriendError =
  | 'not-found'
  | 'self'
  | 'already-friends'
  | 'already-requested'
  | 'blocked'
  | 'friend-limit'
  | 'request-limit'
  | 'no-request';

/** Shared by every mutating action, so callers handle one shape. */
export type FriendResult = { ok: true } | { ok: false; error: FriendError };

export interface FriendSummary {
  readonly userId: UserId;
  readonly username: string;
  readonly level: number;
  readonly countryCode: string | null;
  readonly status: 'accepted' | 'pending-incoming' | 'pending-outgoing' | 'blocked';
  readonly online: boolean;
  /** What they are doing, when online — an idle friend is a playable friend. */
  readonly activity: 'idle' | 'in-match' | null;
  readonly since: number;
}

/** Answers "is this user online, and busy?" without the service knowing about sockets. */
export interface PresenceLookup {
  isOnline(userId: UserId): boolean;
  activityOf(userId: UserId): 'idle' | 'in-match' | null;
}

export const OFFLINE_PRESENCE: PresenceLookup = {
  isOnline: () => false,
  activityOf: () => null,
};

export class FriendService {
  constructor(
    private readonly repos: Repositories,
    private readonly presence: PresenceLookup = OFFLINE_PRESENCE,
  ) {}

  /**
   * The list, ordered for USE rather than for tidiness.
   *
   * Incoming requests first because they are the only rows that need a
   * decision, then friends who are online and free to play, then online but
   * mid-match, then everyone else. A list sorted alphabetically would bury the
   * one person waiting to fight you under two hundred names.
   */
  async list(userId: UserId): Promise<FriendSummary[]> {
    const rows = await this.repos.friends.forUser(userId);
    const summaries: FriendSummary[] = [];

    for (const row of rows) {
      const user = await this.repos.users.findById(row.friendId);
      if (!user) continue; // Deleted account: drop rather than show a ghost.

      const online = row.status === 'accepted' && this.presence.isOnline(user.id);

      summaries.push({
        userId: user.id,
        username: user.username,
        level: user.level,
        countryCode: user.countryCode,
        status:
          row.status === 'pending'
            ? row.outgoing
              ? 'pending-outgoing'
              : 'pending-incoming'
            : row.status,
        online,
        activity: online ? this.presence.activityOf(user.id) : null,
        since: row.createdAt,
      });
    }

    return summaries.sort((a, b) => weight(a) - weight(b) || a.username.localeCompare(b.username));
  }

  /**
   * Sends a request, by username.
   *
   * Usernames rather than ids, because a player knows their friend's name and
   * not their UUID. Matching is case-insensitive for the same reason.
   */
  async request(
    userId: UserId,
    username: string,
  ): Promise<{ ok: true; target: UserRecord } | { ok: false; error: FriendError }> {
    const target = await this.repos.users.findByUsername(username.trim());
    if (!target) return { ok: false, error: 'not-found' };
    if (target.id === userId) return { ok: false, error: 'self' };

    const [mine, theirs, existing] = await Promise.all([
      this.repos.friends.forUser(userId),
      this.repos.friends.find(target.id, userId),
      this.repos.friends.find(userId, target.id),
    ]);

    /*
     * A block is invisible to the person blocked.
     *
     * Reporting "you are blocked" tells a harasser their target is reachable
     * and invites them to make another account. The request appears to send.
     */
    if (theirs?.status === 'blocked') return { ok: true, target };
    if (existing?.status === 'blocked') return { ok: false, error: 'blocked' };
    if (existing?.status === 'accepted') return { ok: false, error: 'already-friends' };

    /*
     * They already asked YOU.
     *
     * This has to be checked BEFORE the duplicate guard below, not after: the
     * incoming request is itself a pending row, so testing for duplicates
     * first rejects the second half of a mutual request as "already sent" and
     * the friendship never completes. Both people have expressed the same
     * wish, so making either click again is pure ceremony — accept.
     */
    if (existing?.status === 'pending' && !existing.outgoing) {
      await this.befriend(userId, target.id);
      return { ok: true, target };
    }

    if (existing?.status === 'pending') return { ok: false, error: 'already-requested' };

    if (mine.filter((r) => r.status === 'accepted').length >= MAX_FRIENDS) {
      return { ok: false, error: 'friend-limit' };
    }
    if (mine.filter((r) => r.status === 'pending' && r.outgoing).length >= MAX_PENDING_OUTGOING) {
      return { ok: false, error: 'request-limit' };
    }

    const now = Date.now();
    await this.repos.friends.put({
      userId,
      friendId: target.id,
      status: 'pending',
      outgoing: true,
      createdAt: now,
    });
    await this.repos.friends.put({
      userId: target.id,
      friendId: userId,
      status: 'pending',
      outgoing: false,
      createdAt: now,
    });

    return { ok: true, target };
  }

  async accept(userId: UserId, friendId: UserId): Promise<FriendResult> {
    const row = await this.repos.friends.find(userId, friendId);

    // Only an INCOMING request can be accepted — accepting your own outgoing
    // request would let one player friend anybody unilaterally.
    if (!row || row.status !== 'pending' || row.outgoing) return { ok: false, error: 'no-request' };

    await this.befriend(userId, friendId);
    return { ok: true };
  }

  /**
   * Declining and un-friending are the same operation: remove both rows.
   *
   * Idempotent on purpose — removing someone who is already gone is the
   * outcome the caller wanted, not an error worth showing them.
   */
  async remove(userId: UserId, friendId: UserId): Promise<FriendResult> {
    await this.repos.friends.remove(userId, friendId);
    await this.repos.friends.remove(friendId, userId);
    return { ok: true };
  }

  /**
   * Blocks someone.
   *
   * The block row is kept on the blocker's side only, and the blocked user's
   * rows are deleted — so from their side the friendship simply vanished,
   * which reveals nothing.
   */
  async block(userId: UserId, friendId: UserId): Promise<FriendResult> {
    await this.repos.friends.remove(friendId, userId);
    await this.repos.friends.put({
      userId,
      friendId,
      status: 'blocked',
      outgoing: true,
      createdAt: Date.now(),
    });
    return { ok: true };
  }

  /** Accepted friend ids — used for friends-scoped leaderboards. */
  async friendIds(userId: UserId): Promise<UserId[]> {
    const rows = await this.repos.friends.forUser(userId);
    return rows.filter((r) => r.status === 'accepted').map((r) => r.friendId);
  }

  /** True when these two may interact — checked before delivering a challenge. */
  async canInteract(from: UserId, to: UserId): Promise<boolean> {
    const [theirs, mine] = await Promise.all([
      this.repos.friends.find(to, from),
      this.repos.friends.find(from, to),
    ]);

    if (theirs?.status === 'blocked' || mine?.status === 'blocked') return false;
    return theirs?.status === 'accepted' && mine?.status === 'accepted';
  }

  private async befriend(a: UserId, b: UserId): Promise<void> {
    const now = Date.now();
    await this.repos.friends.put({
      userId: a,
      friendId: b,
      status: 'accepted',
      outgoing: true,
      createdAt: now,
    });
    await this.repos.friends.put({
      userId: b,
      friendId: a,
      status: 'accepted',
      outgoing: false,
      createdAt: now,
    });
  }
}

/** Sort key: rows needing a decision, then who you can fight right now. */
function weight(summary: FriendSummary): number {
  if (summary.status === 'pending-incoming') return 0;
  if (summary.status === 'accepted' && summary.activity === 'idle') return 1;
  if (summary.status === 'accepted' && summary.online) return 2;
  if (summary.status === 'accepted') return 3;
  if (summary.status === 'pending-outgoing') return 4;
  return 5;
}
