import { describe, expect, it } from 'vitest';
import { CheatMonitor } from './CheatMonitor.js';

/**
 * The bar these tests hold the monitor to: **a fast, legitimate human must
 * never be flagged.** False positives cost us real players; a false negative
 * costs one reviewed match.
 */

/** Human-ish keystroke gaps: fast, but irregular the way hands are. */
function humanTimings(meanMs: number, count = 6, seed = 1): number[] {
  let r = seed;
  const rand = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return Array.from({ length: count }, () => Math.round(meanMs * (0.6 + rand() * 0.8)));
}

describe('legitimate players', () => {
  it('does not flag a fast typist at 140 WPM', () => {
    const monitor = new CheatMonitor();
    // 140 WPM ≈ 430ms per 6-char word ≈ 70ms per key.
    let at = 0;

    for (let i = 0; i < 40; i += 1) {
      at += 430;
      monitor.record(at, 6, humanTimings(70, 5, i + 1));
    }

    expect(monitor.flagged).toBe(false);
  });

  /**
   * 6 characters per word at 360ms is 200 WPM by the standard definition
   * (chars ÷ 5 per minute) — comfortably faster than almost anyone alive, and
   * still not a cheat.
   */
  it('does not flag a sustained burst at 200 WPM', () => {
    const monitor = new CheatMonitor();
    let at = 0;

    for (let i = 0; i < 20; i += 1) {
      at += 360;
      monitor.record(at, 6, humanTimings(60, 5, i + 7));
    }

    expect(monitor.flagged).toBe(false);
  });

  /** The world record territory. Fast, freakish, but a real person. */
  it('does not flag a world-record pace of 215 WPM', () => {
    const monitor = new CheatMonitor();
    let at = 0;

    for (let i = 0; i < 20; i += 1) {
      at += 335;
      monitor.record(at, 6, humanTimings(55, 5, i + 11));
    }

    expect(monitor.flagged).toBe(false);
  });

  it('does not flag an occasional very fast key pair', () => {
    const monitor = new CheatMonitor();

    // Key rollover genuinely produces one or two tiny gaps.
    monitor.record(400, 6, [3, 80, 70, 5, 90]);

    expect(monitor.flagged).toBe(false);
  });

  it('does not flag a short match that never fills the rate window', () => {
    const monitor = new CheatMonitor();
    for (let i = 0; i < 5; i += 1) monitor.record(i * 100, 8, humanTimings(60, 5, i));

    expect(monitor.flagged).toBe(false);
  });
});

describe('implausible input', () => {
  it('flags several impossible key gaps inside one word', () => {
    const monitor = new CheatMonitor();
    const flag = monitor.record(500, 6, [1, 2, 1, 2, 1]);

    expect(flag?.reason).toBe('impossible-key-gaps');
  });

  /** A script replaying a fixed interval has no jitter at all. */
  it('flags a perfectly mechanical rhythm', () => {
    const monitor = new CheatMonitor();
    const flag = monitor.record(900, 9, [40, 40, 40, 40, 40, 40, 40, 40]);

    expect(flag?.reason).toBe('mechanical-rhythm');
  });

  it('flags a sustained superhuman rate', () => {
    const monitor = new CheatMonitor();
    let at = 0;
    let flag = null;

    // 12 chars every 100ms ≈ 1440 WPM.
    for (let i = 0; i < 12 && !flag; i += 1) {
      at += 100;
      flag = monitor.record(at, 12, humanTimings(8, 5, i + 3));
    }

    expect(flag?.reason).toBeTruthy();
    expect(monitor.flagged).toBe(true);
  });

  it('accumulates flags and summarises them for the match record', () => {
    const monitor = new CheatMonitor();
    monitor.record(100, 6, [1, 1, 1, 1]);
    monitor.record(200, 6, [1, 1, 1, 1]);

    expect(monitor.reasons.length).toBe(2);
    expect(monitor.summarise()).toContain('impossible-key-gaps');
  });

  it('reports no summary for a clean player', () => {
    expect(new CheatMonitor().summarise()).toBeNull();
  });
});
