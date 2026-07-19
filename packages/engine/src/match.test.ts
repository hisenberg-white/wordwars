import { describe, expect, it } from 'vitest';
import type { AttackEvent, CombatEvent, PlayerId } from '@wordwars/shared';
import {
  accuracyBp,
  applyWordAttempt,
  averageWpm,
  createMatchState,
  isTerminal,
  tick,
} from './match.js';
import { MAX_HP, ULTIMATE_MAX_CHARGE } from './constants.js';
import type { EngineMatchState } from './types.js';

const ALICE = 'alice' as PlayerId;
const BOB = 'bob' as PlayerId;

const newMatch = (overrides: Partial<Parameters<typeof createMatchState>[0]> = {}) =>
  createMatchState({ matchId: 'm1', seed: 12345, players: [ALICE, BOB], ...overrides });

/** Commits the next word for a player, using their current index. */
function type(
  state: EngineMatchState,
  playerId: PlayerId,
  options: { length?: number; dirty?: boolean; atMs?: number } = {},
) {
  const fighter = state.fighters.find((f) => f.playerId === playerId)!;
  return applyWordAttempt(state, {
    playerId,
    wordIndex: fighter.wordIndex,
    wordLength: options.length ?? 5,
    dirty: options.dirty ?? false,
    atMs: options.atMs ?? (fighter.lastWordAtMs ?? 0) + 600,
  });
}

const attacksIn = (events: readonly CombatEvent[]): AttackEvent[] =>
  events.filter((e): e is AttackEvent => e.type === 'attack');

const fighterOf = (state: EngineMatchState, id: PlayerId) =>
  state.fighters.find((f) => f.playerId === id)!;

describe('createMatchState', () => {
  it('starts both fighters even', () => {
    const state = newMatch();

    expect(state.fighters).toHaveLength(2);
    expect(state.fighters.every((f) => f.hp === MAX_HP)).toBe(true);
    expect(state.fighters.every((f) => f.combo === 0)).toBe(true);
    expect(state.phase).toBe('combat');
    expect(state.winnerId).toBeNull();
    expect(isTerminal(state)).toBe(false);
  });

  it('gives the fighters distinct RNG slots', () => {
    const state = newMatch();
    expect(state.fighters[0].slot).not.toBe(state.fighters[1].slot);
  });

  it('honours a custom HP setting', () => {
    const state = newMatch({ maxHp: 500 });
    expect(state.fighters.every((f) => f.hp === 500)).toBe(true);
  });
});

describe('a clean word', () => {
  it('damages the opponent and leaves the attacker untouched', () => {
    const state = newMatch();
    const delta = type(state, ALICE);

    expect(delta.events.some((e) => e.type === 'attack')).toBe(true);
    expect(fighterOf(state, BOB).hp).toBeLessThan(MAX_HP);
    expect(fighterOf(state, ALICE).hp).toBe(MAX_HP);
  });

  it('advances combo and records stats', () => {
    const state = newMatch();
    type(state, ALICE, { length: 7 });

    const alice = fighterOf(state, ALICE);
    expect(alice.combo).toBe(1);
    expect(alice.maxCombo).toBe(1);
    expect(alice.wordsTyped).toBe(1);
    expect(alice.charsTyped).toBe(7);
    expect(alice.damageDealt).toBeGreaterThan(0);
  });

  /**
   * A word is scored at the combo the player HAD when they committed it — not
   * the one it earns them. Otherwise the very first word of a match would be
   * silently worth a 1× bonus it did not deserve, and every displayed combo
   * would be one ahead of the damage it produced.
   */
  it('scores at the combo held before the strike', () => {
    const state = newMatch();

    const first = attacksIn(type(state, ALICE).events)[0]!;
    const second = attacksIn(type(state, ALICE).events)[0]!;

    expect(first.combo).toBe(0);
    expect(second.combo).toBe(1);
  });

  it('emits a combo-tier event only when a boundary is crossed', () => {
    const state = newMatch();
    let tierEvents = 0;

    for (let i = 0; i < 12; i += 1) {
      const delta = type(state, ALICE);
      tierEvents += delta.events.filter((e) => e.type === 'combo-tier').length;
    }

    // Boundaries at 5 and 10 within the first 12 words.
    expect(tierEvents).toBe(2);
  });
});

describe('a mistyped word', () => {
  it('deals no damage and costs the combo', () => {
    const state = newMatch();
    for (let i = 0; i < 6; i += 1) type(state, ALICE);

    const hpBefore = fighterOf(state, BOB).hp;
    const delta = type(state, ALICE, { dirty: true });

    expect(fighterOf(state, BOB).hp).toBe(hpBefore);
    expect(fighterOf(state, ALICE).combo).toBe(0);
    expect(delta.events).toHaveLength(1);
    expect(delta.events[0]!.type).toBe('miss');
  });

  /** Plan §5.3 — the losing player must get MORE game, not less. */
  it('never damages the player who made it', () => {
    const state = newMatch();
    const hpBefore = fighterOf(state, ALICE).hp;

    for (let i = 0; i < 10; i += 1) type(state, ALICE, { dirty: true });

    expect(fighterOf(state, ALICE).hp).toBe(hpBefore);
  });

  it('preserves the best combo reached', () => {
    const state = newMatch();
    for (let i = 0; i < 8; i += 1) type(state, ALICE);
    type(state, ALICE, { dirty: true });

    const alice = fighterOf(state, ALICE);
    expect(alice.combo).toBe(0);
    expect(alice.maxCombo).toBe(8);
  });

  it('drains ultimate charge without going negative', () => {
    const state = newMatch();
    for (let i = 0; i < 20; i += 1) type(state, ALICE, { dirty: true });

    expect(fighterOf(state, ALICE).ultimateCharge).toBe(0);
  });

  it('still advances the word index, so play continues', () => {
    const state = newMatch();
    type(state, ALICE, { dirty: true });
    expect(fighterOf(state, ALICE).wordIndex).toBe(1);
  });
});

describe('word ordering', () => {
  /**
   * The anti-cheat floor. Without it a client could replay one word index
   * repeatedly and land unlimited hits.
   */
  it('refuses a replayed word index', () => {
    const state = newMatch();
    applyWordAttempt(state, {
      playerId: ALICE,
      wordIndex: 0,
      wordLength: 5,
      dirty: false,
      atMs: 100,
    });

    const replay = applyWordAttempt(state, {
      playerId: ALICE,
      wordIndex: 0,
      wordLength: 5,
      dirty: false,
      atMs: 150,
    });

    expect(replay.rejected).toBe('wrong-word-index');
    expect(replay.events).toHaveLength(0);
  });

  it('refuses a skipped word index', () => {
    const state = newMatch();
    const delta = applyWordAttempt(state, {
      playerId: ALICE,
      wordIndex: 7,
      wordLength: 5,
      dirty: false,
      atMs: 100,
    });

    expect(delta.rejected).toBe('wrong-word-index');
    expect(fighterOf(state, BOB).hp).toBe(MAX_HP);
  });

  it('refuses an unknown player', () => {
    const state = newMatch();
    const delta = applyWordAttempt(state, {
      playerId: 'stranger' as PlayerId,
      wordIndex: 0,
      wordLength: 5,
      dirty: false,
      atMs: 100,
    });

    expect(delta.rejected).toBe('unknown-player');
  });

  it('tracks the two players independently', () => {
    const state = newMatch();
    type(state, ALICE);
    type(state, ALICE);
    type(state, BOB);

    expect(fighterOf(state, ALICE).wordIndex).toBe(2);
    expect(fighterOf(state, BOB).wordIndex).toBe(1);
  });
});

describe('ultimate', () => {
  /** Types until the ultimate is ready, returning how many words it took. */
  function chargeUp(state: EngineMatchState, playerId: PlayerId): number {
    let words = 0;
    while (!fighterOf(state, playerId).ultimateReady && words < 200) {
      type(state, playerId);
      words += 1;
    }
    return words;
  }

  it('becomes ready after a meaningful run of clean words', () => {
    const state = newMatch();
    const words = chargeUp(state, ALICE);

    expect(fighterOf(state, ALICE).ultimateReady).toBe(true);
    expect(words).toBeGreaterThan(10);
    expect(words).toBeLessThan(40);
  });

  /**
   * The invariant rather than a fixed count: every announcement is redeemed by
   * exactly one Ultimate. A repeat announcement while already charged would
   * flash "ready" at a player who is already holding it.
   */
  it('announces once per Ultimate earned, never repeating while charged', () => {
    const state = newMatch({ maxHp: 1_000_000 });
    let announcements = 0;

    for (let i = 0; i < 120; i += 1) {
      announcements += type(state, ALICE).events.filter((e) => e.type === 'ultimate-ready').length;
    }

    const alice = fighterOf(state, ALICE);

    // Long enough to cycle several times, so the relationship is meaningful.
    expect(alice.ultimatesUsed).toBeGreaterThan(1);
    expect(announcements).toBe(alice.ultimatesUsed + (alice.ultimateReady ? 1 : 0));
  });

  it('does not re-announce on the word that consumes it', () => {
    const state = newMatch({ maxHp: 1_000_000 });
    while (!fighterOf(state, ALICE).ultimateReady) type(state, ALICE);

    const consuming = type(state, ALICE);

    expect(consuming.events.some((e) => e.type === 'ultimate')).toBe(true);
    expect(consuming.events.some((e) => e.type === 'ultimate-ready')).toBe(false);
  });

  it('fires on the next word and hits far harder than a normal strike', () => {
    const state = newMatch();
    chargeUp(state, ALICE);

    const hpBefore = fighterOf(state, BOB).hp;
    const delta = type(state, ALICE);

    const ultimate = delta.events.find((e) => e.type === 'ultimate');
    expect(ultimate).toBeDefined();
    expect(hpBefore - fighterOf(state, BOB).hp).toBeGreaterThan(200);
  });

  it('consumes the charge, so it cannot fire twice in a row', () => {
    const state = newMatch();
    chargeUp(state, ALICE);
    type(state, ALICE);

    const alice = fighterOf(state, ALICE);
    expect(alice.ultimateReady).toBe(false);
    expect(alice.ultimateCharge).toBeLessThan(ULTIMATE_MAX_CHARGE);
    expect(alice.ultimatesUsed).toBe(1);

    const next = type(state, ALICE);
    expect(next.events.some((e) => e.type === 'ultimate')).toBe(false);
  });

  it('can be disabled by room settings', () => {
    const state = newMatch({ enableUltimate: false });
    for (let i = 0; i < 60; i += 1) type(state, ALICE);

    const alice = fighterOf(state, ALICE);
    expect(alice.ultimateReady).toBe(false);
    expect(alice.ultimatesUsed).toBe(0);
    expect(alice.ultimateCharge).toBe(0);
  });
});

describe('critical hits', () => {
  it('can be disabled by room settings', () => {
    const state = newMatch({ enableCrits: false, enableUltimate: false });

    for (let i = 0; i < 80; i += 1) {
      const delta = type(state, ALICE);
      expect(attacksIn(delta.events).every((a) => !a.crit)).toBe(true);
      if (isTerminal(state)) break;
    }
  });

  it('occurs at all when enabled', () => {
    const state = newMatch({ maxHp: 1_000_000, enableUltimate: false });
    let crits = 0;

    for (let i = 0; i < 300; i += 1) {
      crits += attacksIn(type(state, ALICE).events).filter((a) => a.crit).length;
    }

    expect(crits).toBeGreaterThan(0);
  });
});

describe('knockout', () => {
  it('ends the match, names a winner, and floors HP at zero', () => {
    const state = newMatch({ maxHp: 30 });
    const delta = type(state, ALICE, { length: 12 });

    expect(delta.terminal).toBe(true);
    expect(delta.events.some((e) => e.type === 'knockout')).toBe(true);
    expect(state.phase).toBe('knockout');
    expect(state.winnerId).toBe(ALICE);
    expect(fighterOf(state, BOB).hp).toBe(0);
  });

  it('refuses any further action', () => {
    const state = newMatch({ maxHp: 30 });
    type(state, ALICE, { length: 12 });

    const after = type(state, BOB);
    expect(after.rejected).toBe('match-over');
    expect(after.events).toHaveLength(0);
  });

  it('is not declared while the loser still has a sliver of HP', () => {
    const state = newMatch({ maxHp: 4000 });
    const delta = type(state, ALICE);

    expect(delta.terminal).toBe(false);
    expect(fighterOf(state, BOB).hp).toBeGreaterThan(0);
  });
});

describe('rage', () => {
  it('engages once past the threshold and announces itself once', () => {
    const state = newMatch();

    expect(tick(state, 59_000).events).toHaveLength(0);

    const engaged = tick(state, 60_000);
    expect(engaged.events).toEqual([{ type: 'rage', t: expect.any(Number), multiplier: 2.5 }]);
    expect(state.rageMultiplier).toBe(2.5);

    // Same tier again — nothing new to say.
    expect(tick(state, 70_000).events).toHaveLength(0);

    expect(tick(state, 80_000).events[0]).toMatchObject({ type: 'rage', multiplier: 5 });
    expect(tick(state, 100_000).events[0]).toMatchObject({ type: 'rage', multiplier: 9 });
  });

  it('increases damage once active', () => {
    const calm = newMatch();
    type(calm, ALICE);
    const calmDamage = MAX_HP - fighterOf(calm, BOB).hp;

    const raging = newMatch();
    tick(raging, 60_000);
    type(raging, ALICE);
    const rageDamage = MAX_HP - fighterOf(raging, BOB).hp;

    expect(rageDamage).toBeGreaterThan(calmDamage);
  });

  it('does nothing once the match is over', () => {
    const state = newMatch({ maxHp: 30 });
    type(state, ALICE, { length: 12 });

    expect(tick(state, 200_000).events).toHaveLength(0);
  });
});

describe('determinism', () => {
  /**
   * The test that catches desync before players do (plan §10).
   *
   * The same seed and the same inputs must produce byte-identical events —
   * this is what makes it safe for the client to predict its own attacks while
   * the server independently computes the truth.
   */
  it('produces identical events for identical inputs', () => {
    const script: Array<{ player: PlayerId; length: number; dirty: boolean }> = Array.from(
      { length: 60 },
      (_, i) => ({
        player: i % 3 === 0 ? BOB : ALICE,
        length: 3 + (i % 9),
        dirty: i % 7 === 5,
      }),
    );

    const run = () => {
      const state = newMatch();
      const events: CombatEvent[] = [];

      for (const step of script) {
        if (isTerminal(state)) break;
        events.push(...type(state, step.player, { length: step.length, dirty: step.dirty }).events);
      }

      return { events, state };
    };

    const a = run();
    const b = run();

    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.state.fighters[0].hp).toBe(b.state.fighters[0].hp);
    expect(a.state.fighters[1].hp).toBe(b.state.fighters[1].hp);
  });

  it('produces different fights for different seeds', () => {
    const play = (seed: number) => {
      const state = newMatch({ seed });
      const crits: boolean[] = [];

      for (let i = 0; i < 80; i += 1) {
        crits.push(...attacksIn(type(state, ALICE).events).map((a) => a.crit));
        if (isTerminal(state)) break;
      }
      return crits;
    };

    expect(play(1)).not.toEqual(play(2));
  });

  /**
   * Order independence.
   *
   * The client resolves only its own words; the server interleaves both
   * players. A sequential PRNG would hand out different crits to each. This
   * asserts one fighter's results are unaffected by the other's activity.
   */
  it('gives a fighter the same rolls regardless of what the opponent does', () => {
    const solo = newMatch();
    const soloCrits: boolean[] = [];
    for (let i = 0; i < 25; i += 1) {
      soloCrits.push(...attacksIn(type(solo, ALICE).events).map((a) => a.crit));
    }

    const interleaved = newMatch();
    const interleavedCrits: boolean[] = [];
    for (let i = 0; i < 25; i += 1) {
      interleavedCrits.push(...attacksIn(type(interleaved, ALICE).events).map((a) => a.crit));
      type(interleaved, BOB);
      type(interleaved, BOB, { dirty: true });
    }

    expect(interleavedCrits).toEqual(soloCrits);
  });
});

describe('result statistics', () => {
  it('reports accuracy in basis points', () => {
    const state = newMatch();
    for (let i = 0; i < 19; i += 1) type(state, ALICE);
    type(state, ALICE, { dirty: true });

    expect(accuracyBp(fighterOf(state, ALICE))).toBe(9500);
  });

  it('reports zero accuracy before any attempt', () => {
    expect(accuracyBp(fighterOf(newMatch(), ALICE))).toBe(0);
  });

  it('computes average WPM from characters and elapsed time', () => {
    const state = newMatch();

    // 25 characters across 5 seconds = 300 chars/min. The standard definition
    // treats 5 characters as one "word", so that is exactly 60 WPM.
    for (let i = 0; i < 5; i += 1) type(state, ALICE, { length: 5, atMs: i * 1000 });

    expect(averageWpm(fighterOf(state, ALICE), 5000)).toBe(60);
  });

  it('reports zero average WPM when nothing was typed', () => {
    expect(averageWpm(fighterOf(newMatch(), ALICE), 10_000)).toBe(0);
  });

  /**
   * A KO on the very first word gives a zero-length window. Without the guard
   * this divides by zero and reports Infinity WPM on the results screen.
   */
  it('reports zero rather than Infinity for a zero-length window', () => {
    const state = newMatch();
    type(state, ALICE, { atMs: 5_000 });

    expect(averageWpm(fighterOf(state, ALICE), 5_000)).toBe(0);
    expect(averageWpm(fighterOf(state, ALICE), 4_000)).toBe(0);
  });

  it('tracks peak WPM from the fastest single word', () => {
    const state = newMatch();
    type(state, ALICE, { length: 5, atMs: 0 });
    type(state, ALICE, { length: 5, atMs: 1000 }); // 60 wpm
    type(state, ALICE, { length: 5, atMs: 1300 }); // 200 wpm

    expect(fighterOf(state, ALICE).peakWpm).toBeGreaterThan(150);
  });
});
