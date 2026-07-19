import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameBus } from '@/game/bus';
import { audio } from './AudioEngine';
import { bindAudio } from './bindAudio';

/**
 * The mixer itself needs Web Audio, which jsdom does not provide — so these
 * tests assert what is testable without it: that the right sounds are REQUESTED
 * for the right input. `AudioEngine.play` is spied rather than mocked away, so
 * a change to the wiring still fails here.
 */

let played: string[];
let unbind: () => void;

beforeEach(() => {
  played = [];
  vi.spyOn(audio, 'play').mockImplementation((spec) => {
    played.push(spec.kind);
  });
  unbind = bindAudio();
});

afterEach(() => {
  unbind();
  gameBus.clear();
  vi.restoreAllMocks();
});

const progress = (typed: string, expected: string, wordIndex = 0) =>
  gameBus.emit('typing:progress', {
    wordIndex,
    expected,
    typed,
    correctChars: typed.length,
    dirty: false,
    valid: expected.startsWith(typed),
  });

describe('combat sounds', () => {
  it('plays a sound per combat event', () => {
    gameBus.emit('combat:events', {
      predicted: false,
      events: [
        { type: 'miss', t: 1, actor: 'a' as never, comboLost: 2 },
        { type: 'knockout', t: 2, winner: 'a' as never, loser: 'b' as never },
      ],
    });

    expect(played).toEqual(['miss', 'ko']);
  });

  it('stays silent for events that have no voice', () => {
    gameBus.emit('combat:events', {
      predicted: false,
      events: [{ type: 'rage', t: 1, multiplier: 2 }],
    });

    expect(played).toHaveLength(0);
  });
});

describe('keystroke ticks', () => {
  it('ticks once per new character', () => {
    progress('a', 'alpha');
    progress('al', 'alpha');
    progress('alp', 'alpha');

    expect(played).toEqual(['keystroke', 'keystroke', 'keystroke']);
  });

  it('uses the error voice for a wrong character', () => {
    progress('x', 'alpha');
    expect(played).toEqual(['keystroke-error']);
  });

  /**
   * The bug this prevents: holding backspace to clear a word would fire a tick
   * per deletion and sound like a drum roll.
   */
  it('is silent on backspace', () => {
    progress('alp', 'alpha');
    played.length = 0;

    progress('al', 'alpha');
    progress('a', 'alpha');
    progress('', 'alpha');

    expect(played).toHaveLength(0);
  });

  it('does not re-tick when a character is retyped after a backspace', () => {
    progress('al', 'alpha');
    progress('a', 'alpha');
    played.length = 0;

    progress('al', 'alpha');
    expect(played).toEqual(['keystroke']);
  });

  /** A new word restarts the length tracking, or its first key is missed. */
  it('ticks on the first character of the next word', () => {
    progress('alpha', 'alpha', 0);
    played.length = 0;

    progress('b', 'bravo', 1);
    expect(played).toEqual(['keystroke']);
  });
});

describe('teardown', () => {
  it('stops listening once unbound', () => {
    unbind();

    progress('a', 'alpha');
    gameBus.emit('combat:events', {
      predicted: false,
      events: [{ type: 'miss', t: 1, actor: 'a' as never, comboLost: 1 }],
    });

    expect(played).toHaveLength(0);
  });
});
