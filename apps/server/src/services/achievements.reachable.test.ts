import { describe, expect, it } from 'vitest';
import type { PlayerId } from '@wordwars/shared';
import { applyWordAttempt, createMatchState, isTerminal, tick } from '@wordwars/engine';
import { ACHIEVEMENTS } from './achievements.js';

/**
 * Reachability.
 *
 * **An achievement nobody can earn is worse than no achievement at all** — it
 * is a promise the game breaks every time somebody chases it.
 *
 * `combo-100` shipped in the first draft of this catalogue and was literally
 * impossible: a match ends after roughly 45 words, so a 100-streak could never
 * happen. It was only caught by measuring instead of assuming. These tests run
 * the REAL engine and fail if a target drifts past what a match can produce.
 */

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;
const AVG_WORD_LENGTH = 7;

/** Plays a flawless match and reports the best a player could possibly do. */
function bestPossibleMatch(wpm: number, seed: number) {
  const state = createMatchState({ matchId: 'reach', seed, players: [A, B] });
  const msPerWord = (60_000 / wpm) * (AVG_WORD_LENGTH / 5);

  let now = 0;
  let index = 0;

  // Only one fighter acts, and never misses — the theoretical ceiling.
  while (!isTerminal(state) && now < 300_000) {
    now += msPerWord;
    applyWordAttempt(state, {
      playerId: A,
      wordIndex: index,
      wordLength: AVG_WORD_LENGTH,
      dirty: false,
      atMs: now,
    });
    index += 1;
    tick(state, now);
  }

  const fighter = state.fighters.find((f) => f.playerId === A)!;
  return { maxCombo: fighter.maxCombo, words: fighter.wordsTyped };
}

describe('every single-match target is achievable', () => {
  /** Across a range of speeds, since faster players finish in FEWER words. */
  const ceiling = Math.max(
    ...[70, 85, 100, 120, 150].flatMap((wpm) =>
      Array.from({ length: 40 }, (_, i) => bestPossibleMatch(wpm, i + 1).maxCombo),
    ),
  );

  it('has a measurable combo ceiling', () => {
    expect(ceiling).toBeGreaterThan(20);
  });

  it.each(ACHIEVEMENTS.filter((a) => a.id.startsWith('combo-')))(
    '$id is within what a match can produce',
    (achievement) => {
      expect(
        achievement.target,
        `${achievement.id} needs ${achievement.target}, ceiling is ${ceiling}`,
      ).toBeLessThanOrEqual(ceiling);
    },
  );

  /** Hard, but not so hard it is decoration. */
  it('keeps the hardest combo target genuinely demanding', () => {
    const hardest = Math.max(
      ...ACHIEVEMENTS.filter((a) => a.id.startsWith('combo-')).map((a) => a.target),
    );

    expect(hardest).toBeGreaterThan(ceiling * 0.7);
  });
});
