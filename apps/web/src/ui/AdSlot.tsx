import { useState } from 'react';
import { isCombatPhase, useAppPhase } from '@/store/appPhase';
import { cn } from './cn';

interface AdSlotProps {
  readonly placement: 'nav-banner' | 'results-footer';
  readonly className?: string;
  /** Allows the player to close the banner for the session. */
  readonly dismissible?: boolean;
}

/**
 * Advertising placement.
 *
 * Two rules are enforced here rather than by convention:
 *
 *   1. **Never during combat.** The component reads the app phase and returns
 *      null while a fight is live. A future screen cannot accidentally opt in.
 *   2. **Never in the player's way.** Ads are a thin, clearly-labelled strip
 *      outside gameplay. An ad that interrupts a match costs us the player, and
 *      the player is worth more than the impression.
 *
 * The real AdSense script lands in phase 5.4; this renders a labelled
 * placeholder with the correct dimensions so layout is settled long before an
 * external script starts influencing it.
 */
export function AdSlot({ placement, className, dismissible = true }: AdSlotProps) {
  const phase = useAppPhase();
  const [dismissed, setDismissed] = useState(false);

  if (isCombatPhase(phase)) return null;
  if (dismissed) return null;

  return (
    <aside
      aria-label="Advertisement"
      data-placement={placement}
      className={cn(
        'clip-notch relative flex h-14 items-center justify-center gap-3',
        'border border-line/60 bg-abyss/60 backdrop-blur-sm',
        className,
      )}
    >
      <span className="font-display text-[0.6rem] font-600 uppercase tracking-[0.25em] text-ink-faint">
        Advertisement
      </span>
      <span className="text-xs text-ink-faint/70">Ad space — never shown during a match</span>

      {dismissible && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss advertisement"
          className="absolute right-3 top-1/2 -translate-y-1/2 px-2 text-ink-faint transition-colors hover:text-ink"
        >
          ✕
        </button>
      )}
    </aside>
  );
}
