import { useEffect, useRef } from 'react';
import { cn } from '@/ui/cn';

interface ComboCounterProps {
  readonly side: 'p1' | 'p2';
  readonly bind: (update: (combo: number, tier: number) => void) => void;
}

/** Tier thresholds mirror the engine's COMBO_TIERS. */
const TIER_SCALE = [1, 1.08, 1.18, 1.3, 1.45];

/**
 * The combo counter.
 *
 * Hidden below 2, because "COMBO x1" on every single word would make the
 * number meaningless — it should appear when a streak becomes a streak.
 *
 * Punches on each increment via a direct style write plus a class toggle. The
 * scale grows with tier, so a 40-combo is physically larger on screen than a
 * 6-combo: the player reads their own momentum without parsing a number.
 */
export function ComboCounter({ side, bind }: ComboCounterProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    bind((combo, tier) => {
      const root = rootRef.current;
      const value = valueRef.current;
      if (!root || !value) return;

      if (combo < 2) {
        root.style.opacity = '0';
        root.style.transform = 'scale(0.8)';
        return;
      }

      value.textContent = String(combo);
      root.style.opacity = '1';
      root.style.transform = `scale(${TIER_SCALE[Math.min(tier, TIER_SCALE.length - 1)]})`;

      // Retrigger the pop by forcing a reflow between class removal and add —
      // otherwise consecutive hits at the same tier would not animate.
      root.classList.remove('combo-pop');
      void root.offsetWidth;
      root.classList.add('combo-pop');
    });
  }, [bind]);

  return (
    <div
      ref={rootRef}
      className={cn(
        'pointer-events-none flex items-baseline gap-1.5 opacity-0',
        side === 'p1' ? 'flex-row' : 'flex-row-reverse',
      )}
      style={{ transition: 'opacity 160ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' }}
    >
      <span
        className={cn(
          'font-display text-3xl font-700 tabular-nums leading-none',
          side === 'p1' ? 'text-p1' : 'text-p2',
        )}
        ref={valueRef}
      >
        0
      </span>
      <span className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-ink-faint">
        combo
      </span>
    </div>
  );
}
