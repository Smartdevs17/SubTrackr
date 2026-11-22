/**
 * Tests for the integrated resilience layer (Issue #2216).
 *
 * Covers the combination of circuit breaker + retry, including:
 * - Successful requests that go through both layers
 * - Retry on transient failures while circuit is CLOSED
 * - Circuit opening on sustained failures
 * - Circuit blocking requests when OPEN
 * - Recovery from HALF-OPEN
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  withResilience,
  withResilienceAndBreaker,
  CircuitBreaker,
  CircuitOpenError,
} from '../resilience';

describe('withResilience', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns value on first-attempt success', async () => {
    const fn = jest.fn(async () => 42);
    const promise = withResilience(fn, {
      retry: { maxAttempts: 3, jitter: false },
    });
    const result = await promise;
    expect(result.value).toBe(42);
    expect(result.attempts).toBe(1);
    expect(result.circuitState).toBe('closed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient failure and succeeds', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 2) throw new Error('transient');
      return 'ok';
    });

    const promise = withResilience(fn, {
      retry: { maxAttempts: 3, initialDelayMs: 100, jitter: false },
      circuitBreaker: { failureThreshold: 10 }, // high threshold so breaker doesn't trip
    });

    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('circuit opens after sustained failures and blocks further calls', async () => {
    const fn = jest.fn(async () => { throw new Error('dead server'); });

    // Use a breaker with low threshold and short recovery
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeoutMs: 1000,
      name: 'test',
    });

    // Exhaust retry attempts — each call to withResilienceAndBreaker will retry
    // 2 times before giving up (maxAttempts=3), and the breaker will trip after
    // 3 failures. With maxAttempts=1, each call does 1 attempt, so 3 calls trip
    // the breaker.
    const opts = {
      retry: { maxAttempts: 1, jitter: false },
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 1000 },
    };

    // 3 calls, each fails once (maxAttempts=1), breaker trips on 3rd failure
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('dead server');
    expect(breaker.isClosed()).toBe(true);

    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('dead server');
    expect(breaker.isClosed()).toBe(true);

    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('dead server');
    expect(breaker.isOpen()).toBe(true);

    // 4th call should fail with CircuitOpenError, not 'dead server'
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow(CircuitOpenError);
    expect(fn).toHaveBeenCalledTimes(3); // the action was only called 3 times, not 4
  });

  it('circuit recovers to HALF-OPEN and closes on success', async () => {
    let shouldFail = true;
    const fn = jest.fn(async () => {
      if (shouldFail) throw new Error('fail');
      return 'recovered';
    });

    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      successThreshold: 1,
      name: 'recovery-test',
    });

    const opts = { retry: { maxAttempts: 1, jitter: false } };

    // Trip the breaker
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('fail');
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('fail');
    expect(breaker.isOpen()).toBe(true);

    // Wait for recovery
    jest.advanceTimersByTime(100);
    expect(breaker.isHalfOpen()).toBe(true);

    // Now the server recovers
    shouldFail = false;
    const result = await withResilienceAndBreaker(fn, breaker, opts);
    expect(result.value).toBe('recovered');
    expect(result.circuitState).toBe('closed');
    expect(breaker.isClosed()).toBe(true);
  });

  it('circuit re-opens from HALF-OPEN on failure', async () => {
    const fn = jest.fn(async () => { throw new Error('still down'); });

    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      name: 'reopen-test',
    });

    const opts = { retry: { maxAttempts: 1, jitter: false } };

    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('still down');
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('still down');
    expect(breaker.isOpen()).toBe(true);

    jest.advanceTimersByTime(100);
    expect(breaker.isHalfOpen()).toBe(true);

    // Fails in half-open → re-opens
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('still down');
    expect(breaker.isOpen()).toBe(true);
  });

  it('reports circuitState as half-open when recovering', async () => {
    let shouldFail = true;
    const fn = jest.fn(async () => {
      if (shouldFail) throw new Error('fail');
      return 'ok';
    });

    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      successThreshold: 2,
      name: 'state-test',
    });

    const opts = { retry: { maxAttempts: 1, jitter: false } };

    // Trip the breaker
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('fail');
    await expect(withResilienceAndBreaker(fn, breaker, opts)).rejects.toThrow('fail');

    jest.advanceTimersByTime(100);
    expect(breaker.isHalfOpen()).toBe(true);

    // First success in half-open
    shouldFail = false;
    const result = await withResilienceAndBreaker(fn, breaker, opts);
    expect(result.circuitState).toBe('half-open');
    expect(breaker.isHalfOpen()).toBe(true);

    // Second success closes the circuit
    const result2 = await withResilienceAndBreaker(fn, breaker, opts);
    expect(result2.circuitState).toBe('closed');
    expect(breaker.isClosed()).toBe(true);
  });

  it('uses default options when none provided', async () => {
    const fn = jest.fn(async () => 'default');
    const result = await withResilience(fn);
    expect(result.value).toBe('default');
    expect(result.attempts).toBe(1);
  });
});
