/**
 * Tests for the TokenBucket rate limiter.
 *
 * Run with:
 *   npx jest backend/services/shared/__tests__/tokenBucket.test.ts
 */

import { TokenBucket, refillRateFromHourlyLimit } from '../tokenBucket';

describe('TokenBucket', () => {
  it('starts full by default', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 });
    expect(bucket.getRemaining()).toBe(10);
    expect(bucket.getCapacity()).toBe(10);
  });

  it('consumes tokens when available', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 });
    const result = bucket.tryConsume(2);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
    expect(result.retryAfterMs).toBe(0);
  });

  it('rejects when empty and reports retryAfterMs', () => {
    const bucket = new TokenBucket(
      { capacity: 2, refillRatePerSecond: 1 },
      { initialTokens: 0 },
    );
    const result = bucket.tryConsume(1);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(1_000);
  });

  it('refills continuously based on elapsed time', () => {
    let now = 1_000_000;
    const bucket = new TokenBucket(
      { capacity: 10, refillRatePerSecond: 2 },
      { now: () => now, initialTokens: 0 },
    );

    now += 2_500; // 2.5s * 2 tokens/s = 5 tokens
    expect(bucket.getRemaining()).toBe(5);

    const result = bucket.tryConsume(5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('never exceeds capacity when refilling', () => {
    let now = 0;
    const bucket = new TokenBucket(
      { capacity: 3, refillRatePerSecond: 100 },
      { now: () => now, initialTokens: 0 },
    );
    now += 10_000;
    expect(bucket.getRemaining()).toBe(3);
  });

  it('reconfigure updates capacity and clamps tokens', () => {
    const bucket = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 });
    bucket.reconfigure({ capacity: 4 });
    expect(bucket.getCapacity()).toBe(4);
    expect(bucket.getRemaining()).toBe(4);
  });

  it('throws on invalid config', () => {
    expect(() => new TokenBucket({ capacity: 0, refillRatePerSecond: 1 })).toThrow();
    expect(() => new TokenBucket({ capacity: 5, refillRatePerSecond: 0 })).toThrow();
  });
});

describe('refillRateFromHourlyLimit', () => {
  it('derives tokens/sec from hourly limit', () => {
    expect(refillRateFromHourlyLimit(3_600)).toBe(1);
    expect(refillRateFromHourlyLimit(100)).toBeCloseTo(100 / 3_600);
  });

  it('floors at a small epsilon', () => {
    expect(refillRateFromHourlyLimit(0)).toBe(0.001);
  });
});
