import { cn } from './cn';

interface WordmarkProps {
  readonly size?: 'sm' | 'md' | 'xl';
  readonly className?: string;
}

const SIZES = {
  sm: 'text-xl',
  md: 'text-3xl',
  xl: 'text-6xl md:text-8xl',
} as const;

/**
 * The WordWars wordmark.
 *
 * Split-coloured on purpose: WORD in cyan, WARS in crimson. The logo itself is
 * the two fighters facing each other, so the brand states the premise before a
 * single line of copy does.
 */
export function Wordmark({ size = 'md', className }: WordmarkProps) {
  return (
    <span
      className={cn(
        'font-display font-700 uppercase leading-none tracking-tight select-none',
        SIZES[size],
        className,
      )}
    >
      <span className="text-p2 text-glow-p2">Word</span>
      <span className="text-p1 text-glow-p1">Wars</span>
    </span>
  );
}
