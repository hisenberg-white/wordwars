import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopNav } from '@/features/landing/components/TopNav';
import { Panel, PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';
import { useEscapeKey } from '@/ui/useEscapeKey';
import { useAuth } from '@/net/useConnection';
import { API_BASE } from '@/net/serverUrl';

/**
 * The leaderboard.
 *
 * Public on purpose — standings are the game's shop window, and hiding them
 * behind an account would conceal the most persuasive argument for making one.
 *
 * Several boards rather than one, because "best player" is not a single number:
 * winning most and typing fastest are different achievements and deserve
 * different columns. The server owns every ranking decision; this screen only
 * renders what it is handed.
 */

type Unit = 'count' | 'percent' | 'wpm';

interface Category {
  id: string;
  name: string;
  description: string;
  minMatches: number;
  unit: Unit;
}

interface Row {
  rank: number;
  userId: string;
  username: string;
  countryCode: string | null;
  level: number;
  score: number;
  matches: number;
}

interface Board {
  category: string;
  period: string;
  rows: Row[];
  computedAt: number;
  minMatches: number;
}

const PERIODS = [
  { id: 'daily', label: 'Today' },
  { id: 'weekly', label: 'This Week' },
  { id: 'monthly', label: 'This Month' },
  { id: 'alltime', label: 'All Time' },
] as const;

export function LeaderboardScreen() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState('wins');
  const [period, setPeriod] = useState<string>('weekly');
  const [board, setBoard] = useState<Board | null>(null);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  // Escape returns to the menu — the only key this game can bind, since every
  // letter is combat input elsewhere in the app.
  useEscapeKey(() => void navigate('/'));

  useEffect(() => {
    void fetch(`${API_BASE}/api/leaderboard/categories`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { categories: Category[] } | null) => setCategories(body?.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    setLoading(true);

    void fetch(`${API_BASE}/api/leaderboard?category=${category}&period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Board | null) => setBoard(body))
      .catch(() => setBoard(null))
      .finally(() => setLoading(false));
  }, [category, period]);

  const active = categories.find((c) => c.id === category);

  return (
    <Shell>
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-3xl font-700 uppercase tracking-[0.2em] text-ink">
            Leaderboard
          </h1>
          {active && <p className="mt-1 text-sm text-ink-dim">{active.description}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Tab key={c.id} active={c.id === category} onClick={() => setCategory(c.id)}>
              {c.name}
            </Tab>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Tab key={p.id} small active={p.id === period} onClick={() => setPeriod(p.id)}>
              {p.label}
            </Tab>
          ))}
        </div>

        <Panel className="p-0">
          <div className="flex items-baseline justify-between border-b border-line/50 px-6 py-4">
            <PanelLabel>{active?.name ?? 'Standings'}</PanelLabel>
            {board && board.computedAt > 0 && (
              <span className="text-[0.65rem] text-ink-faint">
                updated {relativeTime(board.computedAt)}
              </span>
            )}
          </div>

          {loading ? (
            <Empty>Loading…</Empty>
          ) : !board || board.rows.length === 0 ? (
            /*
             * An empty board EXPLAINS itself.
             *
             * A blank list with no explanation reads as broken. Naming the
             * qualifier turns the same emptiness into an invitation — and on a
             * new server, the top of every board is genuinely up for grabs.
             */
            <Empty>
              {board && board.minMatches > 1
                ? `No one has played ${board.minMatches} matches in this period yet. Play ${board.minMatches} and the top spot is yours.`
                : 'No matches in this period yet. The first win takes first place.'}
            </Empty>
          ) : (
            <ol>
              {board.rows.map((row) => (
                <li
                  key={row.userId}
                  className={cn(
                    'flex items-center gap-4 border-b border-line/30 px-6 py-3 last:border-b-0',
                    // Finding yourself in a long list is the first thing anyone
                    // tries to do on a leaderboard.
                    user?.username === row.username && 'bg-p1/[0.07]',
                  )}
                >
                  <span
                    className={cn(
                      'w-8 shrink-0 font-display text-sm font-700 tabular-nums',
                      row.rank === 1 && 'text-ultimate',
                      row.rank === 2 && 'text-ink',
                      row.rank === 3 && 'text-p2',
                      row.rank > 3 && 'text-ink-faint',
                    )}
                  >
                    {row.rank}
                  </span>

                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {row.username}
                    {row.countryCode && (
                      <span className="ml-2 text-[0.65rem] uppercase tracking-wide text-ink-faint">
                        {row.countryCode}
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 text-[0.65rem] text-ink-faint">Lv {row.level}</span>

                  <span className="w-24 shrink-0 text-right text-[0.65rem] tabular-nums text-ink-faint">
                    {row.matches} {row.matches === 1 ? 'match' : 'matches'}
                  </span>

                  <span className="w-20 shrink-0 text-right font-display text-base font-700 tabular-nums text-p1">
                    {formatScore(row.score, active?.unit ?? 'count')}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        {active && active.minMatches > 1 && board && board.rows.length > 0 && (
          <p className="text-xs text-ink-faint">
            Needs {active.minMatches} matches in the period to qualify — otherwise a single lucky
            match would sit on top forever.
          </p>
        )}
      </div>
    </Shell>
  );
}

function formatScore(score: number, unit: Unit): string {
  if (unit === 'percent') return `${score}%`;
  if (unit === 'wpm') return `${score}`;
  return score.toLocaleString();
}

/** Coarse on purpose: boards rebuild on a timer, so a live clock would lie. */
function relativeTime(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function Tab({
  active,
  small = false,
  onClick,
  children,
}: {
  active: boolean;
  small?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'clip-tab border font-display uppercase tracking-[0.15em] transition-colors ease-[var(--ease-snap)]',
        small ? 'px-3 py-1.5 text-[0.6rem]' : 'px-4 py-2 text-[0.65rem]',
        active
          ? 'border-p1/60 bg-p1/15 text-p1'
          : 'border-line/50 bg-abyss/40 text-ink-faint hover:border-line-bright hover:text-ink-dim',
      )}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-12 text-center text-sm text-ink-dim">{children}</p>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex flex-1 items-start justify-center px-6 py-12">{children}</main>
    </div>
  );
}
