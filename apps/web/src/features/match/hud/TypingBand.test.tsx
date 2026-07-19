import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { gameBus } from '@/game/bus';
import { matchManager } from '@/net/MatchManager';
import { TypingBand } from './TypingBand';

/**
 * The band is the one component that must survive every keystroke, so it is
 * tested against the real DOM rather than by inspecting props.
 */

function emit(expected: string, typed: string, wordIndex: number, dirty = false) {
  act(() => {
    gameBus.emit('typing:progress', {
      wordIndex,
      expected,
      typed,
      correctChars: countMatching(expected, typed),
      dirty,
      valid: expected.startsWith(typed),
    });
  });
}

function countMatching(expected: string, typed: string): number {
  let n = 0;
  while (n < typed.length && expected[n] === typed[n]) n += 1;
  return n;
}

const chars = (container: HTMLElement) =>
  [...container.querySelectorAll('.ww-char')].map((el) => (el as HTMLElement).dataset['state']);

const words = (container: HTMLElement) =>
  [...container.querySelectorAll('.ww-word')].map((el) => (el as HTMLElement).dataset['state']);

beforeEach(() => {
  matchManager.input.reset();
  matchManager.input.pushSentence(['alpha', 'bravo', 'charlie', 'delta', 'echo']);
});

afterEach(() => {
  gameBus.clear();
  matchManager.input.reset();
});

describe('rendering the window', () => {
  it('shows past, present and future words', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', '', 0);

    const states = words(container);
    expect(states[0]).toBe('active');
    expect(states.filter((s) => s === 'upcoming').length).toBeGreaterThan(0);
  });

  /** Only the word being typed is split per character — the rest stay cheap. */
  it('splits only the active word into characters', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', '', 0);

    expect(chars(container)).toHaveLength('alpha'.length);
  });
});

describe('per-character feedback', () => {
  it('marks correct characters as hits', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'al', 0);

    expect(chars(container).slice(0, 2)).toEqual(['hit', 'hit']);
  });

  it('marks a wrong character', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'ax', 0);

    expect(chars(container).slice(0, 2)).toEqual(['hit', 'wrong']);
  });

  it('places the cursor on the next character to type', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'alp', 0);

    expect(chars(container)[3]).toBe('cursor');
  });

  it('leaves untouched characters pending', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'a', 0);

    expect(chars(container).slice(2)).toEqual(['pending', 'pending', 'pending']);
  });

  /** A repaired word looks right but still carries the mark. */
  it('flags a dirty word even once the text is correct', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'alpha', 0, true);

    const active = container.querySelector('.ww-word[data-state="active"]') as HTMLElement;
    expect(active.hasAttribute('data-dirty')).toBe(true);
  });

  it('clears the dirty flag when it no longer applies', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'alp', 0, true);
    emit('alpha', 'alp', 0, false);

    const active = container.querySelector('.ww-word[data-state="active"]') as HTMLElement;
    expect(active.hasAttribute('data-dirty')).toBe(false);
  });
});

describe('advancing', () => {
  it('rebuilds when the word changes', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', 'alpha', 0);

    // Move the engine's cursor as a real commit would.
    matchManager.input.reset();
    matchManager.input.pushSentence(['bravo', 'charlie']);
    emit('bravo', 'br', 0);

    expect(chars(container)).toHaveLength('bravo'.length);
    expect(chars(container).slice(0, 2)).toEqual(['hit', 'hit']);
  });
});

/**
 * The D3 promise, made observable.
 *
 * If a keystroke ever caused a React render, the whole subtree would be
 * replaced and these node identities would change. Holding a reference to a
 * character element and asserting it survives a burst of keystrokes is the
 * only way to prove the band is genuinely updating in place.
 */
describe('no re-render on keystroke', () => {
  it('mutates existing nodes instead of replacing them', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', '', 0);

    const firstChar = container.querySelector('.ww-char');
    const activeWord = container.querySelector('.ww-word[data-state="active"]');

    for (const typed of ['a', 'al', 'alp', 'alph', 'alpha']) emit('alpha', typed, 0);

    expect(container.querySelector('.ww-char')).toBe(firstChar);
    expect(container.querySelector('.ww-word[data-state="active"]')).toBe(activeWord);
    expect((firstChar as HTMLElement).dataset['state']).toBe('hit');
  });

  it('survives a long burst without accumulating nodes', () => {
    const { container } = render(<TypingBand />);
    emit('alpha', '', 0);

    const before = container.querySelectorAll('*').length;
    for (let i = 0; i < 200; i += 1) emit('alpha', i % 2 === 0 ? 'al' : 'alp', 0);

    expect(container.querySelectorAll('*').length).toBe(before);
  });
});

describe('cleanup', () => {
  it('empties itself and stops listening on unmount', () => {
    const { container, unmount } = render(<TypingBand />);
    emit('alpha', 'al', 0);

    unmount();
    expect(container.querySelectorAll('.ww-word')).toHaveLength(0);

    // Emitting after unmount must not throw.
    expect(() => emit('alpha', 'alp', 0)).not.toThrow();
  });
});
