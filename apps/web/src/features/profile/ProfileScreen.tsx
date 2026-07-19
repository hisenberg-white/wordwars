import { useEffect, useState } from 'react';
import { authManager } from '@/net/AuthManager';
import { useAuth } from '@/net/useConnection';
import { AuthDialog } from '@/features/auth/AuthDialog';
import { TopNav } from '@/features/landing/components/TopNav';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';

const API = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

interface ProfilePayload {
  user: { username: string; level: number; xp: number };
  progress: {
    level: number;
    xp: number;
    currentLevelAt: number;
    nextLevelAt: number;
    fraction: number;
  };
  stats: {
    matches: number;
    wins: number;
    losses: number;
    currentStreak: number;
    bestStreak: number;
    totalWords: number;
    bestCombo: number;
    bestWpm: number;
    avgWpm: number;
    avgAccuracyBp: number;
  } | null;
  history: Array<{
    id: string;
    startedAt: number;
    durationMs: number;
    self: { isWinner: boolean; avgWpm: number; accuracyBp: number; maxCombo: number } | null;
    opponent: { nickname: string } | null;
  }>;
}

export function ProfileScreen() {
  const { user, status } = useAuth();
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    if (!user) return;

    const token = authManager.token();
    if (!token) return;

    void fetch(`${API}/api/profile/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: ProfilePayload | null) => setProfile(body))
      .catch(() => setProfile(null));
  }, [user]);

  if (status === 'unknown') return <Shell>{null}</Shell>;

  /**
   * Signed out is not an error state.
   *
   * The game is fully playable without an account, so this reads as an
   * invitation rather than a wall — and it says exactly what an account buys,
   * instead of demanding one on principle.
   */
  if (!user) {
    return (
      <Shell>
        <Panel className="max-w-md p-8 text-center">
          <PanelLabel className="text-p2">Profile</PanelLabel>
          <h1 className="mt-3 text-2xl">Nothing to show yet</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">
            Profiles track your record, your best combo and your fastest match. Guests can play
            forever — an account is just where the numbers live.
          </p>
          <Button variant="primary" className="mt-6" onClick={() => setSignIn(true)}>
            Create a free account
          </Button>
        </Panel>
        {signIn && <AuthDialog onClose={() => setSignIn(false)} />}
      </Shell>
    );
  }

  const stats = profile?.stats;
  const progress = profile?.progress;
  const winRate = stats && stats.matches > 0 ? (stats.wins / stats.matches) * 100 : 0;

  return (
    <Shell>
      <div className="w-full max-w-3xl space-y-5">
        <Panel className="p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <PanelLabel className="text-p2">Fighter</PanelLabel>
              <h1 className="mt-2 font-display text-3xl font-700 text-ink">{user.username}</h1>
            </div>
            <span className="font-display text-4xl font-700 text-ultimate">
              Lv {progress?.level ?? user.level}
            </span>
          </div>

          {progress && (
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-xs text-ink-faint">
                <span>{progress.xp - progress.currentLevelAt} XP</span>
                <span>{progress.nextLevelAt - progress.currentLevelAt} to next</span>
              </div>
              <div className="h-2 w-full overflow-hidden bg-abyss">
                <div
                  className="h-full bg-ultimate transition-all duration-500"
                  style={{ width: `${progress.fraction * 100}%` }}
                />
              </div>
            </div>
          )}
        </Panel>

        {stats && stats.matches > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Record" value={`${stats.wins}–${stats.losses}`} />
              <Stat label="Win rate" value={`${winRate.toFixed(0)}%`} />
              <Stat label="Best combo" value={`${stats.bestCombo}`} accent />
              <Stat label="Best WPM" value={`${stats.bestWpm}`} accent />
              <Stat label="Average WPM" value={`${stats.avgWpm}`} />
              <Stat label="Accuracy" value={`${(stats.avgAccuracyBp / 100).toFixed(1)}%`} />
              <Stat label="Words landed" value={stats.totalWords.toLocaleString()} />
              <Stat label="Best streak" value={`${stats.bestStreak}`} />
            </div>

            {profile.history.length > 0 && (
              <Panel className="p-6">
                <PanelLabel>Recent matches</PanelLabel>
                <ul className="mt-3 space-y-1.5">
                  {profile.history.map((match) => (
                    <li
                      key={match.id}
                      className="flex items-center gap-3 border border-line/50 bg-abyss/40 px-4 py-2.5 text-sm"
                    >
                      <span
                        className={cn(
                          'font-display text-xs font-700 uppercase tracking-wider',
                          match.self?.isWinner ? 'text-success' : 'text-ink-faint',
                        )}
                      >
                        {match.self?.isWinner ? 'Win' : 'Loss'}
                      </span>
                      <span className="text-ink-dim">
                        vs {match.opponent?.nickname ?? 'a challenger'}
                      </span>
                      <span className="ml-auto tabular-nums text-ink-faint">
                        {match.self?.avgWpm ?? 0} wpm ·{' '}
                        {((match.self?.accuracyBp ?? 0) / 100).toFixed(0)}% ·{' '}
                        {(match.durationMs / 1000).toFixed(0)}s
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        ) : (
          <Panel className="p-8 text-center">
            <p className="text-sm text-ink-dim">
              No matches yet. Your record starts with the next fight.
            </p>
          </Panel>
        )}
      </div>
    </Shell>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Panel className="p-4">
      <div className="font-display text-[0.6rem] uppercase tracking-[0.2em] text-ink-faint">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-display text-2xl font-700 tabular-nums',
          accent ? 'text-p1' : 'text-ink',
        )}
      >
        {value}
      </div>
    </Panel>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex flex-1 items-start justify-center px-6 py-12">{children}</main>
    </div>
  );
}
