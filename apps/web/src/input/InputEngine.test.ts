import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputEngine, type TypingProgress, type WordCommit } from './InputEngine';

/**
 * Driven through real KeyboardEvent dispatch on a real EventTarget rather than
 * by calling methods directly. The engine's job is to interpret browser input,
 * so testing anything less than actual events would skip the part most likely
 * to be wrong — modifier handling, preventDefault, and which keys count.
 */

let engine: InputEngine;
let target: EventTarget;
let commits: WordCommit[];
let progress: TypingProgress[];
let clock: number;

const advance = (ms: number) => {
  clock += ms;
};

beforeEach(() => {
  clock = 1000;
  commits = [];
  progress = [];
  target = new EventTarget();

  engine = new InputEngine({ now: () => clock });
  engine.onCommit((c) => commits.push(c));
  engine.onProgress((p) => progress.push(p));
  engine.attach(target, 1000);
});

afterEach(() => engine.detach());

/** Dispatches a keydown and reports whether the default was prevented. */
function press(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function typeText(text: string, msPerKey = 50): void {
  for (const char of text) {
    advance(msPerKey);
    press(char);
  }
}

const last = <T>(items: T[]): T => items[items.length - 1]!;

describe('typing a word', () => {
  it('commits a clean word on space', () => {
    engine.pushSentence(['strike']);
    typeText('strike');
    press(' ');

    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ wordIndex: 0, word: 'strike', dirty: false });
  });

  it('advances through a sentence', () => {
    engine.pushSentence(['one', 'two', 'three']);

    typeText('one');
    press(' ');
    typeText('two');
    press(' ');

    expect(commits.map((c) => c.word)).toEqual(['one', 'two']);
    expect(engine.currentWord).toBe('three');
  });

  it('reports progress as characters land', () => {
    engine.pushSentence(['blade']);
    typeText('bl');

    expect(last(progress)).toMatchObject({
      expected: 'blade',
      typed: 'bl',
      correctChars: 2,
      dirty: false,
      valid: true,
    });
  });
});

describe('mistakes', () => {
  it('marks a word dirty the moment a wrong character lands', () => {
    engine.pushSentence(['blade']);
    typeText('bx');

    expect(last(progress)).toMatchObject({ dirty: true, valid: false, correctChars: 1 });
  });

  it('commits a mistyped word as dirty', () => {
    engine.pushSentence(['blade']);
    typeText('blxde');
    press(' ');

    expect(commits[0]).toMatchObject({ word: 'blade', dirty: true });
  });

  /**
   * Plan §4.2: backspace repairs the TEXT but not the RECORD. Hard-blocking is
   * frustrating and free repair is cheap — so the cost is the combo, not the
   * flow.
   */
  it('keeps a repaired word dirty', () => {
    engine.pushSentence(['blade']);
    typeText('blx');
    press('Backspace');
    typeText('ade');

    // On screen the word is now correct...
    expect(last(progress)).toMatchObject({ typed: 'blade', valid: true, dirty: true });

    press(' ');
    // ...but it still costs the combo.
    expect(commits[0]).toMatchObject({ word: 'blade', dirty: true });
  });

  it('commits an incomplete word as dirty', () => {
    engine.pushSentence(['strike']);
    typeText('str');
    press(' ');

    expect(commits[0]).toMatchObject({ word: 'strike', dirty: true });
  });

  it('treats overtyping as dirty', () => {
    engine.pushSentence(['cat']);
    typeText('cats');
    press(' ');

    expect(commits[0]).toMatchObject({ dirty: true });
  });

  it('clears the dirty flag for the next word', () => {
    engine.pushSentence(['one', 'two']);
    typeText('onx');
    press(' ');
    typeText('two');
    press(' ');

    expect(commits.map((c) => c.dirty)).toEqual([true, false]);
  });
});

describe('backspace', () => {
  it('removes the last character', () => {
    engine.pushSentence(['blade']);
    typeText('bla');
    press('Backspace');

    expect(last(progress).typed).toBe('bl');
  });

  it('does nothing on an empty buffer', () => {
    engine.pushSentence(['blade']);
    press('Backspace');
    press('Backspace');

    expect(engine.currentWord).toBe('blade');
    expect(commits).toHaveLength(0);
  });

  /** Otherwise the browser navigates back and the player loses the match. */
  it('always prevents the browser default', () => {
    engine.pushSentence(['blade']);
    expect(press('Backspace')).toBe(true);
  });
});

describe('space', () => {
  /**
   * The failure this prevents is severe: without it, holding space marches
   * through the entire text at the key-repeat rate, burning every word as a
   * miss and losing the match without a character being typed.
   */
  it('ignores an empty commit rather than counting a miss', () => {
    engine.pushSentence(['one', 'two', 'three']);

    for (let i = 0; i < 10; i += 1) press(' ');

    expect(commits).toHaveLength(0);
    expect(engine.currentWord).toBe('one');
  });

  /** Otherwise the page scrolls under the player on every word. */
  it('always prevents the browser default', () => {
    engine.pushSentence(['blade']);
    expect(press(' ')).toBe(true);
  });

  it('recognises space by code as well as key', () => {
    engine.pushSentence(['hit']);
    typeText('hit');

    const event = new KeyboardEvent('keydown', {
      key: 'Unidentified',
      code: 'Space',
      cancelable: true,
    });
    target.dispatchEvent(event);

    expect(commits).toHaveLength(1);
  });
});

describe('which keys count', () => {
  it('ignores non-printable keys', () => {
    engine.pushSentence(['blade']);

    for (const key of ['Shift', 'Tab', 'ArrowLeft', 'F5', 'Enter', 'CapsLock', 'Escape']) {
      press(key);
    }

    expect(last(progress).typed).toBe('');
  });

  /** Trapping Ctrl+R or Cmd+Tab would strand the player in the page. */
  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['alt', { altKey: true }],
  ])('lets %s shortcuts through untouched', (_label, modifiers) => {
    engine.pushSentence(['blade']);

    const prevented = press('r', modifiers);

    expect(prevented).toBe(false);
    expect(last(progress).typed).toBe('');
  });

  /** Acting on composition keystrokes double-types on IME keyboards. */
  it('ignores keystrokes mid-composition', () => {
    engine.pushSentence(['blade']);
    press('b', { isComposing: true });

    expect(last(progress).typed).toBe('');
  });

  it('accepts punctuation and digits', () => {
    engine.pushSentence(["don't!", '42']);

    typeText("don't!");
    press(' ');
    typeText('42');
    press(' ');

    expect(commits.map((c) => c.dirty)).toEqual([false, false]);
  });

  it('is case sensitive', () => {
    engine.pushSentence(['Blade']);
    typeText('blade');
    press(' ');

    expect(commits[0]!.dirty).toBe(true);
  });
});

describe('timing capture', () => {
  it('reports inter-key deltas, not absolute times', () => {
    engine.pushSentence(['abc']);

    advance(100);
    press('a');
    advance(60);
    press('b');
    advance(80);
    press('c');
    press(' ');

    // Three keys produce two gaps; the absolute clock never leaves the client.
    expect(commits[0]!.timings).toEqual([60, 80]);
  });

  it('stamps the commit relative to match start', () => {
    engine.pushSentence(['go']);
    advance(2_500);
    typeText('go', 0);
    press(' ');

    expect(commits[0]!.atMs).toBe(2_500);
  });

  it('caps the timings array so a hostile client cannot flood us', () => {
    const capped = new InputEngine({ now: () => clock, maxTimings: 8 });
    const seen: WordCommit[] = [];
    capped.onCommit((c) => seen.push(c));
    capped.attach(target, 1000);
    capped.pushSentence(['abcdefghijklmnopqrstuvwxyz']);

    for (const char of 'abcdefghijklmnopqrstuvwxyz') {
      advance(10);
      press(char);
    }
    press(' ');

    expect(seen[0]!.timings.length).toBeLessThanOrEqual(8);
    capped.detach();
  });

  it('starts each word with a fresh timing window', () => {
    engine.pushSentence(['ab', 'cd']);

    typeText('ab', 30);
    press(' ');
    typeText('cd', 90);
    press(' ');

    expect(commits[0]!.timings).toEqual([30]);
    expect(commits[1]!.timings).toEqual([90]);
  });
});

describe('streamed sentences', () => {
  it('treats a sentence boundary as invisible', () => {
    engine.pushSentence(['end']);
    engine.pushSentence(['next']);

    typeText('end');
    press(' ');

    // No pause, no round break — the next word is simply there.
    expect(engine.currentWord).toBe('next');
  });

  it('keeps word indices global across sentences', () => {
    engine.pushSentence(['a', 'b']);
    engine.pushSentence(['c']);

    typeText('a');
    press(' ');
    typeText('b');
    press(' ');
    typeText('c');
    press(' ');

    expect(commits.map((c) => c.wordIndex)).toEqual([0, 1, 2]);
  });

  it('announces when the player catches up to the streamed text', () => {
    const exhausted = vi.fn();
    engine.onExhausted(exhausted);
    engine.pushSentence(['only']);

    typeText('only');
    press(' ');

    expect(exhausted).toHaveBeenCalledOnce();
  });

  it('accepts no input while waiting for more text', () => {
    engine.pushSentence(['only']);
    typeText('only');
    press(' ');

    typeText('lost');
    press(' ');

    expect(commits).toHaveLength(1);
  });

  it('resumes when the next sentence arrives', () => {
    engine.pushSentence(['only']);
    typeText('only');
    press(' ');

    engine.pushSentence(['more']);
    typeText('more');
    press(' ');

    expect(commits.map((c) => c.word)).toEqual(['only', 'more']);
  });
});

describe('lifecycle', () => {
  it('stops listening once detached', () => {
    engine.pushSentence(['blade']);
    engine.detach();

    typeText('blade');
    press(' ');

    expect(commits).toHaveLength(0);
  });

  it('is safe to detach twice', () => {
    engine.detach();
    expect(() => engine.detach()).not.toThrow();
  });

  it('ignores a second attach rather than double-handling every key', () => {
    engine.attach(target, 1000);
    engine.pushSentence(['hit']);

    typeText('hit');
    press(' ');

    expect(commits).toHaveLength(1);
  });

  it('clears all state on reset', () => {
    engine.pushSentence(['one', 'two']);
    typeText('on');
    engine.reset();

    expect(engine.currentWord).toBeNull();
    expect(engine.remainingWords).toBe(0);
  });
});
