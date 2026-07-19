import { asRoomId } from '@wordwars/shared';
import type { RealtimeContext } from '../realtime/context.js';
import type { GameServer, GameSocket } from '../realtime/gateway.js';
import { systemMessage } from './systemMessage.js';

/**
 * Detaches a player from whatever room they are sitting in.
 *
 * Shared by every entry point that puts a player somewhere new — creating a
 * room, joining one, and queueing for a quick match. **Being in a room should
 * never be a reason to refuse those**: clicking Quick Match while a finished
 * lobby is still on screen should take you to a new fight, not hand you an
 * error code. A dead end there is technically defensible and genuinely
 * annoying.
 *
 * That was not a hypothetical. `mm:join` used to reject with ALREADY_IN_ROOM,
 * and because a room stays alive in `post-match` after the fight ends, Quick
 * Match failed for every player who had already finished a match — the exact
 * moment they were most likely to want another one.
 */
export function leaveCurrentRoom(socket: GameSocket, ctx: RealtimeContext, io: GameServer): void {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const room = ctx.rooms.get(asRoomId(roomId));
  socket.data.roomId = null;
  void socket.leave(roomId);

  if (!room) return;

  const remaining = ctx.rooms.removeMember(room, socket.data.playerId);
  if (!remaining) return;

  // Losing a player mid-count means there is no longer a fight to start.
  if (!ctx.rooms.canStart(remaining) && ctx.rooms.abortCountdown(remaining)) {
    systemMessage(io, remaining, 'Countdown stopped — a player left');
  }

  io.to(remaining.id).emit('room:state', ctx.rooms.toState(remaining));
}
