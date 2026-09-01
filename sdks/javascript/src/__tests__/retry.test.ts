/**
 * Tests for retry utilities — retry.ts
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  withRetry,
  RetryableError,
  isRetryableStatus,
  parseRetryAfterMs,
} from '../retry';

// ── withRetry ─────────────────────────────────────────────────────────────────

describe('withRetry()', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns value immediately on first-attempt success', async () => {
    const fn = jest.fn(async () => 42);
    const promise = withRetry(fn, { maxAttempts: 3 });
    // no timers needed — success on attempt 1
    const result = await promise;
    expect(result.value).toBe(42);
    expect(result.attempts).toBe(1);
    expect(result.totalDelayMs).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 2) throw new RetryableError('flaky', 503);
      return 'ok';
    });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitter: false,
    });

    // Advance past the first retry delay
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting maxAttempts', async () => {
    const fn = jest.fn(async () => { throw new RetryableError('always fails', 503); });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      jitter: false,
    });

    await jest.advanceTimersByTimeAsync(10);  // retry 1
    await jest.advanceTimersByTimeAsync(20);  // retry 2 (backoff x2)

    await expect(promise).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects retryAfterMs from RetryableError', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 2) throw new RetryableError('rate limited', 429, 5000);
      return 'done';
    });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      jitter: false,
    });

    // Should wait the retryAfterMs (5000) not the base delay (100)
    await jest.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.value).toBe('done');
  });

  it('applies exponential back-off without jitter', async () => {
    const delays: number[] = [];
    const fn = jest.fn(async () => { throw new Error('fail'); });

    const promise = withRetry(fn, {
      maxAttempts: 4,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      jitter: false,
      onRetry: (_, delayMs) => delays.push(delayMs),
    });

    await jest.advanceTimersByTimeAsync(100);  // attempt 1 → wait 100
    await jest.advanceTimersByTimeAsync(200);  // attempt 2 → wait 200
    await jest.advanceTimersByTimeAsync(400);  // attempt 3 → wait 400

    await promise.catch(() => {});

    expect(delays).toEqual([100, 200, 400]);
  });

  it('caps delay at maxDelayMs', async () => {
    const delays: number[] = [];
    const fn = jest.fn(async () => { throw new Error('fail'); });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 10,
      maxDelayMs: 500,
      jitter: false,
      onRetry: (_, delayMs) => delays.push(delayMs),
    });

    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(500);
    await promise.catch(() => {});

    expect(delays.every((d) => d <= 500)).toBe(true);
  });

  it('calls onRetry callback with attempt number', async () => {
    const attempts: number[] = [];
    const fn = jest.fn(async (attempt: number) => {
      if (attempt < 3) throw new Error('retry me');
      return 'success';
    });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 10,
      jitter: false,
      onRetry: (attempt) => attempts.push(attempt),
    });

    await jest.advanceTimersByTimeAsync(10);
    await jest.advanceTimersByTimeAsync(20);
    await promise;

    expect(attempts).toEqual([1, 2]);
  });
});

// ── isRetryableStatus ─────────────────────────────────────────────────────────

describe('isRetryableStatus()', () => {
  it('retries 429 for all methods', () => {
    expect(isRetryableStatus(429, 'POST')).toBe(true);
    expect(isRetryableStatus(429, 'GET')).toBe(true);
    expect(isRetryableStatus(429, 'PUT')).toBe(true);
  });

  it('retries 503 for all methods', () => {
    expect(isRetryableStatus(503, 'POST')).toBe(true);
    expect(isRetryableStatus(503, 'DELETE')).toBe(true);
  });

  it('retries 502 and 504 for GET', () => {
    expect(isRetryableStatus(502, 'GET')).toBe(true);
    expect(isRetryableStatus(504, 'GET')).toBe(true);
  });

  it('does not retry 502 for POST (non-idempotent)', () => {
    expect(isRetryableStatus(502, 'POST')).toBe(false);
  });

  it('does not retry 4xx client errors for GET', () => {
    expect(isRetryableStatus(400, 'GET')).toBe(false);
    expect(isRetryableStatus(401, 'GET')).toBe(false);
    expect(isRetryableStatus(403, 'GET')).toBe(false);
    expect(isRetryableStatus(404, 'GET')).toBe(false);
  });

  it('retries 408 for GET', () => {
    expect(isRetryableStatus(408, 'GET')).toBe(true);
  });

  it('respects custom retryableStatuses override', () => {
    expect(isRetryableStatus(500, 'GET', [500])).toBe(true);
    expect(isRetryableStatus(502, 'GET', [500])).toBe(false);
  });

  it('respects custom retryableMethods override', () => {
    expect(isRetryableStatus(502, 'POST', [502, 503, 504], ['GET', 'POST'])).toBe(true);
  });
});

// ── parseRetryAfterMs ─────────────────────────────────────────────────────────

describe('parseRetryAfterMs()', () => {
  it('parses integer seconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
    expect(parseRetryAfterMs('0')).toBe(0);
    expect(parseRetryAfterMs('120')).toBe(120_000);
  });

  it('parses decimal seconds', () => {
    expect(parseRetryAfterMs('1.5')).toBe(1500);
  });

  it('returns undefined for null', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it('returns undefined for non-numeric non-date string', () => {
    expect(parseRetryAfterMs('invalid')).toBeUndefined();
  });

  it('parses HTTP-date format', () => {
    const futureDate = new Date(Date.now() + 3000).toUTCString();
    const ms = parseRetryAfterMs(futureDate);
    expect(ms).toBeGreaterThan(0);
    expect(ms!).toBeLessThanOrEqual(3000 + 100); // allow minor clock drift
  });
});

// ── RetryableError ────────────────────────────────────────────────────────────

describe('RetryableError', () => {
  it('sets name, httpStatus and retryAfterMs', () => {
    const err = new RetryableError('too many requests', 429, 2000);
    expect(err.name).toBe('RetryableError');
    expect(err.httpStatus).toBe(429);
    expect(err.retryAfterMs).toBe(2000);
    expect(err.message).toBe('too many requests');
  });

  it('instanceof Error', () => {
    expect(new RetryableError('x', 503)).toBeInstanceOf(Error);
  });
});
