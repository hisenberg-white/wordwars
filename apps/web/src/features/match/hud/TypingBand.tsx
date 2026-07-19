import { useEffect, useRef } from 'react';
import { gameBus } from '@/game/bus';
import { matchManager } from '@/net/MatchManager';

const WORDS_BEFORE = 4;
const WORDS_AFTER = 10;

/**
 * The text the player is fighting with.
 *
 * **The single most performance-sensitive element in the product.** It updates
 * on every keystroke — 10-15 times a second for a fast typist — so it is built
 * entirely with imperative DOM writes and holds NO React state. A `useState`
 * here would re-render on every character (plan §1.1 D3).
 *
 * It is also the element most at risk of turning this into a typing test, so
 * two rules from §0 apply: it is a thin band low on screen, and it carries no
 * WPM, no accuracy, no progress bar. The only feedback it gives is whether the
 * character you just typed was right — everything else is expressed by the
 * fighters and the HP bars.
 */
export function TypingBand() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /** Word index the DOM was last built for; -1 forces the first build. */
    let builtFor = -1;
    let activeWordEl: HTMLSpanElement | null = null;
    let charEls: HTMLSpanElement[] = [];

    /** Rebuilds the visible window. Runs once per WORD, not per keystroke. */
    const rebuild = (wordIndex: number) => {
      const { words, activeIndex } = matchManager.input.window(WORDS_BEFORE, WORDS_AFTER);

      host.replaceChildren();
      charEls = [];
      activeWordEl = null;

      words.forEach((word, i) => {
        const wordEl = document.createElement('span');
        wordEl.className = 'ww-word';

        if (i < activeIndex) wordEl.dataset['state'] = 'done';
        else if (i === activeIndex) wordEl.dataset['state'] = 'active';
        else wordEl.dataset['state'] = 'upcoming';

        if (i === activeIndex) {
          // Only the active word is split per character — the rest are plain
          // text nodes, which keeps the node count low.
          for (const char of word) {
            const charEl = document.createElement('span');
            charEl.textContent = char;
            charEl.className = 'ww-char';
            wordEl.appendChild(charEl);
            charEls.push(charEl);
          }
          activeWordEl = wordEl;
        } else {
          wordEl.textContent = word;
        }

        host.appendChild(wordEl);
      });

      builtFor = wordIndex;
    };

    const unsubscribe = gameBus.on('typing:progress', (progress) => {
      if (progress.wordIndex !== builtFor) rebuild(progress.wordIndex);

      // Per-keystroke work: only the active word's characters are touched, and
      // only their dataset attribute changes.
      for (let i = 0; i < charEls.length; i += 1) {
        const el = charEls[i]!;
        const state =
          i < progress.typed.length
            ? progress.typed[i] === progress.expected[i]
              ? 'hit'
              : 'wrong'
            : i === progress.typed.length
              ? 'cursor'
              : 'pending';

        if (el.dataset['state'] !== state) el.dataset['state'] = state;
      }

      // Overtyping past the end of the word still has to read as wrong.
      activeWordEl?.toggleAttribute('data-dirty', progress.dirty);
    });

    return () => {
      unsubscribe();
      host.replaceChildren();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="ww-band pointer-events-none flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 px-8 font-mono text-2xl leading-relaxed"
      aria-live="off"
    />
  );
}
