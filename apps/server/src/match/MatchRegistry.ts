import type { PlayerId } from '@wordwars/shared';
import { MatchScheduler } from './MatchScheduler.js';
import { EVENT_FLUSH_MS, SNAPSHOT_MS, TICK_MS, type ServerMatch } from './ServerMatch.js';

/**
 * Live matches in this process.
 *
 * Same scaling seam as RoomRegistry: a match is owned by the process that
 * created it (plan §1.1 D2). Going multi-process means routing a player's
 * socket to the owning process, not moving this state.
 */
export class MatchRegistry {
  private readonly byId = new Map<string, ServerMatch>();
  private readonly byPlayer = new Map<PlayerId, ServerMatch>();

  /**
   * One clock for every match in this process.
   *
   * Owned here because registration and scheduling have exactly the same
   * lifetime: a match that is registered should be ticking, and one that is
   * removed must stop. Keeping them together makes it impossible to add a
   * match that never ticks, or to leave a removed one running.
   */
  private readonly scheduler = new MatchScheduler(EVENT_FLUSH_MS, SNAPSHOT_MS, TICK_MS);

  add(match: ServerMatch, players: readonly PlayerId[]): void {
    this.byId.set(match.matchId, match);
    for (const playerId of players) this.byPlayer.set(playerId, match);
    this.scheduler.add(match);
  }

  get(matchId: string): ServerMatch | null {
    return this.byId.get(matchId) ?? null;
  }

  forPlayer(playerId: PlayerId): ServerMatch | null {
    return this.byPlayer.get(playerId) ?? null;
  }

  remove(match: ServerMatch): void {
    // Deregistered here rather than trusting the caller — a match still on the
    // clock keeps the whole object alive and keeps broadcasting into a room
    // nobody is in.
    this.scheduler.remove(match);
    match.dispose();
    this.byId.delete(match.matchId);

    for (const [playerId, m] of this.byPlayer) {
      if (m === match) this.byPlayer.delete(playerId);
    }
  }

  get size(): number {
    return this.byId.size;
  }
}
