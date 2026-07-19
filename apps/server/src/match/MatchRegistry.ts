import type { PlayerId } from '@wordwars/shared';
import type { ServerMatch } from './ServerMatch.js';

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

  add(match: ServerMatch, players: readonly PlayerId[]): void {
    this.byId.set(match.matchId, match);
    for (const playerId of players) this.byPlayer.set(playerId, match);
  }

  get(matchId: string): ServerMatch | null {
    return this.byId.get(matchId) ?? null;
  }

  forPlayer(playerId: PlayerId): ServerMatch | null {
    return this.byPlayer.get(playerId) ?? null;
  }

  remove(match: ServerMatch): void {
    // Timers are cleared here rather than trusting the caller — an orphaned
    // interval keeps the whole match object alive and keeps broadcasting into
    // a room nobody is in.
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
