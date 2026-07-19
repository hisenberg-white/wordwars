import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchScheduler, type Scheduled } from './MatchScheduler.js';

/**
 * The shared clock.
 *
 * Exists because the 5.8 load test showed the event loop degrading with the
 * NUMBER of matches rather than with how much anyone was typing — 200 nearly
 * idle matches hurt more than 100 busy ones. The cost was three timers per
 * match; this replaces all of them with three.
 */

function fake(): Scheduled & { flushes: number; snapshots: number; ticks: number; done: boolean } {
  return {
    flushes: 0,
    snapshots: 0,
    ticks: 0,
    done: false,
    flushDue() {
      this.flushes += 1;
    },
    snapshotDue() {
      this.snapshots += 1;
    },
    tickDue() {
      this.ticks += 1;
    },
    get isFinished() {
      return this.done;
    },
  };
}

let scheduler: MatchScheduler;

beforeEach(() => {
  vi.useFakeTimers();
  scheduler = new MatchScheduler(33, 100, 250);
});

afterEach(() => {
  scheduler.clear();
  vi.useRealTimers();
});

describe('driving matches', () => {
  it('beats every registered match at its own cadence', () => {
    const match = fake();
    scheduler.add(match);

    vi.advanceTimersByTime(1_000);

    expect(match.flushes).toBeGreaterThan(match.snapshots);
    expect(match.snapshots).toBeGreaterThan(match.ticks);
    expect(match.ticks).toBeGreaterThan(0);
  });

  it('drives many matches from the same clock', () => {
    const matches = Array.from({ length: 50 }, fake);
    for (const match of matches) scheduler.add(match);

    vi.advanceTimersByTime(500);

    expect(scheduler.size).toBe(50);
    for (const match of matches) expect(match.flushes).toBeGreaterThan(0);
  });

  it('stops beating a match once removed', () => {
    const match = fake();
    scheduler.add(match);
    vi.advanceTimersByTime(200);

    const seen = match.flushes;
    scheduler.remove(match);
    vi.advanceTimersByTime(500);

    expect(match.flushes).toBe(seen);
  });

  /** A finished match that kept ticking would broadcast into an empty room. */
  it('drops a match that reports itself finished', () => {
    const match = fake();
    scheduler.add(match);

    match.done = true;
    vi.advanceTimersByTime(200);

    expect(scheduler.size).toBe(0);
  });
});

describe('isolation', () => {
  /**
   * Every match shares this clock, so one throwing must not stop the others.
   * Before the shared scheduler a bad match could only break itself; now it
   * could freeze every fight on the server, which makes this the single most
   * important property of the file.
   */
  it('keeps serving other matches when one throws', () => {
    const healthy = fake();
    const broken = fake();
    broken.flushDue = () => {
      throw new Error('boom');
    };

    scheduler.add(broken);
    scheduler.add(healthy);

    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
    expect(healthy.flushes).toBeGreaterThan(0);
  });

  it('lets a match deregister itself mid-sweep', () => {
    const first = fake();
    const second = fake();

    first.flushDue = () => {
      scheduler.remove(second);
    };

    scheduler.add(first);
    scheduler.add(second);

    expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    expect(scheduler.size).toBe(1);
  });
});

describe('idling', () => {
  /** An empty server should not wake up 44 times a second for nothing. */
  it('runs no timers with no matches', () => {
    expect(vi.getTimerCount()).toBe(0);

    const match = fake();
    scheduler.add(match);
    expect(vi.getTimerCount()).toBe(3);

    scheduler.remove(match);
    expect(vi.getTimerCount()).toBe(0);
  });

  /** Three timers, whatever the match count — the whole point. */
  it('keeps exactly three timers no matter how many matches', () => {
    for (let i = 0; i < 200; i += 1) scheduler.add(fake());
    expect(vi.getTimerCount()).toBe(3);
  });
});
