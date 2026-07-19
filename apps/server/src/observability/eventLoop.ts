import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Event loop lag.
 *
 * **The single most important number this server reports.**
 *
 * Every live match runs in this one process (plan §1.1 D2), driven by timers at
 * 30Hz for events and 10Hz for snapshots. When the loop stalls, it does not
 * degrade one match — it freezes ALL of them at once, and every player sees
 * their opponent teleport. A server at 80% CPU with a flat event loop is
 * healthy; a server at 30% CPU with 200ms lag spikes is already ruining games.
 *
 * Node's histogram samples the loop itself rather than us guessing with
 * `setInterval` drift, so it catches stalls that happen between our own timers.
 */

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

export interface EventLoopStats {
  /** Milliseconds. */
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

const toMs = (nanoseconds: number): number => Math.round((nanoseconds / 1e6) * 100) / 100;

export function eventLoopStats(): EventLoopStats {
  return {
    meanMs: toMs(histogram.mean),
    p50Ms: toMs(histogram.percentile(50)),
    p95Ms: toMs(histogram.percentile(95)),
    p99Ms: toMs(histogram.percentile(99)),
    maxMs: toMs(histogram.max),
  };
}

/**
 * Clears the histogram.
 *
 * Needed because the histogram is cumulative since boot: without a reset, one
 * stall during startup would sit in the p99 forever and hide a genuinely
 * healthy steady state. A load test resets before each tier.
 */
export function resetEventLoopStats(): void {
  histogram.reset();
}
