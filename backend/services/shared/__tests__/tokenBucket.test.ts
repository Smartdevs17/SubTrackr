/**
 * Tests — TokenBucket (Issue #998)
 */

import { TokenBucket, refillRateFromHourlyLimit } from '../tokenBucket';

describe('TokenBucket', () => {
  let mockNow: jest.Mock<number>;

  beforeEach(() => {
    mockNow = jest.fn(() => 1_000_000);
  });

  // ── Construction ──────────────────────────────────────────────────────────

  it('starts full by default', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 }, { now: mockNow });
    expect(b.getRemaining()).toBe(10);
  });

  it('starts with custom initialTokens', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 }, { now: mockNow, initialTokens: 3 });
    expect(b.getRemaining()).toBe(3);
  });

  it('throws on zero capacity', () => {
    expect(() => new TokenBucket({ capacity: 0, refillRatePerSecond: 1 })).toThrow();
  });

  it('throws on zero refillRate', () => {
    expect(() => new TokenBucket({ capacity: 10, refillRatePerSecond: 0 })).toThrow();
  });

  // ── tryConsume ────────────────────────────────────────────────────────────

  it('allows consume when tokens available', () => {
    const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 }, { now: mockNow });
    const r = b.tryConsume(1);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBeCloseTo(4);
    expect(r.retryAfterMs).toBe(0);
  });

  it('rejects consume when bucket empty and returns retryAfterMs', () => {
    const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 2 }, { now: mockNow, initialTokens: 0 });
    const r = b.tryConsume(1);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBe(500); // 1 token at 2/s = 0.5s = 500ms
  });

  it('allows burst up to capacity', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 }, { now: mockNow });
    for (let i = 0; i < 10; i++) {
      expect(b.tryConsume(1).allowed).toBe(true);
    }
    expect(b.tryConsume(1).allowed).toBe(false);
  });

  // ── Refill over time ──────────────────────────────────────────────────────

  it('refills tokens after elapsed time', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 2 }, { now: mockNow, initialTokens: 0 });
    // Advance 3 seconds → should add 6 tokens
    mockNow.mockReturnValue(1_003_000);
    expect(b.getRemaining()).toBe(6);
  });

  it('does not exceed capacity when refilling', () => {
    const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 10 }, { now: mockNow });
    mockNow.mockReturnValue(1_100_000); // 100s — would add 1000 tokens
    b.refill();
    expect(b.getRemaining()).toBe(5);
  });

  // ── reconfigure ───────────────────────────────────────────────────────────

  it('reconfigure adjusts capacity and rate', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 }, { now: mockNow });
    b.reconfigure({ capacity: 20, refillRatePerSecond: 5 });
    expect(b.getCapacity()).toBe(20);
    expect(b.getRefillRatePerSecond()).toBe(5);
  });

  it('reconfigure clamps tokens to new capacity', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 }, { now: mockNow });
    b.reconfigure({ capacity: 3 });
    expect(b.getRemaining()).toBe(3);
  });

  // ── setTokens ─────────────────────────────────────────────────────────────

  it('setTokens clamps to [0, capacity]', () => {
    const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 }, { now: mockNow });
    b.setTokens(50);
    expect(b.getRemaining()).toBe(10);
    b.setTokens(-5);
    expect(b.getRemaining()).toBe(0);
  });

  // ── snapshot ──────────────────────────────────────────────────────────────

  it('snapshot returns correct fields', () => {
    const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 2 }, { now: mockNow, initialTokens: 3 });
    const snap = b.snapshot();
    expect(snap.capacity).toBe(5);
    expect(snap.refillRatePerSecond).toBe(2);
    expect(snap.tokens).toBeCloseTo(3);
  });

  // ── refillRateFromHourlyLimit ─────────────────────────────────────────────

  it('refillRateFromHourlyLimit converts hourly to per-second', () => {
    expect(refillRateFromHourlyLimit(3600)).toBeCloseTo(1);
    expect(refillRateFromHourlyLimit(720)).toBeCloseTo(0.2);
  });

  it('refillRateFromHourlyLimit floors at epsilon for very small limits', () => {
    expect(refillRateFromHourlyLimit(0)).toBe(0.001);
  });
});
