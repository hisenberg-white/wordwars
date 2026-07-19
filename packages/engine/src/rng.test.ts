import { describe, expect, it } from 'vitest';
import { pickDeterministic, rollUnit } from './rng.js';

describe('rollUnit', () => {
  it('always returns a value in [0, 1)', () => {
    for (let i = 0; i < 5_000; i += 1) {
      const value = rollUnit(i * 7919, i % 2, i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is stable for the same coordinates', () => {
    expect(rollUnit(42, 0, 17)).toBe(rollUnit(42, 0, 17));
  });

  /**
   * Position-addressed, not sequential — the property the whole design rests
   * on. Value N must be computable without having drawn 0..N-1, because the
   * client predicts only its own words while the server resolves both.
   */
  it('computes any index in isolation', () => {
    const inOrder = Array.from({ length: 50 }, (_, i) => rollUnit(9, 0, i));
    const shuffled = [40, 3, 27, 11, 49, 0];

    for (const index of shuffled) {
      expect(rollUnit(9, 0, index)).toBe(inOrder[index]);
    }
  });

  it('varies across each coordinate independently', () => {
    expect(rollUnit(1, 0, 0)).not.toBe(rollUnit(2, 0, 0));
    expect(rollUnit(1, 0, 0)).not.toBe(rollUnit(1, 1, 0));
    expect(rollUnit(1, 0, 0)).not.toBe(rollUnit(1, 0, 1));
  });

  it('distributes roughly evenly across the unit interval', () => {
    const buckets = new Array<number>(10).fill(0);
    const samples = 50_000;

    for (let i = 0; i < samples; i += 1) {
      buckets[Math.floor(rollUnit(31337, 0, i) * 10)]! += 1;
    }

    // A clumped hash would make crit rates wrong in a way that is very hard to
    // notice by playing.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(samples / 10 - samples * 0.02);
      expect(count).toBeLessThan(samples / 10 + samples * 0.02);
    }
  });

  it('does not correlate consecutive indices', () => {
    let ascending = 0;
    const samples = 10_000;

    for (let i = 0; i < samples; i += 1) {
      if (rollUnit(5, 0, i + 1) > rollUnit(5, 0, i)) ascending += 1;
    }

    // A weak mix would trend; roughly half should ascend.
    expect(ascending / samples).toBeGreaterThan(0.45);
    expect(ascending / samples).toBeLessThan(0.55);
  });
});

describe('pickDeterministic', () => {
  const items = ['a', 'b', 'c', 'd'] as const;

  it('always picks from the list', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(items).toContain(pickDeterministic(items, 3, 0, i));
    }
  });

  it('is stable', () => {
    expect(pickDeterministic(items, 3, 1, 12)).toBe(pickDeterministic(items, 3, 1, 12));
  });

  it('uses the whole list', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(pickDeterministic(items, 3, 0, i));
    expect(seen.size).toBe(items.length);
  });

  it('handles a single-item list', () => {
    expect(pickDeterministic(['only'], 1, 0, 5)).toBe('only');
  });

  it('throws rather than returning undefined on an empty list', () => {
    expect(() => pickDeterministic([], 1, 0, 0)).toThrow();
  });
});
