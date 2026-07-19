import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Difficulty } from '@wordwars/shared';
import { generateSentence, sentenceLength, wordBank, WORDS_PER_SENTENCE } from './sentences.js';

describe('generateSentence', () => {
  it('produces the requested number of words', () => {
    expect(generateSentence('normal', 1, 0)).toHaveLength(WORDS_PER_SENTENCE);
    expect(generateSentence('normal', 1, 0, 5)).toHaveLength(5);
  });

  /**
   * Both fighters must receive byte-identical text — that is what makes the
   * match a contest of skill rather than of luck.
   */
  it('is deterministic for the same seed and index', () => {
    expect(generateSentence('normal', 999, 3)).toEqual(generateSentence('normal', 999, 3));
  });

  it('differs between seeds and between indices', () => {
    expect(generateSentence('normal', 1, 0)).not.toEqual(generateSentence('normal', 2, 0));
    expect(generateSentence('normal', 1, 0)).not.toEqual(generateSentence('normal', 1, 1));
  });

  it('can rebuild any sentence without generating the ones before it', () => {
    const inOrder = Array.from({ length: 10 }, (_, i) => generateSentence('normal', 5, i));
    expect(generateSentence('normal', 5, 7)).toEqual(inOrder[7]);
  });

  it.each(DIFFICULTIES)('only ever emits words from the %s bank', (difficulty: Difficulty) => {
    const bank = new Set(wordBank(difficulty));

    for (let index = 0; index < 25; index += 1) {
      for (const word of generateSentence(difficulty, 42, index)) {
        expect(bank.has(word)).toBe(true);
      }
    }
  });

  /** "strike strike" reads like a bug and rewards muscle memory over reading. */
  it('never repeats a word back to back', () => {
    for (let index = 0; index < 200; index += 1) {
      const words = generateSentence('easy', 7, index);
      for (let i = 1; i < words.length; i += 1) {
        expect(words[i]).not.toBe(words[i - 1]);
      }
    }
  });

  it('draws widely from the bank rather than clumping', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 60; index += 1) {
      for (const word of generateSentence('normal', 3, index)) seen.add(word);
    }

    expect(seen.size).toBeGreaterThan(wordBank('normal').length / 2);
  });
});

describe('difficulty', () => {
  const averageLength = (difficulty: Difficulty) => {
    const bank = wordBank(difficulty);
    return bank.reduce((total, w) => total + w.length, 0) / bank.length;
  };

  /**
   * Difficulty has to change the FIGHT, not just the vocabulary. Longer words
   * hit harder in the engine, so this ordering is a gameplay guarantee.
   */
  it('escalates average word length from easy to hard', () => {
    expect(averageLength('easy')).toBeLessThan(averageLength('normal'));
    expect(averageLength('normal')).toBeLessThan(averageLength('hard'));
  });

  it('gives code difficulty awkward characters rather than long words', () => {
    const code = wordBank('code');
    const symbolHeavy = code.filter((w) => /[^a-zA-Z]/.test(w));

    expect(symbolHeavy.length).toBeGreaterThan(code.length / 3);
  });

  it.each(DIFFICULTIES)('has a %s bank large enough to avoid obvious repetition', (d) => {
    expect(wordBank(d).length).toBeGreaterThan(50);
  });

  it.each(DIFFICULTIES)('has no empty or whitespace-bearing words in %s', (d) => {
    for (const word of wordBank(d)) {
      expect(word.length).toBeGreaterThan(0);
      // A space inside a word would silently split it into two commits.
      expect(word).not.toMatch(/\s/);
    }
  });
});

describe('sentenceLength', () => {
  it('sums characters', () => {
    expect(sentenceLength(['ab', 'cde'])).toBe(5);
    expect(sentenceLength([])).toBe(0);
  });
});
