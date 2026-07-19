import { MatchmakingService, type Pairing } from '../matchmaking/MatchmakingService.js';
import type { Repositories } from '../db/repositories.js';
import { AuthService } from '../services/auth.js';
import { MatchRegistry } from '../match/MatchRegistry.js';
import { RoomRegistry, type LiveRoom } from '../rooms/RoomRegistry.js';

/**
 * Server-wide services, constructed once and handed to socket handlers.
 *
 * Explicit construction rather than module-level singletons, so tests can spin
 * up an isolated server with its own empty queue and room registry. Two test
 * files sharing a global matchmaking queue would pair players across
 * unrelated tests — a genuinely confusing failure to debug.
 */
export interface RealtimeContext {
  readonly repos: Repositories;
  readonly auth: AuthService;
  readonly rooms: RoomRegistry;
  readonly matches: MatchRegistry;
  readonly matchmaking: MatchmakingService;
  /**
   * Called the instant a countdown reaches zero. Wired in the gateway to
   * `startMatchForRoom` (step 3.3); kept as an injected callback so the room
   * and countdown layers never import the match layer.
   */
  readonly onMatchBegin: (room: LiveRoom) => void;
}

export function createRealtimeContext(
  repos: Repositories,
  onPaired: (pairing: Pairing) => void,
  onMatchBegin: (room: LiveRoom) => void = () => {},
): RealtimeContext {
  return {
    repos,
    auth: new AuthService(repos),
    rooms: new RoomRegistry(),
    matches: new MatchRegistry(),
    matchmaking: new MatchmakingService(onPaired),
    onMatchBegin,
  };
}
