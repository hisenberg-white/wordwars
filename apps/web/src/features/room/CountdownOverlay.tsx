import { useEffect, useState } from 'react';
import { connection } from '@/net/ConnectionManager';

/**
 * The 3 · 2 · 1 · FIGHT sequence.
 *
 * Driven by an absolute server deadline and `connection.serverNow()`, not by a
 * local timer counting down from three. Two players' machine clocks routinely
 * differ by seconds; without the offset correction from step 1.5, one screen
 * would show "2" while the other showed "1" — and in a game decided by
 * reaction, starting at different moments is a fairness bug, not a cosmetic one.
 *
 * Animates on requestAnimationFrame so the scale/fade tracks the real remaining
 * time rather than snapping on a one-second interval.
 */
export function CountdownOverlay({ endsAt }: { endsAt: number }) {
  const [remainingMs, setRemainingMs] = useState(() => endsAt - connection.serverNow());

  useEffect(() => {
    let frame = 0;

    const tick = () => {
      setRemainingMs(endsAt - connection.serverNow());
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [endsAt]);

  // 3000-2001ms → "3", 2000-1001 → "2", 1000-1 → "1", <=0 → FIGHT
  const count = Math.ceil(remainingMs / 1000);
  const isFight = remainingMs <= 0;

  // Progress through the current second, used to scale and fade each number so
  // it lands with weight instead of appearing.
  const withinSecond = isFight ? 0 : 1 - (remainingMs % 1000) / 1000;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-void/85 backdrop-blur-sm"
      role="status"
      aria-live="assertive"
      aria-label={isFight ? 'Fight' : `Starting in ${count}`}
    >
      {isFight ? (
        <span
          className="font-display text-7xl font-700 italic tracking-tight text-p1 sm:text-9xl"
          style={{ textShadow: '0 0 60px rgb(255 47 87 / 0.7)' }}
        >
          FIGHT!
        </span>
      ) : (
        <span
          key={count}
          className="font-display text-8xl font-700 tabular-nums text-ink sm:text-[10rem]"
          style={{
            // Starts large and settles — reads as an impact rather than a clock.
            transform: `scale(${1.35 - withinSecond * 0.35})`,
            opacity: 0.35 + (1 - withinSecond) * 0.65,
            textShadow: '0 0 50px rgb(0 224 255 / 0.45)',
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}
