import type { CharacterId, GameMode, PlayerIdentity } from '@wordwars/shared';
import { connection } from './ConnectionManager';

export type SearchStatus = 'idle' | 'searching' | 'found' | 'error';

export interface MatchmakingSnapshot {
  readonly status: SearchStatus;
  readonly queuedAt: number | null;
  readonly estimatedWaitMs: number | null;
  readonly opponent: PlayerIdentity | null;
  readonly roomId: string | null;
  readonly error: string | null;
}

const IDLE: MatchmakingSnapshot = {
  status: 'idle',
  queuedAt: null,
  estimatedWaitMs: null,
  opponent: null,
  roomId: null,
  error: null,
};

/**
 * Drives the quick-match flow.
 *
 * Note what this does NOT hold: elapsed search time. That ticks every frame and
 * belongs to the component rendering it — putting it here would re-render every
 * subscriber once a second for a number only one label cares about. The manager
 * holds `queuedAt` and lets the view derive elapsed time itself (plan §1.1 D3).
 */
class MatchmakingManager {
  private readonly listeners = new Set<() => void>();
  private snapshot: MatchmakingSnapshot = IDLE;
  private bound = false;

  private bind(): void {
    const socket = connection.socket;
    if (!socket || this.bound) return;
    this.bound = true;

    socket.on('mm:searching', ({ queuedAt, estimatedWaitMs }) => {
      this.publish({ status: 'searching', queuedAt, estimatedWaitMs, error: null });
    });

    socket.on('mm:found', ({ roomId, opponent }) => {
      this.publish({ status: 'found', roomId, opponent });
    });

    socket.on('mm:cancelled', () => this.publish(IDLE));

    // A dropped connection mid-search must not leave a spinner running
    // forever — the queue entry is already gone server-side.
    socket.on('disconnect', () => {
      if (this.snapshot.status === 'searching') {
        this.publish({ status: 'error', error: 'Lost connection while searching' });
      }
    });
  }

  search(mode: GameMode, characterId: CharacterId): void {
    this.bind();

    const socket = connection.socket;
    if (!socket?.connected) {
      this.publish({ status: 'error', error: 'Not connected' });
      return;
    }

    this.publish({ ...IDLE, status: 'searching', queuedAt: Date.now() });

    socket.timeout(8_000).emit('mm:join', { mode, characterId }, (err, response) => {
      if (err) {
        this.publish({ status: 'error', error: 'The server did not respond' });
        return;
      }
      if (!response.ok) {
        this.publish({ status: 'error', error: response.error.code });
      }
      // On success the server has already emitted `mm:searching`, which carries
      // the authoritative queue time and estimate.
    });
  }

  cancel(): void {
    connection.socket?.emit('mm:leave', () => {});
    this.publish(IDLE);
  }

  reset(): void {
    this.publish(IDLE);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MatchmakingSnapshot => this.snapshot;

  private publish(patch: Partial<MatchmakingSnapshot>): void {
    const next = { ...this.snapshot, ...patch };

    const unchanged = (Object.keys(next) as Array<keyof MatchmakingSnapshot>).every(
      (k) => next[k] === this.snapshot[k],
    );
    if (unchanged) return;

    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const matchmaking = new MatchmakingManager();
