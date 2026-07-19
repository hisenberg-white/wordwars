import type { Difficulty } from '@wordwars/shared';
import { CODE_WORDS, EASY_WORDS, HARD_WORDS, NORMAL_WORDS } from './words.js';

const BANKS: Readonly<Record<Difficulty, readonly string[]>> = {
  easy: EASY_WORDS,
  normal: NORMAL_WORDS,
  hard: HARD_WORDS,
  code: CODE_WORDS,
};

/**
 * Words per streamed sentence.
 *
 * Long enough that the server is not chattering, short enough that a
 * reconnecting player does not have to be re-sent a wall of text. Sentence
 * boundaries are invisible to the player either way (see InputEngine).
 */
export const WORDS_PER_SENTENCE = 12;

/**
 * Deterministic word selection.
 *
 * Same hash approach as the engine's RNG, and for a related reason: a match is
 * fully reproducible from its seed. That means a reconnecting client can be
 * handed byte-identical text without the server storing it, and a reported
 * match can be replayed later from seed alone.
 */
function hash(seed: number, a: number, b: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Builds sentence `index` for a match.
 *
 * Both fighters receive the exact same text — that is what makes the match a
 * race of skill rather than of luck (plan §"CORE GAMEPLAY").
 */
export function generateSentence(
  difficulty: Difficulty,
  seed: number,
  index: number,
  wordCount = WORDS_PER_SENTENCE,
): string[] {
  const bank = BANKS[difficulty];
  const words: string[] = [];

  let previous = -1;
  for (let i = 0; i < wordCount; i += 1) {
    let pick = hash(seed, index, i) % bank.length;

    // Avoid an immediate repeat: "strike strike" reads like a bug and lets a
    // player coast on muscle memory instead of reading.
    if (pick === previous) pick = (pick + 1) % bank.length;

    previous = pick;
    words.push(bank[pick]!);
  }

  return words;
}

/** Total characters in a sentence, for bandwidth and pacing estimates. */
export function sentenceLength(words: readonly string[]): number {
  return words.reduce((total, word) => total + word.length, 0);
}

export function wordBank(difficulty: Difficulty): readonly string[] {
  return BANKS[difficulty];
}
