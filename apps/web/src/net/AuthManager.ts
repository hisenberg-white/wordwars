import type { AuthenticatedUser } from '@wordwars/shared';
import { identity } from './IdentityManager';
import { API_BASE } from './serverUrl';

const STORAGE_KEY = 'wordwars.account';

export interface AuthSnapshot {
  readonly user: AuthenticatedUser | null;
  readonly status: 'unknown' | 'anonymous' | 'signed-in' | 'working';
  readonly error: string | null;
  /** True when the server is running without durable storage. */
  readonly ephemeral: boolean;
}

/**
 * Account session.
 *
 * Kept deliberately separate from `IdentityManager`. A guest identity and an
 * account are different things with different lifetimes: the guest token is
 * what lets a dropped player rejoin a match, and it must keep working whether
 * or not somebody has registered. Merging them would couple "can I reconnect"
 * to "am I logged in", which are not the same question.
 */
class AuthManager {
  private readonly listeners = new Set<() => void>();
  private snapshot: AuthSnapshot = {
    user: null,
    status: 'unknown',
    error: null,
    ephemeral: false,
  };

  /** Restores a session from a stored token, if one is still valid. */
  async restore(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.publish({ status: 'anonymous' });
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        // An expired or revoked token is not an error the player can act on —
        // drop it silently and let them carry on as a guest.
        this.clearToken();
        this.publish({ status: 'anonymous', user: null });
        return;
      }

      const body = (await response.json()) as { user: AuthenticatedUser; ephemeral: boolean };
      this.publish({ status: 'signed-in', user: body.user, ephemeral: body.ephemeral });
    } catch {
      this.publish({ status: 'anonymous' });
    }
  }

  async register(input: {
    email: string;
    username: string;
    password: string;
    /** Carries the guest identity so its match history is adopted. */
    guestToken?: string;
  }): Promise<boolean> {
    return this.submit('/api/auth/register', input);
  }

  async login(email: string, password: string): Promise<boolean> {
    return this.submit('/api/auth/login', { email, password });
  }

  private async submit(path: string, body: unknown): Promise<boolean> {
    this.publish({ status: 'working', error: null });

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as {
        user?: AuthenticatedUser;
        token?: string;
        expiresAt?: number;
        ephemeral?: boolean;
        error?: { message?: string; code?: string };
      };

      if (!response.ok || !payload.user || !payload.token) {
        this.publish({
          status: this.snapshot.user ? 'signed-in' : 'anonymous',
          error: payload.error?.message ?? 'Something went wrong. Try again.',
        });
        return false;
      }

      this.storeToken(payload.token, payload.expiresAt ?? Date.now() + 86_400_000);
      // Tell the live socket, so results start counting toward this account
      // without needing a reload.
      identity.attachAccount(payload.token);
      this.publish({
        status: 'signed-in',
        user: payload.user,
        error: null,
        ephemeral: payload.ephemeral ?? false,
      });
      return true;
    } catch {
      this.publish({
        status: this.snapshot.user ? 'signed-in' : 'anonymous',
        error: 'Could not reach the server.',
      });
      return false;
    }
  }

  signOut(): void {
    this.clearToken();
    this.publish({ status: 'anonymous', user: null, error: null });
  }

  token(): string | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as { token?: string; expiresAt?: number };
      if (typeof parsed.token !== 'string') return null;
      if (typeof parsed.expiresAt === 'number' && parsed.expiresAt <= Date.now()) {
        this.clearToken();
        return null;
      }

      return parsed.token;
    } catch {
      return null;
    }
  }

  private storeToken(token: string, expiresAt: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt }));
    } catch {
      /* Private browsing. The session simply will not survive a reload. */
    }
  }

  private clearToken(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Nothing to clear. */
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AuthSnapshot => this.snapshot;

  private publish(patch: Partial<AuthSnapshot>): void {
    const next = { ...this.snapshot, ...patch };

    const unchanged = (Object.keys(next) as Array<keyof AuthSnapshot>).every(
      (k) => next[k] === this.snapshot[k],
    );
    if (unchanged) return;

    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

export const authManager = new AuthManager();
