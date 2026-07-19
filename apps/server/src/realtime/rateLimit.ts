/**
 * Per-socket token-bucket rate limiting.
 *
 * Sizing note: the limits here must not punish legitimate play. A fast typist
 * at 150 WPM commits ~2.5 words/second, and burst-typing a short word can spike
 * well above that momentarily — so `match:word` gets a generous bucket and the
 * real cheat detection lives in the match engine's timing analysis (plan §4.3),
 * not here. This exists to stop a socket flooding the process, nothing more.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimitRule {
  /** Bucket capacity — the maximum burst. */
  readonly burst: number;
  /** Sustained refill rate, tokens per second. */
  readonly perSecond: number;
}

export const RATE_LIMITS = {
  'match:word': { burst: 30, perSecond: 12 },
  'room:chat': { burst: 5, perSecond: 0.5 },
  'room:create': { burst: 3, perSecond: 0.2 },
  'room:join': { burst: 6, perSecond: 1 },
  'room:update': { burst: 10, perSecond: 4 },
  'room:character': { burst: 10, perSecond: 2 },
  'room:ready': { burst: 10, perSecond: 2 },
  'mm:join': { burst: 5, perSecond: 0.5 },
  default: { burst: 20, perSecond: 5 },
} as const satisfies Record<string, RateLimitRule>;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /** Returns true if the action is allowed and consumes a token. */
  consume(key: string, rule: RateLimitRule, now: number): boolean {
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: rule.burst, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    const elapsedSec = (now - bucket.lastRefill) / 1000;
    if (elapsedSec > 0) {
      bucket.tokens = Math.min(rule.burst, bucket.tokens + elapsedSec * rule.perSecond);
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) return false;

    bucket.tokens -= 1;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function ruleFor(event: string): RateLimitRule {
  return (RATE_LIMITS as Record<string, RateLimitRule>)[event] ?? RATE_LIMITS.default;
}
