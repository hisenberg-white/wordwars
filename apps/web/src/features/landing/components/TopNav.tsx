import { NavLink } from 'react-router-dom';
import { ConnectionBadge } from '@/ui/ConnectionBadge';
import { Wordmark } from '@/ui/Wordmark';
import { cn } from '@/ui/cn';

const LINKS = [
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/characters', label: 'Characters' },
  { to: '/settings', label: 'Settings' },
] as const;

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-void/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
        <NavLink to="/" className="shrink-0">
          <Wordmark size="sm" />
        </NavLink>

        <nav className="hidden items-center gap-1 md:flex">
          {LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'clip-tab px-4 py-2 font-display text-xs font-600 uppercase tracking-[0.15em]',
                  'transition-colors duration-150',
                  isActive
                    ? 'bg-raised text-ink'
                    : 'text-ink-dim hover:bg-raised/60 hover:text-ink',
                )
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <ConnectionBadge />
          {/* Guest identity chip lands in 2.2, once names actually exist. */}
          <NavLink
            to="/profile"
            className="clip-notch border border-line-bright px-4 py-2 font-display text-xs font-600 uppercase tracking-[0.15em] text-ink-dim transition-colors hover:border-p2 hover:text-ink"
          >
            Profile
          </NavLink>
        </div>
      </div>
    </header>
  );
}
