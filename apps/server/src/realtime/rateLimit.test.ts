import { describe, expect, it } from 'vitest';
import { RateLimiter, ruleFor } from './rateLimit.js';

describe('RateLimiter', () => {
  const rule = { burst: 3, perSecond: 1 };

  it('allows up to the burst capacity immediately', () => {
    const limiter = new RateLimiter();
    const now = 1_000;

    expect(limiter.consume('k', rule, now)).toBe(true);
    expect(limiter.consume('k', rule, now)).toBe(true);
    expect(limiter.consume('k', rule, now)).toBe(true);
    expect(limiter.consume('k', rule, now)).toBe(false);
  });

  it('refills over time at the configured rate', () => {
    const limiter = new RateLimiter();
    const now = 1_000;

    for (let i = 0; i < 3; i += 1) limiter.consume('k', rule, now);
    expect(limiter.consume('k', rule, now)).toBe(false);

    // One second later exactly one token is back.
    expect(limiter.consume('k', rule, now + 1_000)).toBe(true);
    expect(limiter.consume('k', rule, now + 1_000)).toBe(false);
  });

  it('never refills beyond the burst capacity', () => {
    const limiter = new RateLimiter();
    const now = 1_000;

    limiter.consume('k', rule, now);
    // A very long idle period must not bank unlimited tokens.
    const muchLater = now + 600_000;

    expect(limiter.consume('k', rule, muchLater)).toBe(true);
    expect(limiter.consume('k', rule, muchLater)).toBe(true);
    expect(limiter.consume('k', rule, muchLater)).toBe(true);
    expect(limiter.consume('k', rule, muchLater)).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new RateLimiter();
    const now = 1_000;

    for (let i = 0; i < 3; i += 1) limiter.consume('a', rule, now);

    expect(limiter.consume('a', rule, now)).toBe(false);
    expect(limiter.consume('b', rule, now)).toBe(true);
  });

  /**
   * Guards the sizing decision, not the mechanism: a 150 WPM typist commits
   * roughly 2.5 words/second and must never be throttled by this.
   */
  it('does not throttle a fast but legitimate typist', () => {
    const limiter = new RateLimiter();
    const wordRule = ruleFor('match:word');
    const intervalMs = 1000 / 2.5;

    let blocked = 0;
    for (let i = 0; i < 300; i += 1) {
      if (!limiter.consume('match:word', wordRule, 1_000 + i * intervalMs)) blocked += 1;
    }

    expect(blocked).toBe(0);
  });

  it('falls back to the default rule for unknown events', () => {
    expect(ruleFor('some:unknown:event')).toEqual(ruleFor('default'));
  });
});
