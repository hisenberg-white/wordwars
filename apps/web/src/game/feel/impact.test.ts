import { describe, expect, it } from 'vitest';
import type { CombatEvent, PlayerId } from '@wordwars/shared';
import { combineFeel, feelFor, type FeelOptions } from './impact';

const ME = 'me' as PlayerId;
const THEM = 'them' as PlayerId;

const OPTS: FeelOptions = { reducedMotion: false, maxHp: 4000 };

const attack = (
  overrides: Partial<Extract<CombatEvent, { type: 'attack' }>> = {},
): CombatEvent => ({
  type: 'attack',
  t: 1,
  actor: ME,
  target: THEM,
  damage: 60,
  kind: 'punch',
  combo: 0,
  crit: false,
  weight: 0.6,
  ...overrides,
});

const ultimate: CombatEvent = { type: 'ultimate', t: 1, actor: ME, target: THEM, damage: 400 };
const knockout: CombatEvent = { type: 'knockout', t: 1, winner: ME, loser: THEM };

describe('hit stop', () => {
  it('freezes on a normal hit', () => {
    expect(feelFor(attack(), OPTS).hitStopMs).toBeGreaterThan(0);
  });

  /**
   * The hierarchy is the whole point. If a crit did not out-punch a jab, and
   * an Ultimate did not out-punch a crit, impacts would read as noise rather
   * than escalation.
   */
  it('escalates jab < heavy < crit < ultimate < knockout', () => {
    const jab = feelFor(attack({ weight: 0.1 }), OPTS).hitStopMs;
    const heavy = feelFor(attack({ weight: 1 }), OPTS).hitStopMs;
    const crit = feelFor(attack({ crit: true }), OPTS).hitStopMs;
    const ult = feelFor(ultimate, OPTS).hitStopMs;
    const ko = feelFor(knockout, OPTS).hitStopMs;

    expect(jab).toBeLessThan(heavy);
    expect(heavy).toBeLessThan(crit);
    expect(crit).toBeLessThan(ult);
    expect(ult).toBeLessThan(ko);
  });

  it('stays short enough to read as impact rather than lag', () => {
    expect(feelFor(attack({ weight: 1 }), OPTS).hitStopMs).toBeLessThanOrEqual(120);
  });

  /**
   * Freezing on a mistake would punish the player twice — once by breaking the
   * combo, again by interrupting the flow they are rebuilding.
   */
  it('never freezes on a miss', () => {
    const miss: CombatEvent = { type: 'miss', t: 1, actor: ME, comboLost: 9 };
    expect(feelFor(miss, OPTS).hitStopMs).toBe(0);
  });
});

describe('screen shake', () => {
  it('grows with damage', () => {
    const small = feelFor(attack({ damage: 30 }), OPTS).shake!;
    const large = feelFor(attack({ damage: 300 }), OPTS).shake!;

    expect(large.intensity).toBeGreaterThan(small.intensity);
  });

  /**
   * Feel must never cost legibility in a game where reading IS the input. An
   * uncapped shake makes a late-match Ultimate unreadable while the player is
   * still expected to type through it.
   */
  it('is capped so the text stays readable', () => {
    const enormous = feelFor(attack({ damage: 999_999, crit: true }), OPTS).shake!;
    expect(enormous.intensity).toBeLessThanOrEqual(0.012);
  });

  it('is suppressed entirely under reduced motion', () => {
    const reduced = { ...OPTS, reducedMotion: true };

    expect(feelFor(attack({ damage: 500 }), reduced).shake).toBeNull();
    expect(feelFor(ultimate, reduced).shake).toBeNull();
    expect(feelFor(knockout, reduced).shake).toBeNull();
  });

  it('still freezes under reduced motion, since hit stop is not motion', () => {
    expect(feelFor(attack(), { ...OPTS, reducedMotion: true }).hitStopMs).toBeGreaterThan(0);
  });

  it('skips imperceptible shakes rather than paying for them', () => {
    expect(feelFor(attack({ damage: 1, weight: 0 }), OPTS).shake).toBeNull();
  });

  /**
   * Regression: the reference point was originally 12% of a health bar, which
   * meant a typical early hit (~30 damage of 4000) produced NO shake at all —
   * the game felt flat for the first third of every match, which is exactly
   * when a new player decides whether they like it.
   */
  it('shakes even on a small early hit', () => {
    expect(feelFor(attack({ damage: 26 }), OPTS).shake).not.toBeNull();
  });
});

describe('damage numbers', () => {
  it('reports the damage dealt', () => {
    expect(feelFor(attack({ damage: 137 }), OPTS).damageNumber?.value).toBe(137);
  });

  it('makes a crit visibly larger', () => {
    const normal = feelFor(attack(), OPTS).damageNumber!;
    const crit = feelFor(attack({ crit: true }), OPTS).damageNumber!;

    expect(crit.scale).toBeGreaterThan(normal.scale);
    expect(crit.crit).toBe(true);
  });

  it('makes an ultimate larger still', () => {
    expect(feelFor(ultimate, OPTS).damageNumber!.scale).toBeGreaterThan(
      feelFor(attack({ crit: true }), OPTS).damageNumber!.scale,
    );
  });

  it('shows nothing for a miss or a knockout', () => {
    expect(feelFor({ type: 'miss', t: 1, actor: ME, comboLost: 3 }, OPTS).damageNumber).toBeNull();
    expect(feelFor(knockout, OPTS).damageNumber).toBeNull();
  });
});

describe('combining a batch', () => {
  /**
   * The bug this prevents: two hits landing in one 33ms flush freezing the
   * game for the SUM of both. Accumulating hit-stop during a fast exchange
   * turns the game into a slideshow at exactly the moment it should feel
   * fastest.
   */
  it('takes the maximum freeze, never the sum', () => {
    const a = feelFor(attack({ weight: 1 }), OPTS);
    const b = feelFor(attack({ crit: true }), OPTS);

    const combined = combineFeel([a, b]);

    expect(combined.hitStopMs).toBe(Math.max(a.hitStopMs, b.hitStopMs));
    expect(combined.hitStopMs).toBeLessThan(a.hitStopMs + b.hitStopMs);
  });

  it('takes the strongest shake', () => {
    const light = feelFor(attack({ damage: 30 }), OPTS);
    const heavy = feelFor(attack({ damage: 400 }), OPTS);

    expect(combineFeel([light, heavy]).shake!.intensity).toBe(heavy.shake!.intensity);
  });

  it('handles an empty batch', () => {
    expect(combineFeel([])).toEqual({ hitStopMs: 0, shake: null, damageNumber: null });
  });

  it('ignores events with no feel', () => {
    const miss = feelFor({ type: 'miss', t: 1, actor: ME, comboLost: 2 }, OPTS);
    const hit = feelFor(attack(), OPTS);

    expect(combineFeel([miss, hit]).hitStopMs).toBe(hit.hitStopMs);
  });
});
