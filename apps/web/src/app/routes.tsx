import type { ReactElement } from 'react';
import { ComingSoonScreen } from '@/features/placeholder/ComingSoonScreen';

/**
 * Routes that the landing page links to but which are not implemented yet.
 *
 * Kept in one list so the remaining work is visible at a glance, and so
 * deleting an entry is the natural final step of building the real screen.
 */
export const PENDING_ROUTES: ReadonlyArray<{
  path: string;
  element: ReactElement;
}> = [
  {
    path: '/leaderboard',
    element: (
      <ComingSoonScreen
        step="4.4"
        title="Leaderboard"
        description="Global, country, weekly and season rankings. Needs accounts and a stats pipeline first."
      />
    ),
  },
  {
    path: '/characters',
    element: (
      <ComingSoonScreen
        step="2.5"
        title="Fighters"
        description="Full roster with animation previews. Character selection arrives with the lobby."
      />
    ),
  },
  {
    path: '/arenas',
    element: (
      <ComingSoonScreen
        step="2.5"
        title="Arenas"
        description="Stage previews with their reactive effects. Arena selection arrives with the lobby."
      />
    ),
  },
  {
    path: '/settings',
    element: (
      <ComingSoonScreen
        step="5.5"
        title="Settings"
        description="Volume, typing sounds, graphics quality, reduced motion and accessibility options."
      />
    ),
  },
  {
    path: '/profile',
    element: (
      <ComingSoonScreen
        step="4.2"
        title="Profile"
        description="Stats, match history, achievements and XP. Guests can play forever; profiles need an account."
      />
    ),
  },
];
