import type { PlayerIdentity, SessionToken } from '@wordwars/shared';
import type { ClientSocket } from './ConnectionManager';

const STORAGE_KEY = 'wordwars.session';

export interface IdentitySnapshot {
  readonly identity: PlayerIdentity | null;
  readonly status: 'unknown' | 'ready' | 'renaming';
  readonly error: string | null;
}

interface StoredSession {
  readonly token: string;
  readonly expiresAt: number;
}

/**
 * Owns the player's guest identity across reloads.
 *
 * The stored token is the whole identity — the server reconstructs everything
 * else from it. We deliberately do not cache the nickname separately: a single
 * source of truth means the UI can never show a stale name that the server has
 * already changed or rejected.
 *
 * Same architecture as ConnectionManager (plan §1.1 D3): a plain class, React
 * subscribes.
 */
class IdentityManager {
  private socket: ClientSocket | null = null;
  private readonly listeners = new Set<() => void>();

  private snapshot: IdentitySnapshot = {
    identity: null,
    status: 'unknown',
    error: null,
  };

  attach(socket: ClientSocket): void {
    if (this.socket === socket) return;
    this.socket = socket;

    // Re-announce on every connect, not just the first. A reconnect after a
    // server restart lands on a process that has never heard of this player,
    // and the token is what makes that recoverable rather than a silent
    // identity swap mid-session.
    socket.on('connect', () => this.announce());

    socket.on('session:issued', ({ identity, token }) => {
      this.persist(token);
      this.publish({ identity, status: 'ready', error: null });
    });

    if (socket.connected) this.announce();
  }

  /** Sends the stored token, if any, to establish or restore the identity. */
  private announce(): void {
    const stored = this.read();
    this.emitInit(stored ? { token: stored.token } : {});
  }

  rename(nickname: string): void {
    const stored = this.read();
    this.publish({ status: 'renaming', error: null });
    this.emitInit(stored ? { token: stored.token, nickname } : { nickname });
  }

  private emitInit(payload: { token?: string; nickname?: string }): void {
    const socket = this.socket;
    if (!socket?.connected) return;

    socket.timeout(5_000).emit('guest:init', payload, (err, response) => {
      if (err) {
        this.publish({ status: 'unknown', error: 'Could not reach the server' });
        return;
      }

      if (!response.ok) {
        // A rejected rename must not lose the identity the player already has.
        this.publish({
          status: this.snapshot.identity ? 'ready' : 'unknown',
          error: response.error.detail ?? 'That name was rejected',
        });
        return;
      }

      this.persist(response.data.token);
      this.publish({ identity: response.data.identity, status: 'ready', error: null });
    });
  }

  private read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as StoredSession).token !== 'string' ||
        typeof (parsed as StoredSession).expiresAt !== 'number'
      ) {
        return null;
      }

      const stored = parsed as StoredSession;
      if (stored.expiresAt <= Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      return stored;
    } catch {
      // Private browsing, disabled storage, or corrupted JSON. A player who
      // cannot persist an identity should still get to play — they just get a
      // new name each visit.
      return null;
    }
  }

  private persist(token: SessionToken): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ token: token.token, expiresAt: token.expiresAt }),
      );
    } catch {
      /* Storage unavailable — non-fatal, see read(). */
    }
  }

  /**
   * The raw guest token, for account registration.
   *
   * Handing it to the server is what lets a new account ADOPT the matches
   * already played as a guest — the payoff that makes the results-screen
   * prompt honest rather than a nag.
   */
  get storedToken(): string | null {
    return this.read()?.token ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): IdentitySnapshot => this.snapshot;

  private publish(patch: Partial<IdentitySnapshot>): void {
    const next = { ...this.snapshot, ...patch };

    if (
      next.identity === this.snapshot.identity &&
      next.status === this.snapshot.status &&
      next.error === this.snapshot.error
    ) {
      return;
    }

    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const identity = new IdentityManager();
