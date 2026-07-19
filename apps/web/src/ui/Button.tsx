import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: Size;
  readonly icon?: ReactNode;
  readonly fullWidth?: boolean;
}

/**
 * The primary action button.
 *
 * `primary` is intentionally loud — it is reserved for "Play Now" and the
 * handful of moments that actually start a fight. If every button on a screen
 * is primary, none of them are, and the player has to read instead of react.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-p1 text-white shadow-[0_0_28px_-4px_var(--color-p1)] hover:bg-p1-bright ' +
    'hover:shadow-[0_0_40px_-2px_var(--color-p1)] active:translate-y-px',
  secondary:
    'bg-raised text-ink border border-line-bright hover:bg-elevated hover:border-p2 ' +
    'active:translate-y-px',
  ghost: 'bg-transparent text-ink-dim hover:text-ink hover:bg-raised',
  danger: 'bg-transparent text-danger border border-danger/40 hover:bg-danger hover:text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-4 text-xs tracking-wider',
  md: 'h-11 px-6 text-sm tracking-wider',
  lg: 'h-14 px-10 text-base tracking-widest',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  fullWidth = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'clip-notch relative inline-flex items-center justify-center gap-2.5',
        'font-display font-600 uppercase',
        'transition-all duration-150 ease-[var(--ease-snap)]',
        'disabled:pointer-events-none disabled:opacity-40',
        'cursor-pointer select-none',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
