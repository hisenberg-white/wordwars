import { ARENA_IDS, type ArenaId } from '@wordwars/shared';
import { randomInt } from 'node:crypto';
import { logger } from '../logger.js';
import type { RoomRegistry, LiveRoom } from './RoomRegistry.js';
import type { GameServer } from '../realtime/gateway.js';

/**
 * How long the 3-2-1 sequence runs.
 *
 * Three seconds is the fighting-game convention and it is not arbitrary: it is
 * long enough to get your hands in position and short enough that a rematch
 * never feels like waiting. Do not extend it to fit an animation — cut the
 * animation.
 */
export const COUNTDOWN_MS = 3_000;

/**
 * Begins the countdown and schedules the transition into the match.
 *
 * The server broadcasts exactly twice: once with the absolute deadline, and
 * once when the fight begins. Everything between those two moments is animated
 * client-side against `serverNow()`, so both players' screens hit "1" together
 * without a packet per second.
 */
export function startCountdown(
  io: GameServer,
  rooms: RoomRegistry,
  room: LiveRoom,
  onBegin: (room: LiveRoom) => void,
): void {
  if (room.phase === 'countdown') return;

  // Resolve randomised settings now, so every client is told the same arena
  // before the fight rather than discovering it at load time.
  if (room.settings.randomArena) {
    room.settings = { ...room.settings, arenaId: randomArena() };
  }

  room.phase = 'countdown';
  room.countdownEndsAt = Date.now() + COUNTDOWN_MS;

  io.to(room.id).emit('room:state', rooms.toState(room));

  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = null;

    // The room may have emptied or been aborted while we waited.
    if (room.phase !== 'countdown') return;

    room.phase = 'in-match';
    room.countdownEndsAt = null;

    io.to(room.id).emit('room:state', rooms.toState(room));
    logger.info({ roomId: room.id, arena: room.settings.arenaId }, 'Match beginning');

    onBegin(room);
  }, COUNTDOWN_MS);
}

function randomArena(): ArenaId {
  return ARENA_IDS[randomInt(ARENA_IDS.length)]!;
}
