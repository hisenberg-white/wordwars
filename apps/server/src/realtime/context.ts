import { MatchmakingService, type Pairing } from '../matchmaking/MatchmakingService.js';
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
  readonly rooms: RoomRegistry;
  readonly matchmaking: MatchmakingService;
  /**
   * Called the instant a countdown reaches zero.
   *
   * **This is the seam Phase 3 plugs into.** Step 3.3 replaces the current
   * no-op with MatchEngine construction: build the match state, stream the
   * first sentence, and start the tick loop. Everything up to this callback —
   * pairing, lobby, settings, countdown — is already finished and does not
   * need to change to support it.
   */
  readonly onMatchBegin: (room: LiveRoom) => void;
}

export function createRealtimeContext(
  onPaired: (pairing: Pairing) => void,
  onMatchBegin: (room: LiveRoom) => void = () => {},
): RealtimeContext {
  return {
    rooms: new RoomRegistry(),
    matchmaking: new MatchmakingService(onPaired),
    onMatchBegin,
  };
}
