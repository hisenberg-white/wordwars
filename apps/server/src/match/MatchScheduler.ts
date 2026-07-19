import { logger } from '../logger.js';

/**
 * One clock for every live match.
 *
 * **Written in response to a measurement, not a hunch.** The 5.8 load test
 * showed the event loop degrading with the NUMBER of matches rather than with
 * how much anyone was typing: 200 matches sitting nearly idle (40 words/second
 * between them) pushed loop p99 to 54ms, while 100 matches carrying twelve
 * times that traffic stayed flat at 25ms. The work was not the words. It was
 * the timers.
 *
 * Each match used to own three intervals — events at 30Hz, snapshots at 10Hz,
 * a tick at 4Hz — so N matches meant 3N timers and N × 44 callbacks per second
 * whether or not a single key was pressed. At 200 matches that is 600 timers
 * and ~8,800 wake-ups a second spent almost entirely on nothing.
 *
 * This replaces all of them with three. The per-match work is unchanged; what
 * disappears is the cost of asking Node to track thousands of independent
 * timers. Every live match shares one loop (plan §1.1 D2), so that overhead was
 * being paid by every fight on the server simultaneously.
 *
 * **The first attempt at this made things worse**, and the load test caught it:
 * loop p99 at 100 matches went from 24ms to 96ms. Per-match timers were
 * naturally staggered by whenever each match happened to start, so their work
 * was spread across the second. One shared clock synchronised all of them into
 * the same loop iteration — many small jobs became one thundering herd, which
 * is precisely what event-loop lag measures. Hence the sharding below: it is
 * not an optimisation, it is the thing that makes a shared clock viable at all.
 */

/**
 * How many slices each beat is spread over.
 *
 * Each match still gets flushed every `eventMs`; the scheduler simply visits a
 * quarter of them per sub-tick instead of all of them at once. Four keeps the
 * sub-interval comfortably above Windows' ~15.6ms timer resolution at the 33ms
 * event cadence, while cutting the per-iteration burst to a quarter.
 */
const SHARDS = 4;

export interface Scheduled {
  /** Flush queued combat events to the room. */
  flushDue(): void;
  /** Broadcast a reconciliation snapshot. */
  snapshotDue(): void;
  /** Advance match time — engages Rage without a word being typed. */
  tickDue(): void;
  readonly isFinished: boolean;
}

export class MatchScheduler {
  private readonly matches = new Set<Scheduled>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly cursors = { flush: 0, snapshot: 0, tick: 0 };

  constructor(
    private readonly eventMs: number,
    private readonly snapshotMs: number,
    private readonly tickMs: number,
  ) {}

  add(match: Scheduled): void {
    this.matches.add(match);
    if (this.timers.length === 0) this.startClock();
  }

  remove(match: Scheduled): void {
    this.matches.delete(match);
    // Idle servers should not tick. Nothing to drive means nothing to wake for.
    if (this.matches.size === 0) this.stopClock();
  }

  get size(): number {
    return this.matches.size;
  }

  private startClock(): void {
    // Sub-intervals: each fires SHARDS times per beat and serves one slice, so
    // a match's cadence is unchanged but the work is spread across the beat.
    this.timers = [
      setInterval(() => this.run('flush', (m) => m.flushDue()), Math.max(1, this.eventMs / SHARDS)),
      setInterval(
        () => this.run('snapshot', (m) => m.snapshotDue()),
        Math.max(1, this.snapshotMs / SHARDS),
      ),
      setInterval(() => this.run('tick', (m) => m.tickDue()), Math.max(1, this.tickMs / SHARDS)),
    ];

    // `unref` so a pending beat never holds the process open. Guarded because
    // fake-timer environments do not always implement it.
    for (const timer of this.timers) timer.unref?.();
  }

  private stopClock(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  /**
   * Drives one SLICE of the live matches.
   *
   * Only every SHARDS-th match is served per call, advancing the cursor each
   * time, so a given match is visited once per full beat while the cost of any
   * single loop iteration stays at a quarter of the fleet. Without this the
   * shared clock is measurably worse than the per-match timers it replaced.
   *
   * Each match is isolated: one throwing must not stop the others, because
   * they now share this clock and a single bad match could otherwise freeze
   * every fight on the server. Iterating a copy so a match that finishes
   * mid-sweep can deregister itself safely.
   */
  private run(which: keyof typeof this.cursors, beat: (match: Scheduled) => void): void {
    const slice = this.cursors[which];
    this.cursors[which] = (slice + 1) % SHARDS;

    let index = 0;

    for (const match of [...this.matches]) {
      const mine = index % SHARDS === slice;
      index += 1;

      if (match.isFinished) {
        this.matches.delete(match);
        continue;
      }

      if (!mine) continue;

      try {
        beat(match);
      } catch (error) {
        logger.error({ err: error }, 'Match beat failed');
      }
    }

    if (this.matches.size === 0) this.stopClock();
  }

  /** Stops the clock and forgets every match. For shutdown and tests. */
  clear(): void {
    this.matches.clear();
    this.stopClock();
  }
}
