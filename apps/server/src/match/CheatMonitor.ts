/**
 * Timing plausibility heuristics (plan §4.3).
 *
 * **This flags. It never punishes.**
 *
 * That is the whole design. A genuinely fast typist who gets kicked mid-match
 * is a player lost forever and a support ticket we deserve; a cheater who
 * finishes one match before being reviewed costs almost nothing. So every
 * signal here raises a flag on the match record for asynchronous review, and
 * nothing in this file disconnects anybody.
 *
 * The thresholds are deliberately set beyond human capability rather than at
 * the edge of it. The world record is around 220 WPM in short bursts; these
 * trigger meaningfully above that.
 */

export interface CheatFlag {
  readonly reason: string;
  readonly detail: string;
  readonly at: number;
}

/** Below this, no human finger left one key and pressed another. */
const MIN_PLAUSIBLE_KEY_GAP_MS = 8;

/** Sustained words-per-minute past which we stop believing it. */
const MAX_PLAUSIBLE_WPM = 240;

/** Words in the rolling window used for the sustained-rate check. */
const RATE_WINDOW = 10;

/**
 * A human's keystroke gaps vary. Below this standard deviation the rhythm is
 * mechanical — the signature of a script replaying a fixed interval.
 */
const MIN_TIMING_STDDEV_MS = 4;

/** Only judge rhythm once there are enough keys for the statistic to mean anything. */
const MIN_KEYS_FOR_RHYTHM = 8;

interface CommitRecord {
  readonly atMs: number;
  readonly chars: number;
}

export class CheatMonitor {
  private readonly recent: CommitRecord[] = [];
  private readonly flags: CheatFlag[] = [];

  /**
   * Records a committed word and returns any newly raised flag.
   *
   * `timings` are the client's self-reported inter-key deltas. They are used
   * ONLY here — never to compute damage — precisely because they are the one
   * input a cheat could forge freely.
   */
  record(atMs: number, chars: number, timings: readonly number[]): CheatFlag | null {
    this.recent.push({ atMs, chars });
    if (this.recent.length > RATE_WINDOW) this.recent.shift();

    const flag =
      this.checkImpossibleGaps(timings, atMs) ??
      this.checkMechanicalRhythm(timings, atMs) ??
      this.checkSustainedRate(atMs);

    if (flag) this.flags.push(flag);
    return flag;
  }

  private checkImpossibleGaps(timings: readonly number[], atMs: number): CheatFlag | null {
    // One improbably fast gap is a rollover or a chorded key. Several within a
    // single word is not a hand.
    const impossible = timings.filter((t) => t < MIN_PLAUSIBLE_KEY_GAP_MS).length;
    if (impossible < 3) return null;

    return {
      reason: 'impossible-key-gaps',
      detail: `${impossible} gaps under ${MIN_PLAUSIBLE_KEY_GAP_MS}ms in one word`,
      at: atMs,
    };
  }

  private checkMechanicalRhythm(timings: readonly number[], atMs: number): CheatFlag | null {
    if (timings.length < MIN_KEYS_FOR_RHYTHM) return null;

    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    const variance = timings.reduce((sum, t) => sum + (t - mean) ** 2, 0) / timings.length;
    const stddev = Math.sqrt(variance);

    if (stddev >= MIN_TIMING_STDDEV_MS) return null;

    return {
      reason: 'mechanical-rhythm',
      detail: `stddev ${stddev.toFixed(2)}ms across ${timings.length} keys`,
      at: atMs,
    };
  }

  private checkSustainedRate(atMs: number): CheatFlag | null {
    if (this.recent.length < RATE_WINDOW) return null;

    const first = this.recent[0]!;
    const elapsedMs = atMs - first.atMs;
    if (elapsedMs <= 0) return null;

    /*
     * The first record's characters are EXCLUDED.
     *
     * Elapsed time is measured from that word's commit, so its characters were
     * typed before the window opened. Counting them inflates the measured rate
     * by roughly 1/(N-1) — about 11% at this window size, which is more than
     * enough to flag a legitimate 215 WPM typist as a cheat. Caught by a test
     * asserting a fast human is never flagged.
     */
    const chars = this.recent.slice(1).reduce((total, r) => total + r.chars, 0);
    const wpm = (chars / 5) * (60_000 / elapsedMs);

    if (wpm <= MAX_PLAUSIBLE_WPM) return null;

    return {
      reason: 'sustained-rate',
      detail: `${Math.round(wpm)} WPM sustained over ${RATE_WINDOW} words`,
      at: atMs,
    };
  }

  get flagged(): boolean {
    return this.flags.length > 0;
  }

  get reasons(): readonly CheatFlag[] {
    return this.flags;
  }

  /** One-line summary for the match record. */
  summarise(): string | null {
    if (this.flags.length === 0) return null;
    const unique = [...new Set(this.flags.map((f) => f.reason))];
    return `${this.flags.length} flag(s): ${unique.join(', ')}`;
  }
}
