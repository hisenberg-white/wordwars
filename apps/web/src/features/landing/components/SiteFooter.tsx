import { Link } from 'react-router-dom';
import { Wordmark } from '@/ui/Wordmark';

const COLUMNS = [
  {
    heading: 'Play',
    links: [
      { to: '/play', label: 'Quick Match' },
      { to: '/room', label: 'Private Room' },
      { to: '/leaderboard', label: 'Leaderboard' },
    ],
  },
  {
    heading: 'Game',
    links: [
      { to: '/characters', label: 'Fighters' },
      { to: '/arenas', label: 'Arenas' },
      { to: '/settings', label: 'Settings' },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line/60 bg-abyss/40">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-12 sm:grid-cols-3">
        <div>
          <Wordmark size="sm" />
          <p className="mt-3 max-w-xs text-sm text-ink-dim">
            A fighting game where typing is the controller. Free to play, no account required.
          </p>
        </div>

        {COLUMNS.map(({ heading, links }) => (
          <div key={heading}>
            <h3 className="font-display text-[0.65rem] font-600 uppercase tracking-[0.2em] text-ink-faint">
              {heading}
            </h3>
            <ul className="mt-3 space-y-2">
              {links.map(({ to, label }) => (
                <li key={to}>
                  <Link to={to} className="text-sm text-ink-dim transition-colors hover:text-ink">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line/40 px-6 py-5">
        <p className="mx-auto max-w-7xl text-xs text-ink-faint">
          WordWars — built in the open. Phase 2 build.
        </p>
      </div>
    </footer>
  );
}
