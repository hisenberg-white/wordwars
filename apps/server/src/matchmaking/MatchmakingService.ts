import type { CharacterId, GameMode, PlayerId, PlayerIdentity } from '@wordwars/shared';

export interface QueueEntry {
  readonly playerId: PlayerId;
  readonly identity: PlayerIdentity;
  readonly characterId: CharacterId;
  readonly mode: GameMode;
  readonly queuedAt: number;
}

export interface Pairing {
  readonly mode: GameMode;
  readonly players: readonly [QueueEntry, QueueEntry];
  readonly waitedMs: number;
}

/** Median of recent waits, used for the "about Xs" estimate on the search screen. */
const WAIT_SAMPLE_SIZE = 20;
const DEFAULT_ESTIMATE_MS = 8_000;

/**
 * Matchmaking queue.
 *
 * Knows nothing about sockets — it takes entries and hands back pairings
 * through a callback. That keeps the pairing rules unit-testable without a
 * network, which matters because the failure modes here (a player queued
 * twice, a paired player left in the queue, a pairing with itself) are the
 * kind that produce ghost matches rather than crashes.
 *
 * PAIRING RULE (v1): strict FIFO within a mode. No skill matching, because
 * with guests there is no skill signal to match on — a rating system needs
 * accounts and history, which arrive in phase 4. FIFO also gives the fairest
 * possible wait times, which matters far more than match quality while the
 * player base is small.
 *
 * SCALING SEAM: a single in-process Map. Multi-process matchmaking needs a
 * Redis sorted set keyed by queue time with an atomic pop of two entries. That
 * is a swap of this class's internals; `join`/`leave`/`onPaired` stay identical.
 */
export class MatchmakingService {
  private readonly queues = new Map<GameMode, QueueEntry[]>();
  private readonly queuedPlayers = new Map<PlayerId, GameMode>();
  private readonly recentWaits: number[] = [];

  constructor(private readonly onPaired: (pairing: Pairing) => void) {}

  isQueued(playerId: PlayerId): boolean {
    return this.queuedPlayers.has(playerId);
  }

  /**
   * Adds a player to the queue and pairs immediately if someone is waiting.
   *
   * Returns false if the player is already queued. Node is single-threaded, so
   * this whole method is atomic with respect to other joins — there is no
   * window in which two callers both see an empty queue.
   */
  join(entry: QueueEntry): boolean {
    if (this.queuedPlayers.has(entry.playerId)) return false;

    const queue = this.queues.get(entry.mode) ?? [];

    const opponent = queue.shift();
    if (opponent) {
      this.queues.set(entry.mode, queue);
      this.queuedPlayers.delete(opponent.playerId);

      const waitedMs = Date.now() - opponent.queuedAt;
      this.recordWait(waitedMs);

      this.onPaired({ mode: entry.mode, players: [opponent, entry], waitedMs });
      return true;
    }

    queue.push(entry);
    this.queues.set(entry.mode, queue);
    this.queuedPlayers.set(entry.playerId, entry.mode);
    return true;
  }

  leave(playerId: PlayerId): boolean {
    const mode = this.queuedPlayers.get(playerId);
    if (mode === undefined) return false;

    const queue = this.queues.get(mode);
    if (queue) {
      const index = queue.findIndex((e) => e.playerId === playerId);
      if (index >= 0) queue.splice(index, 1);
    }

    this.queuedPlayers.delete(playerId);
    return true;
  }

  /**
   * Estimated wait, in ms.
   *
   * Deliberately conservative: it is better to say "about 10 seconds" and pair
   * in 4 than to promise 2 and leave someone watching a spinner. When someone
   * is already waiting the estimate collapses to near-zero, because the next
   * joiner pairs instantly.
   */
  estimateWaitMs(mode: GameMode): number {
    const waiting = this.queues.get(mode)?.length ?? 0;
    if (waiting > 0) return 500;

    if (this.recentWaits.length === 0) return DEFAULT_ESTIMATE_MS;

    const sorted = [...this.recentWaits].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? DEFAULT_ESTIMATE_MS;
    return Math.max(1_000, median);
  }

  queueSize(mode: GameMode): number {
    return this.queues.get(mode)?.length ?? 0;
  }

  get totalQueued(): number {
    return this.queuedPlayers.size;
  }

  private recordWait(ms: number): void {
    this.recentWaits.push(ms);
    if (this.recentWaits.length > WAIT_SAMPLE_SIZE) this.recentWaits.shift();
  }
}
