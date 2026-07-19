import { asUserId, type UserId } from '@wordwars/shared';
import type { PresenceLookup } from '../services/friends.js';
import type { GameSocket } from './gateway.js';

/**
 * Who is signed in right now, and what they are doing.
 *
 * Lives in memory alongside the matches (plan §1.1 D2) rather than in Redis:
 * it is derived state, rebuilt in full the moment sockets reconnect, and a
 * stale presence row is a worse bug than an absent one.
 *
 * Keyed by userId and holding a SET of sockets, because one account can have
 * two tabs open. Marking somebody offline when they close one of them is the
 * classic bug this shape prevents.
 */
export class OnlineRegistry implements PresenceLookup {
  private readonly sockets = new Map<UserId, Set<GameSocket>>();

  add(socket: GameSocket): void {
    const raw = socket.data.userId;
    if (!raw) return; // Guests have no durable identity to be present as.
    const userId = asUserId(raw);

    const existing = this.sockets.get(userId) ?? new Set<GameSocket>();
    existing.add(socket);
    this.sockets.set(userId, existing);
  }

  remove(socket: GameSocket): void {
    const raw = socket.data.userId;
    if (!raw) return;
    const userId = asUserId(raw);

    const existing = this.sockets.get(userId);
    if (!existing) return;

    existing.delete(socket);
    if (existing.size === 0) this.sockets.delete(userId);
  }

  isOnline(userId: UserId): boolean {
    return this.sockets.has(userId);
  }

  /**
   * Idle means CHALLENGEABLE.
   *
   * The distinction exists so the friends list can lead with people you can
   * actually fight right now. A friend who is mid-match is present but not
   * available, and showing both as a plain green dot throws that away.
   */
  activityOf(userId: UserId): 'idle' | 'in-match' | null {
    const sockets = this.sockets.get(userId);
    if (!sockets || sockets.size === 0) return null;

    for (const socket of sockets) {
      if (socket.data.matchId) return 'in-match';
    }
    return 'idle';
  }

  /** Every live socket for an account — a challenge reaches all their tabs. */
  socketsFor(userId: UserId): GameSocket[] {
    return [...(this.sockets.get(userId) ?? [])];
  }

  get size(): number {
    return this.sockets.size;
  }
}
