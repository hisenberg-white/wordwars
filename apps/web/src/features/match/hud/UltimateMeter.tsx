import { useEffect, useRef } from 'react';
import { cn } from '@/ui/cn';

interface UltimateMeterProps {
  readonly side: 'p1' | 'p2';
  readonly bind: (update: (charge: number, ready: boolean) => void) => void;
}

/**
 * The Ultimate meter.
 *
 * Gold, and gold is used for nothing else in the entire product (design system
 * rule from 1.4). That exclusivity is the whole point: when this thing lights
 * up, the colour itself tells the player something rare is about to happen.
 */
export function UltimateMeter({ side, bind }: UltimateMeterProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    bind((charge, ready) => {
      if (fillRef.current) fillRef.current.style.width = `${Math.min(100, charge).toFixed(1)}%`;

      rootRef.current?.classList.toggle('is-ready', ready);
      if (labelRef.current) labelRef.current.textContent = ready ? 'ULTIMATE READY' : 'ULTIMATE';
    });
  }, [bind]);

  return (
    <div
      ref={rootRef}
      className={cn('group flex w-40 flex-col gap-1', side === 'p2' && 'items-end')}
    >
      <span
        ref={labelRef}
        className="font-display text-[0.55rem] font-600 uppercase tracking-[0.25em] text-ink-faint group-[.is-ready]:text-ultimate"
      >
        ULTIMATE
      </span>

      <div className="relative h-1.5 w-full overflow-hidden bg-abyss">
        <div
          ref={fillRef}
          className="absolute inset-y-0 left-0 w-0 bg-ultimate group-[.is-ready]:animate-pulse-glow"
          style={{ transition: 'width 220ms ease-out' }}
        />
      </div>
    </div>
  );
}
