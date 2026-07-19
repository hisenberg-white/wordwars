import { randomUUID } from 'node:crypto';
import type { LiveRoom } from './RoomRegistry.js';
import type { GameServer } from '../realtime/gateway.js';

/**
 * A message from the room itself rather than from a player.
 *
 * Rendered differently in the lobby, so "a player left" cannot be spoofed by
 * somebody typing it into chat.
 */
export function systemMessage(io: GameServer, room: LiveRoom, text: string): void {
  io.to(room.id).emit('room:chat', {
    id: randomUUID(),
    playerId: null,
    nickname: 'System',
    text,
    at: Date.now(),
    system: true,
  });
}
