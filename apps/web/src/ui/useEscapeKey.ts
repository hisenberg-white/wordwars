import { useEffect } from 'react';

/**
 * Runs a handler when Escape is pressed.
 *
 * **Escape is the only key this game can safely bind.** Every letter, digit and
 * space is combat input — a player mid-fight is typing words, so a shortcut on
 * `B` for "back" would fire constantly while somebody was simply playing. That
 * rules out the usual single-letter accelerators everywhere, not only in the
 * arena, because the same screens are reachable mid-session.
 *
 * Escape has no such conflict: it is never part of a word, and players already
 * expect it to mean "get me out of this".
 */
export function useEscapeKey(handler: (() => void) | null): void {
  useEffect(() => {
    if (!handler) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      handler();
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handler]);
}
