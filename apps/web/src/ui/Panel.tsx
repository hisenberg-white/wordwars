import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  /** Tints the panel toward a player's side of the rivalry. */
  readonly side?: 'p1' | 'p2' | null;
  readonly interactive?: boolean;
}

const SIDE_ACCENT = {
  p1: 'border-p1/30 bg-gradient-to-br from-p1/[0.07] to-transparent',
  p2: 'border-p2/30 bg-gradient-to-br from-p2/[0.07] to-transparent',
} as const;

/** Angular surface container. The building block for lobbies, cards and HUD. */
export function Panel({
  children,
  side = null,
  interactive = false,
  className,
  ...rest
}: PanelProps) {
  return (
    <div
      className={cn(
        'clip-panel border border-line bg-surface/80 backdrop-blur-sm',
        side && SIDE_ACCENT[side],
        interactive &&
          'transition-colors duration-150 hover:border-line-bright hover:bg-raised/80 cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Small uppercase label used above panel content. */
export function PanelLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'font-display text-[0.65rem] font-600 uppercase tracking-[0.2em] text-ink-faint',
        className,
      )}
    >
      {children}
    </span>
  );
}
