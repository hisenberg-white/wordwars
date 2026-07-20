import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { useEscapeKey } from './useEscapeKey';

/**
 * A full-screen modal layer, portalled to `document.body`.
 *
 * **The portal is the whole point, not a detail.** A dialog rendered in place
 * is at the mercy of its ancestors, and two ordinary CSS properties will break
 * it in ways that look like nothing at all:
 *
 *   - `backdrop-filter` / `filter` / `transform` on any ancestor makes THAT
 *     element the containing block for `position: fixed` descendants. A dialog
 *     with `fixed inset-0` then sizes itself to its ancestor's box instead of
 *     the viewport.
 *   - `position: sticky` with a `z-index`, or any ancestor that creates a
 *     stacking context, traps the dialog's own `z-index` inside it. `z-50`
 *     stops meaning "above everything" and starts meaning "above everything
 *     *in here*".
 *
 * Both were live in this app: `TopNav` is `sticky z-40 backdrop-blur-md`, and
 * it renders the account and identity chips — so the sign-in dialog and the
 * nickname dialog were being laid out inside the 64px header and painted
 * underneath the page. Portalling to `document.body` removes the entire class
 * of problem rather than fighting it with a bigger z-index.
 */

interface OverlayProps {
  readonly children: React.ReactNode;
  readonly onClose: () => void;
  readonly label: string;
  /** Extra classes for the backdrop, e.g. a different dim level. */
  readonly className?: string;
  /** Set false for overlays the player must not dismiss, like a countdown. */
  readonly dismissible?: boolean;
}

export function Overlay({ children, onClose, label, className, dismissible = true }: OverlayProps) {
  useEscapeKey(dismissible ? onClose : null);

  useEffect(() => {
    // The page behind a modal should not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={cn(
        'fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-void/85 p-6 backdrop-blur-sm',
        className,
      )}
      onClick={dismissible ? onClose : undefined}
    >
      {/*
        A visible way out, not only a keyboard one.

        Escape and a backdrop click both close this, and neither is discoverable:
        one is invisible and the other is a thing people learn to be afraid of,
        because plenty of dialogs treat a stray click as consent. A cross in the
        corner is the affordance everybody already knows.
      */}
      {dismissible && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="fixed right-5 top-5 z-10 grid h-9 w-9 place-items-center border border-line/60 bg-abyss/70 text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
        >
          <span aria-hidden className="text-lg leading-none">
            ×
          </span>
        </button>
      )}

      {/* Stops a click inside the panel from reaching the dismissing backdrop. */}
      <div onClick={(event) => event.stopPropagation()} className="contents">
        {children}
      </div>
    </div>,
    document.body,
  );
}
