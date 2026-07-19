import { describe, expect, it } from 'vitest';
import {
  attackKind,
  accuracyBpFromCounts,
  baseDamage,
  comboMultiplier,
  comboTier,
  computeDamage,
  critChance,
  impactWeight,
  rageMultiplier,
  rollCrit,
  tempoBonus,
  ultimateChargeGain,
  ultimateDamage,
} from './formulas.js';
import { MAX_HP, TEMPO_MAX, TEMPO_MIN } from './constants.js';

describe('baseDamage', () => {
  it('is flat below the length floor', () => {
    expect(baseDamage(0)).toBe(18);
    expect(baseDamage(1)).toBe(18);
    expect(baseDamage(3)).toBe(18);
  });

  it('grows 4 per character above the floor', () => {
    expect(baseDamage(4)).toBe(22);
    expect(baseDamage(5)).toBe(26);
    expect(baseDamage(8)).toBe(38);
  });

  it('caps so a pathological word cannot one-shot', () => {
    expect(baseDamage(12)).toBe(54);
    expect(baseDamage(30)).toBe(54);
    expect(baseDamage(200)).toBe(54);
  });
});

describe('comboTier / comboMultiplier', () => {
  it.each([
    [0, 0, 1.0],
    [4, 0, 1.0],
    [5, 1, 1.25],
    [9, 1, 1.25],
    [10, 2, 1.55],
    [19, 2, 1.55],
    [20, 3, 1.9],
    [34, 3, 1.9],
    [35, 4, 2.4],
    [100, 4, 2.4],
  ])('combo %i is tier %i (×%f)', (combo, tier, multiplier) => {
    expect(comboTier(combo)).toBe(tier);
    expect(comboMultiplier(combo)).toBe(multiplier);
  });

  it('never decreases as combo grows', () => {
    let previous = 0;
    for (let c = 0; c <= 60; c += 1) {
      expect(comboMultiplier(c)).toBeGreaterThanOrEqual(previous);
      previous = comboMultiplier(c);
    }
  });
});

describe('tempoBonus', () => {
  /**
   * The regression that matters most in this file.
   *
   * The plan's original divisor (400) put the entire useful curve between 100
   * and 300ms per word — 200 to 600 WPM. Every human sat on the floor, so the
   * mechanic silently became a flat penalty. These cases assert the curve
   * actually discriminates across the range real players occupy.
   */
  it('discriminates across real human typing speeds', () => {
    const at = (wpm: number) => tempoBonus(60_000 / wpm);

    expect(at(50)).toBeCloseTo(TEMPO_MIN, 2);
    expect(at(150)).toBeCloseTo(TEMPO_MAX, 2);

    // Strictly increasing in between — faster always beats slower.
    expect(at(60)).toBeGreaterThan(at(50));
    expect(at(80)).toBeGreaterThan(at(60));
    expect(at(100)).toBeGreaterThan(at(80));
    expect(at(120)).toBeGreaterThan(at(100));
  });

  it('is not pinned to a single value across the human range', () => {
    const values = [40, 60, 80, 100, 120].map((wpm) => tempoBonus(60_000 / wpm));
    expect(new Set(values).size).toBeGreaterThan(3);
  });

  it('clamps at both ends', () => {
    expect(tempoBonus(0)).toBe(TEMPO_MAX);
    expect(tempoBonus(-500)).toBe(TEMPO_MAX);
    expect(tempoBonus(10_000)).toBe(TEMPO_MIN);
  });
});

describe('critChance', () => {
  it('starts low and climbs with combo', () => {
    expect(critChance(0)).toBeCloseTo(0.07, 5);
    expect(critChance(10)).toBeCloseTo(0.1, 5);
  });

  it('caps so a long combo cannot crit constantly', () => {
    expect(critChance(60)).toBe(0.25);
    expect(critChance(500)).toBe(0.25);
  });
});

describe('rollCrit', () => {
  it('is deterministic for the same coordinates', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(rollCrit(1234, 0, i, 10)).toBe(rollCrit(1234, 0, i, 10));
    }
  });

  it('differs between the two fighters on the same word', () => {
    const left = Array.from({ length: 60 }, (_, i) => rollCrit(99, 0, i, 20));
    const right = Array.from({ length: 60 }, (_, i) => rollCrit(99, 1, i, 20));

    // If both slots rolled identically, crits would land in lockstep and look
    // obviously fake.
    expect(left).not.toEqual(right);
  });

  it('lands near the configured rate over many rolls', () => {
    const trials = 20_000;
    let crits = 0;
    for (let i = 0; i < trials; i += 1) if (rollCrit(7, 0, i, 0)) crits += 1;

    expect(crits / trials).toBeGreaterThan(0.05);
    expect(crits / trials).toBeLessThan(0.09);
  });
});

describe('ultimate economy', () => {
  it('charges faster at higher combo', () => {
    expect(ultimateChargeGain(20)).toBeGreaterThan(ultimateChargeGain(0));
  });

  it('takes a meaningful number of words to fill', () => {
    // At a typical mid-match combo, an Ultimate should be an event rather than
    // a routine occurrence.
    const perWord = ultimateChargeGain(12);
    expect(100 / perWord).toBeGreaterThan(15);
    expect(100 / perWord).toBeLessThan(30);
  });

  it('hits meaningfully harder than a normal strike', () => {
    const normal = computeDamage({
      wordLength: 5,
      combo: 20,
      deltaMs: 600,
      crit: false,
      rageMultiplier: 1,
    });

    expect(ultimateDamage(20)).toBeGreaterThan(normal * 3);
  });

  it('is a serious dent but never a one-shot', () => {
    expect(ultimateDamage(40)).toBeLessThan(MAX_HP * 0.25);
  });
});

describe('computeDamage', () => {
  it('treats a missing previous word as neutral tempo', () => {
    const first = computeDamage({
      wordLength: 5,
      combo: 0,
      deltaMs: null,
      crit: false,
      rageMultiplier: 1,
    });

    expect(first).toBe(26); // baseDamage(5) × 1.0 × 1.0
  });

  it('multiplies combo, tempo, crit and rage together', () => {
    const plain = computeDamage({
      wordLength: 5,
      combo: 0,
      deltaMs: 600,
      crit: false,
      rageMultiplier: 1,
    });
    const crit = computeDamage({
      wordLength: 5,
      combo: 0,
      deltaMs: 600,
      crit: true,
      rageMultiplier: 1,
    });
    const raging = computeDamage({
      wordLength: 5,
      combo: 0,
      deltaMs: 600,
      crit: false,
      rageMultiplier: 2,
    });

    expect(crit).toBeGreaterThan(plain);
    expect(raging).toBeCloseTo(plain * 2, -1);
  });

  it('never returns zero, so a landed hit always registers', () => {
    const damage = computeDamage({
      wordLength: 1,
      combo: 0,
      deltaMs: 60_000,
      crit: false,
      rageMultiplier: 0.0001,
    });

    expect(damage).toBeGreaterThanOrEqual(1);
  });

  it('always returns a whole number — HP is never fractional', () => {
    for (let len = 1; len <= 15; len += 1) {
      for (const combo of [0, 7, 22, 40]) {
        const d = computeDamage({
          wordLength: len,
          combo,
          deltaMs: 537,
          crit: combo % 2 === 0,
          rageMultiplier: 1.5,
        });
        expect(Number.isInteger(d)).toBe(true);
      }
    }
  });
});

describe('rageMultiplier', () => {
  const healthy = MAX_HP;

  it('is inactive before the first threshold', () => {
    expect(rageMultiplier(0, healthy, healthy, MAX_HP)).toBe(1);
    expect(rageMultiplier(89_999, healthy, healthy, MAX_HP)).toBe(1);
  });

  it('ramps at 90s and again at 120s', () => {
    expect(rageMultiplier(90_000, healthy, healthy, MAX_HP)).toBe(1.5);
    expect(rageMultiplier(120_000, healthy, healthy, MAX_HP)).toBe(2);
  });

  /**
   * Rage breaks stalemates. If someone is already losing badly there is no
   * stalemate — doubling damage would just deny them a comeback.
   */
  it('stays off when either fighter is already low', () => {
    const low = MAX_HP * 0.3;
    expect(rageMultiplier(120_000, low, healthy, MAX_HP)).toBe(1);
    expect(rageMultiplier(120_000, healthy, low, MAX_HP)).toBe(1);
  });
});

describe('impactWeight', () => {
  it('grows with word length', () => {
    expect(impactWeight(10, false)).toBeGreaterThan(impactWeight(3, false));
  });

  it('stays within the range the renderer expects', () => {
    for (let len = 0; len <= 30; len += 1) {
      const w = impactWeight(len, false);
      expect(w).toBeGreaterThanOrEqual(0.5);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('maxes out on a crit regardless of length', () => {
    expect(impactWeight(3, true)).toBe(1);
  });
});

describe('attackKind', () => {
  it('escalates with word length, so the fight reads without the text', () => {
    expect(['punch', 'kick']).toContain(attackKind(3, 1, 0, 0));
    expect(['slash', 'arrow']).toContain(attackKind(6, 1, 0, 0));
    expect(['fireball', 'magic']).toContain(attackKind(8, 1, 0, 0));
    expect(attackKind(12, 1, 0, 0)).toBe('laser');
  });

  it('is deterministic', () => {
    expect(attackKind(5, 42, 1, 9)).toBe(attackKind(5, 42, 1, 9));
  });
});

describe('accuracyBpFromCounts', () => {
  it('is zero before any attempt', () => {
    expect(accuracyBpFromCounts(0, 0)).toBe(0);
  });

  it('reports basis points', () => {
    expect(accuracyBpFromCounts(19, 1)).toBe(9500);
    expect(accuracyBpFromCounts(1, 0)).toBe(10_000);
  });
});
