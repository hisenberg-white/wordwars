import type {
  CharacterId,
  ChatMessage,
  RoomSettings,
  RoomState,
  SocketErrorCode,
} from '@wordwars/shared';
import { connection } from './ConnectionManager';

export type RoomStatus = 'idle' | 'joining' | 'in-room' | 'error';

export interface RoomSnapshot {
  readonly status: RoomStatus;
  readonly room: RoomState | null;
  readonly error: SocketErrorCode | null;
  /** Set when the server wants a password we do not have. */
  readonly needsPassword: boolean;
  readonly messages: readonly ChatMessage[];
}

/**
 * Chat history is capped.
 *
 * An unbounded array in a long-lived lobby is a slow memory leak, and nobody
 * scrolls back 200 messages in a room they are about to leave.
 */
const MAX_MESSAGES = 100;

const IDLE: RoomSnapshot = {
  status: 'idle',
  room: null,
  error: null,
  needsPassword: false,
  messages: [],
};

class RoomManager {
  private readonly listeners = new Set<() => void>();
  private snapshot: RoomSnapshot = IDLE;
  private bound = false;

  private bind(): void {
    const socket = connection.socket;
    if (!socket || this.bound) return;
    this.bound = true;

    // The server is authoritative about room contents; we never mutate the
    // roster locally. Every membership change arrives as a full snapshot,
    // which removes any possibility of the client's view drifting.
    socket.on('room:state', (room) => {
      this.publish({ status: 'in-room', room, error: null, needsPassword: false });
    });

    socket.on('room:chat', (message) => {
      const next = [...this.snapshot.messages, message];
      this.publish({ messages: next.slice(-MAX_MESSAGES) });
    });

    socket.on('room:closed', () => this.publish(IDLE));
  }

  selectCharacter(characterId: CharacterId): void {
    connection.socket?.emit('room:character', { characterId }, () => {});
  }

  setReady(ready: boolean): void {
    connection.socket?.emit('room:ready', { ready }, () => {});
  }

  sendChat(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    connection.socket?.emit('room:chat', { text: trimmed.slice(0, 200) }, () => {});
  }

  kick(playerId: string): void {
    connection.socket?.emit('room:kick', { playerId }, () => {});
  }

  create(settings: RoomSettings, password?: string): Promise<RoomState | null> {
    this.bind();
    const socket = connection.socket;
    if (!socket?.connected) {
      this.publish({ status: 'error', error: 'INTERNAL' });
      return Promise.resolve(null);
    }

    this.publish({ ...IDLE, status: 'joining' });

    const payload = {
      settings: {
        mode: settings.mode,
        arenaId: settings.arenaId,
        randomArena: settings.randomArena,
        randomCharacter: settings.randomCharacter,
        difficulty: settings.difficulty,
        language: settings.language,
        roundCount: settings.roundCount,
        enableUltimate: settings.enableUltimate,
        enableCrits: settings.enableCrits,
        isPublic: settings.isPublic,
        maxPlayers: settings.maxPlayers,
        allowSpectators: settings.allowSpectators,
      },
      ...(password ? { password } : {}),
    };

    return new Promise((resolve) => {
      socket.timeout(8_000).emit('room:create', payload, (err, response) => {
        // Checked separately rather than as one disjunction: `err || !response.ok`
        // leaves TypeScript unable to narrow the Ack union, because the timeout
        // branch says nothing about the response's shape.
        if (err) {
          this.publish({ status: 'error', error: 'INTERNAL' });
          resolve(null);
          return;
        }

        if (!response.ok) {
          this.publish({ status: 'error', error: response.error.code });
          resolve(null);
          return;
        }

        this.publish({ status: 'in-room', room: response.data, error: null });
        resolve(response.data);
      });
    });
  }

  join(code: string, password?: string): Promise<RoomState | null> {
    this.bind();
    const socket = connection.socket;
    if (!socket?.connected) {
      this.publish({ status: 'error', error: 'INTERNAL' });
      return Promise.resolve(null);
    }

    this.publish({ ...IDLE, status: 'joining' });

    return new Promise((resolve) => {
      socket
        .timeout(8_000)
        .emit('room:join', { code, ...(password ? { password } : {}) }, (err, response) => {
          if (err) {
            this.publish({ status: 'error', error: 'INTERNAL' });
            resolve(null);
            return;
          }

          if (!response.ok) {
            this.publish({
              status: 'error',
              error: response.error.code,
              // A password prompt is a normal step, not a failure — the UI
              // shows an input rather than an error page.
              needsPassword: response.error.code === 'WRONG_PASSWORD',
            });
            resolve(null);
            return;
          }

          this.publish({ status: 'in-room', room: response.data, error: null });
          resolve(response.data);
        });
    });
  }

  leave(): void {
    connection.socket?.emit('room:leave', () => {});
    this.publish(IDLE);
  }

  reset(): void {
    this.publish(IDLE);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RoomSnapshot => this.snapshot;

  private publish(patch: Partial<RoomSnapshot>): void {
    const next = { ...this.snapshot, ...patch };

    const unchanged = (Object.keys(next) as Array<keyof RoomSnapshot>).every(
      (k) => next[k] === this.snapshot[k],
    );
    if (unchanged) return;

    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const roomManager = new RoomManager();
