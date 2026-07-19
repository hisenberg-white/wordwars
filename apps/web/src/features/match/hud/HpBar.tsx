import { useEffect, useRef } from 'react';
import { cn } from '@/ui/cn';

interface HpBarProps {
  readonly side: 'p1' | 'p2';
  readonly nickname: string;
  /** Registers a setter the HUD calls at up to 30Hz. */
  readonly bind: (update: (fraction: number, critical: boolean) => void) => void;
}

/**
 * A fighting-game health bar.
 *
 * **Writes the DOM directly through refs and never holds React state.** The
 * value changes many times a second during a busy exchange; routing that
 * through `useState` would re-render this component — and its siblings — on
 * every hit (plan §1.1 D3, §6.4).
 *
 * Two layers, which is the detail that makes damage legible from across a room:
 * a fast fill that snaps to the current value, and a slower "ghost" behind it
 * that drains a beat later. The gap between them IS the hit — you can see how
 * much you just lost, not merely where you ended up.
 */
export function HpBar({ side, nickname, bind }: HpBarProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const isP1 = side === 'p1';

  useEffect(() => {
    bind((fraction, critical) => {
      const percent = `${(fraction * 100).toFixed(1)}%`;

      if (fillRef.current) fillRef.current.style.width = percent;
      // The ghost catches up on a CSS transition, so it costs no JS per frame.
      if (ghostRef.current) ghostRef.current.style.width = percent;

      rootRef.current?.classList.toggle('is-critical', critical);
    });
  }, [bind]);

  return (
    <div
      ref={rootRef}
      className={cn('group flex flex-col gap-1.5', isP1 ? 'items-start' : 'items-end')}
    >
      <div className={cn('flex items-baseline gap-2', !isP1 && 'flex-row-reverse')}>
        <span
          className={cn(
            'font-display text-sm font-700 uppercase tracking-wider',
            isP1 ? 'text-p1' : 'text-p2',
          )}
        >
          {nickname}
        </span>
      </div>

      <div
        className={cn(
          'clip-notch relative h-5 w-full overflow-hidden border border-line-bright bg-abyss',
          !isP1 && 'scale-x-[-1]',
        )}
      >
        {/* Ghost: lags behind, showing what was just taken. */}
        <div
          ref={ghostRef}
          className="absolute inset-y-0 left-0 w-full bg-ink/45"
          style={{ transition: 'width 620ms cubic-bezier(0.22, 1, 0.36, 1) 180ms' }}
        />
        {/* Fill: snaps immediately. */}
        <div
          ref={fillRef}
          className={cn(
            'absolute inset-y-0 left-0 w-full',
            isP1 ? 'bg-p1' : 'bg-p2',
            'group-[.is-critical]:animate-pulse-glow',
          )}
          style={{ transition: 'width 90ms linear' }}
        />
      </div>
    </div>
  );
}
