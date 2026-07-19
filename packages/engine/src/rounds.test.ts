import { describe, expect, it } from 'vitest';
import type { PlayerId } from '@wordwars/shared';
import { MAX_HP } from './constants.js';
import {
  applyWordAttempt,
  createMatchState,
  isIntermission,
  isTerminal,
  roundsToWin,
  scoreOf,
  startNextRound,
  tick,
} from './match.js';
import type { EngineMatchState } from './types.js';

/**
 * Best-of-3 and best-of-5.
 *
 * The lobby has offered "Best of 3" since 2.5 and the server ignored it until
 * now — a setting that lies is worse than a setting that does not exist.
 */

const A = 'a' as PlayerId;
const B = 'b' as PlayerId;

const make = (roundCount: 1 | 3 | 5) =>
  createMatchState({ matchId: 'm', seed: 7, players: [A, B], roundCount });

/** Types clean words as `who` until the opponent drops. Returns ms elapsed. */
function winRound(state: EngineMatchState, who: PlayerId, from = 0): number {
  let now = from;
  const actor = state.fighters.find((f) => f.playerId === who)!;

  while (state.phase === 'combat') {
    now += 400;
    applyWordAttempt(state, {
      playerId: who,
      wordIndex: actor.wordIndex,
      wordLength: 7,
      dirty: false,
      atMs: now,
    });
  }

  return now;
}

describe('how many rounds win', () => {
  it('needs a majority', () => {
    expect(roundsToWin(1)).toBe(1);
    expect(roundsToWin(3)).toBe(2);
    expect(roundsToWin(5)).toBe(3);
  });
});

describe('best-of-1 is unchanged', () => {
  it('ends the match on the first knockout', () => {
    const state = make(1);
    winRound(state, A);

    expect(isTerminal(state)).toBe(true);
    expect(state.phase).toBe('knockout');
    expect(state.winnerId).toBe(A);
  });
});

describe('best-of-3', () => {
  it('pauses at an intermission rather than ending', () => {
    const state = make(3);
    winRound(state, A);

    expect(isTerminal(state)).toBe(false);
    expect(isIntermission(state)).toBe(true);
    expect(state.winnerId).toBeNull();
    expect(scoreOf(state)).toEqual([1, 0]);
  });

  it('reports the running score on the round-end event', () => {
    const state = make(3);
    const actor = state.fighters[0];

    let now = 0;
    let event;
    while (state.phase === 'combat') {
      now += 400;
      const delta = applyWordAttempt(state, {
        playerId: A,
        wordIndex: actor.wordIndex,
        wordLength: 7,
        dirty: false,
        atMs: now,
      });
      event = delta.events.find((e) => e.type === 'round-end');
    }

    expect(event).toMatchObject({
      type: 'round-end',
      winner: A,
      loser: B,
      round: 1,
      score: [1, 0],
    });
  });

  /** Two straight wins is a match, not a prompt for a third round. */
  it('ends after two straight rounds', () => {
    const state = make(3);

    const afterFirst = winRound(state, A);
    startNextRound(state, afterFirst + 3_000);
    winRound(state, A, afterFirst + 3_000);

    expect(isTerminal(state)).toBe(true);
    expect(state.winnerId).toBe(A);
    expect(scoreOf(state)).toEqual([2, 0]);
  });

  it('goes to a decider when the rounds are split', () => {
    const state = make(3);

    let now = winRound(state, A);
    startNextRound(state, (now += 3_000));
    now = winRound(state, B, now);

    expect(isTerminal(state)).toBe(false);
    expect(scoreOf(state)).toEqual([1, 1]);
    expect(state.round).toBe(2);

    startNextRound(state, (now += 3_000));
    expect(state.round).toBe(3);

    winRound(state, B, now);
    expect(isTerminal(state)).toBe(true);
    expect(state.winnerId).toBe(B);
  });
});

describe('best-of-5 needs three', () => {
  it('survives two losses', () => {
    const state = make(5);

    let now = 0;
    for (const winner of [A, B, A, B]) {
      now = winRound(state, winner, now);
      expect(isTerminal(state)).toBe(false);
      startNextRound(state, (now += 3_000));
    }

    expect(scoreOf(state)).toEqual([2, 2]);

    winRound(state, A, now);
    expect(isTerminal(state)).toBe(true);
    expect(state.winnerId).toBe(A);
  });
});

describe('what a new round resets', () => {
  it('restores full HP to both fighters', () => {
    const state = make(3);
    const now = winRound(state, A);

    expect(state.fighters[1]!.hp).toBe(0);

    startNextRound(state, now + 3_000);
    expect(state.fighters[0]!.hp).toBe(MAX_HP);
    expect(state.fighters[1]!.hp).toBe(MAX_HP);
  });

  /**
   * Carrying meter would let whoever was mid-charge when the round ended open
   * the next one with an instant Ultimate — an opening nobody can answer,
   * awarded for losing.
   */
  it('clears combo and Ultimate charge', () => {
    const state = make(3);
    const now = winRound(state, A);

    expect(state.fighters[0]!.combo).toBeGreaterThan(0);

    startNextRound(state, now + 3_000);
    for (const fighter of state.fighters) {
      expect(fighter.combo).toBe(0);
      expect(fighter.ultimateCharge).toBe(0);
      expect(fighter.ultimateReady).toBe(false);
    }
  });

  /** Or round two would be a replay of round one's text. */
  it('does NOT reset the word stream', () => {
    const state = make(3);
    const now = winRound(state, A);
    const reached = state.fighters[0]!.wordIndex;

    expect(reached).toBeGreaterThan(0);
    startNextRound(state, now + 3_000);
    expect(state.fighters[0]!.wordIndex).toBe(reached);
  });

  /** The results screen reports the whole match, not the last round of it. */
  it('does NOT reset career stats', () => {
    const state = make(3);
    const now = winRound(state, A);
    const typed = state.fighters[0]!.wordsTyped;
    const dealt = state.fighters[0]!.damageDealt;

    startNextRound(state, now + 3_000);
    expect(state.fighters[0]!.wordsTyped).toBe(typed);
    expect(state.fighters[0]!.damageDealt).toBe(dealt);
  });

  /**
   * Rage exists to stop ONE round dragging. Carried across a match it would
   * open round three at maximum multiplier and end it in seconds.
   */
  it('resets rage and measures it from the new round', () => {
    const state = make(3);
    const now = winRound(state, A);

    tick(state, now + 200_000); // deep into rage territory, but we are paused
    startNextRound(state, now + 3_000);
    expect(state.rageMultiplier).toBe(1);

    // A few seconds into the new round is still calm.
    tick(state, state.roundStartedMs + 5_000);
    expect(state.rageMultiplier).toBe(1);

    // Long into the new round, rage engages again.
    tick(state, state.roundStartedMs + 200_000);
    expect(state.rageMultiplier).toBeGreaterThan(1);
  });
});

describe('the intermission is not playable', () => {
  /** Scores nothing — but is consumed, not refused. See the in-flight tests. */
  it('scores nothing for words typed between rounds', () => {
    const state = make(3);
    winRound(state, A);

    const target = state.fighters[1]!;
    const hpBefore = target.hp;

    const delta = applyWordAttempt(state, {
      playerId: A,
      wordIndex: state.fighters[0]!.wordIndex,
      wordLength: 7,
      dirty: false,
      atMs: state.elapsedMs + 100,
    });

    expect(delta.rejected).toBe('intermission');
    expect(delta.events).toEqual([]);
    expect(target.hp).toBe(hpBefore);
  });

  it('does not tick rage while paused', () => {
    const state = make(3);
    const now = winRound(state, A);

    expect(tick(state, now + 500_000).events).toEqual([]);
    expect(state.rageMultiplier).toBe(1);
  });

  it('ignores a request to start a round that is already running', () => {
    const state = make(3);
    const now = winRound(state, A);

    startNextRound(state, now + 3_000);
    const round = state.round;

    startNextRound(state, now + 6_000); // already in combat
    expect(state.round).toBe(round);
  });
});

describe('words in flight when a round ends', () => {
  /**
   * THE bug that broke round two in the first live run.
   *
   * A client pauses input the moment it learns a round ended, but words already
   * on the wire cannot be recalled. If the server refused them, its word index
   * would fall one behind the client's — and every word of the next round would
   * be rejected as the wrong index. The player would silently stop being able
   * to play. So an intermission word is CONSUMED: no damage, but the index
   * still moves.
   */
  it('consumes the word and advances the index, scoring nothing', () => {
    const state = make(3);
    winRound(state, A);

    const actor = state.fighters[0]!;
    const before = actor.wordIndex;
    const damage = actor.damageDealt;

    const delta = applyWordAttempt(state, {
      playerId: A,
      wordIndex: before,
      wordLength: 7,
      dirty: false,
      atMs: state.elapsedMs + 50,
    });

    expect(delta.rejected).toBe('intermission');
    expect(delta.events).toEqual([]);
    expect(actor.wordIndex).toBe(before + 1);
    expect(actor.damageDealt).toBe(damage);
    expect(actor.wordsTyped).toBe(state.fighters[0]!.wordsTyped);
  });

  it('keeps client and server indices aligned across the round boundary', () => {
    const state = make(3);
    const now = winRound(state, A);
    const actor = state.fighters[0]!;

    // Three words were already on the wire when the round ended.
    let clientIndex = actor.wordIndex;
    for (let i = 0; i < 3; i += 1) {
      applyWordAttempt(state, {
        playerId: A,
        wordIndex: clientIndex,
        wordLength: 7,
        dirty: false,
        atMs: state.elapsedMs + i,
      });
      clientIndex += 1;
    }

    expect(actor.wordIndex).toBe(clientIndex);

    // The next round therefore opens on an index both sides agree on.
    startNextRound(state, now + 3_000);
    const delta = applyWordAttempt(state, {
      playerId: A,
      wordIndex: clientIndex,
      wordLength: 7,
      dirty: false,
      atMs: state.roundStartedMs + 300,
    });

    expect(delta.rejected).toBeUndefined();
    expect(delta.events.length).toBeGreaterThan(0);
  });
});
