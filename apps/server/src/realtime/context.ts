import { MatchmakingService, type Pairing } from '../matchmaking/MatchmakingService.js';
import { RoomRegistry } from '../rooms/RoomRegistry.js';

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
}

export function createRealtimeContext(onPaired: (pairing: Pairing) => void): RealtimeContext {
  return {
    rooms: new RoomRegistry(),
    matchmaking: new MatchmakingService(onPaired),
  };
}
