import { useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { PanelLabel } from '@/ui/Panel';

/**
 * The waiting state.
 *
 * Matchmaking is dead time — the one moment in the product where the player is
 * doing nothing. So this screen does two things deliberately:
 *
 *   1. Shows a real elapsed counter rather than an indeterminate spinner.
 *      A number that moves reads as progress; a spinning circle reads as broken
 *      after about four seconds.
 *   2. Teaches. The rotating tips are how a first-time player learns that
 *      accuracy beats speed BEFORE their first fight, instead of losing one
 *      and not knowing why.
 */
const TIPS = [
  'A clean streak multiplies your damage. One typo resets it to nothing.',
  'Longer words hit harder. So do faster ones.',
  'You can repair a typo with backspace — but the word still breaks your combo.',
  'Perfect typing charges your Ultimate. The next word turns gold.',
  'Fighters are cosmetic. Nobody ever beat you because of their skin.',
  'Accuracy beats raw speed. Every time.',
] as const;

const TIP_INTERVAL_MS = 4_500;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

export function SearchingPanel({
  queuedAt,
  estimatedWaitMs,
  onCancel,
}: {
  queuedAt: number;
  estimatedWaitMs: number | null;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  // Ticks locally rather than through the store, so a once-a-second counter
  // does not re-render every matchmaking subscriber.
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - queuedAt), 250);
    return () => clearInterval(id);
  }, [queuedAt]);

  useEffect(() => {
    const id = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), TIP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const estimate = estimatedWaitMs !== null ? Math.round(estimatedWaitMs / 1000) : null;

  return (
    <div className="flex flex-col items-center text-center">
      <PanelLabel className="text-p2">Searching for an opponent</PanelLabel>

      {/* Two pulsing rings closing on each other — reads as "finding a match",
          and keeps the rivalry colours present even before an opponent exists. */}
      <div className="relative mt-10 grid h-40 w-40 place-items-center">
        <span
          className="absolute inset-0 animate-ping rounded-full border-2 border-p1/40"
          style={{ animationDuration: '2.2s' }}
        />
        <span
          className="absolute inset-4 animate-ping rounded-full border-2 border-p2/40"
          style={{ animationDuration: '2.2s', animationDelay: '1.1s' }}
        />
        <span className="font-display text-4xl font-700 tabular-nums text-ink">
          {formatElapsed(elapsed)}
        </span>
      </div>

      {estimate !== null && (
        <p className="mt-6 text-sm text-ink-dim">
          Usually about <span className="text-ink">{estimate}s</span>
        </p>
      )}

      <p
        key={tipIndex}
        className="animate-rise mt-8 h-12 max-w-sm text-balance text-sm leading-relaxed text-ink-faint"
      >
        {TIPS[tipIndex]}
      </p>

      <Button variant="ghost" size="sm" onClick={onCancel} className="mt-4">
        Cancel
      </Button>
    </div>
  );
}
