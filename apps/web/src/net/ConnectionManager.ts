import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@wordwars/shared';

/**
 * Note the generic order: socket.io-client is
 * `Socket<EventsItListensFor, EventsItEmits>`, which is the mirror image of the
 * server's. Getting this backwards compiles fine on one side and fails on the
 * other, so it is worth stating plainly.
 */
export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  /** Smoothed round-trip time in ms. Null until the first sample lands. */
  readonly ping: number | null;
  /** Server clock minus client clock. Added to `Date.now()` for server time. */
  readonly clockOffset: number;
}

const HEARTBEAT_INTERVAL_MS = 3_000;
const PING_WINDOW = 5;

/**
 * Owns the socket connection, liveness and clock synchronisation.
 *
 * Deliberately a plain class outside React, exposed through
 * `useSyncExternalStore`. This is the pattern the whole realtime layer follows
 * (plan §1.1 D3): network data lands in mutable state and only *coarse* changes
 * are published to React. During a match, keystrokes and combat events will
 * flow through the same shape — straight to Phaser, never through a setState.
 * Establishing it here, where the stakes are low, means the hot path in Phase 3
 * has an existing pattern to follow instead of inventing one under pressure.
 */
class ConnectionManager {
  private socketRef: ClientSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pingSamples: number[] = [];
  private readonly listeners = new Set<() => void>();

  private snapshot: ConnectionSnapshot = {
    status: 'idle',
    ping: null,
    clockOffset: 0,
  };

  /**
   * @param url Absolute server URL, or `undefined` for this page's own origin
   *   — which is what the dev proxy and any reverse proxy deployment want.
   */
  connect(url?: string): ClientSocket {
    if (this.socketRef) return this.socketRef;

    const socket: ClientSocket = io(url ?? '/', {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
      // Keep retrying indefinitely. A player who leaves a tab open through a
      // laptop sleep should find the game reconnected, not dead.
      reconnectionAttempts: Infinity,
      withCredentials: true,
    });

    this.socketRef = socket;
    this.publish({ status: 'connecting' });

    socket.on('connect', () => {
      this.publish({ status: 'connected' });
      this.startHeartbeat();
      void this.sampleClock();
    });

    socket.on('disconnect', () => {
      this.stopHeartbeat();
      this.pingSamples.length = 0;
      this.publish({ status: 'reconnecting', ping: null });
    });

    socket.io.on('reconnect_attempt', () => this.publish({ status: 'reconnecting' }));
    socket.io.on('error', () => this.publish({ status: 'offline' }));

    return socket;
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.socketRef?.disconnect();
    this.socketRef = null;
    this.pingSamples.length = 0;
    this.publish({ status: 'idle', ping: null });
  }

  get socket(): ClientSocket | null {
    return this.socketRef;
  }

  /**
   * Current server time, corrected for clock skew.
   *
   * Two players' machine clocks can differ by seconds. The match countdown and
   * every server timestamp are meaningless without this correction — using raw
   * `Date.now()` would start the fight at visibly different moments on the two
   * screens.
   */
  serverNow(): number {
    return Date.now() + this.snapshot.clockOffset;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ConnectionSnapshot => this.snapshot;

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => void this.sampleClock(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /**
   * One NTP-style round trip: measure RTT and estimate the clock offset,
   * assuming the trip is roughly symmetric.
   */
  private async sampleClock(): Promise<void> {
    const socket = this.socketRef;
    if (!socket?.connected) return;

    const sentAt = Date.now();

    socket.timeout(5_000).emit('match:heartbeat', { clientTime: sentAt }, (err, response) => {
      if (err || !response?.ok) return;

      const receivedAt = Date.now();
      const rtt = receivedAt - sentAt;
      const offset = response.data.serverTime - (sentAt + rtt / 2);

      this.pingSamples.push(rtt);
      if (this.pingSamples.length > PING_WINDOW) this.pingSamples.shift();

      this.publish({ ping: median(this.pingSamples), clockOffset: offset });
    });
  }

  private publish(patch: Partial<ConnectionSnapshot>): void {
    const next = { ...this.snapshot, ...patch };

    // useSyncExternalStore compares by reference and will loop forever if a new
    // object is returned for identical data. Bail out when nothing changed.
    if (
      next.status === this.snapshot.status &&
      next.ping === this.snapshot.ping &&
      next.clockOffset === this.snapshot.clockOffset
    ) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * Median rather than mean: a single stalled packet would drag an average
 * upward and make a healthy connection look bad for the next 15 seconds.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Module-level singleton — survives React StrictMode's double-mount in dev. */
export const connection = new ConnectionManager();
