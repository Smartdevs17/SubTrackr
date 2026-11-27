/**
 * Tests for the SDK circuit breaker (Issue #2216).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      recoveryTimeoutMs: 100,
      successThreshold: 2,
      name: 'test',
    });
  });

  it('starts in CLOSED state', () => {
    expect(breaker.state).toBe('closed');
    expect(breaker.isClosed()).toBe(true);
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.isHalfOpen()).toBe(false);
  });

  it('executes successful actions in CLOSED state', async () => {
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
    expect(breaker.isClosed()).toBe(true);
  });

  it('stays CLOSED when actions succeed', async () => {
    for (let i = 0; i < 10; i++) {
      await breaker.execute(async () => i);
    }
    expect(breaker.isClosed()).toBe(true);
  });

  it('trips to OPEN after failureThreshold consecutive failures', async () => {
    const failing = async () => { throw new Error('fail'); };
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    expect(breaker.isOpen()).toBe(true);
  });

  it('resets failure count on success (no trip)', async () => {
    const failing = async () => { throw new Error('fail'); };
    const succeeding = async () => 'ok';

    // 2 failures (below threshold of 3)
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    // A success resets the counter
    await breaker.execute(succeeding);
    // 2 more failures (still below threshold since counter was reset)
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    expect(breaker.isClosed()).toBe(true);
  });

  it('throws CircuitOpenError when OPEN', async () => {
    const failing = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }
    await expect(breaker.execute(async () => 'should not reach')).rejects.toThrow(CircuitOpenError);
    await expect(breaker.execute(async () => 'should not reach')).rejects.toThrow(/Circuit breaker/);
  });

  it('transitions to HALF-OPEN after recoveryTimeoutMs', async () => {
    jest.useFakeTimers();

    const failing = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }
    expect(breaker.isOpen()).toBe(true);

    // Advance past recovery timeout
    jest.advanceTimersByTime(100);
    expect(breaker.isHalfOpen()).toBe(true);

    jest.useRealTimers();
  });

  it('closes from HALF-OPEN after successThreshold successes', async () => {
    jest.useFakeTimers();

    const failing = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    jest.advanceTimersByTime(100);
    expect(breaker.isHalfOpen()).toBe(true);

    // Need 2 successes to close
    await breaker.execute(async () => 'ok1');
    expect(breaker.isHalfOpen()).toBe(true);
    await breaker.execute(async () => 'ok2');
    expect(breaker.isClosed()).toBe(true);

    jest.useRealTimers();
  });

  it('re-opens from HALF-OPEN on any failure', async () => {
    jest.useFakeTimers();

    const failing = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    jest.advanceTimersByTime(100);
    expect(breaker.isHalfOpen()).toBe(true);

    await expect(breaker.execute(failing)).rejects.toThrow('fail');
    expect(breaker.isOpen()).toBe(true);

    jest.useRealTimers();
  });

  it('can be manually reset', async () => {
    const failing = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }
    expect(breaker.isOpen()).toBe(true);

    breaker.reset();
    expect(breaker.isClosed()).toBe(true);
  });

  it('CircuitOpenError carries name and openUntil', async () => {
    jest.useFakeTimers();

    const failing = async () => { throw new Error('fail'); };
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failing)).rejects.toThrow('fail');
    }

    let caughtError: CircuitOpenError | undefined;
    try {
      await breaker.execute(async () => 'x');
    } catch (err) {
      caughtError = err as CircuitOpenError;
    }
    expect(caughtError).toBeInstanceOf(CircuitOpenError);
    expect(caughtError!.circuitName).toBe('test');
    expect(caughtError!.openUntil).toBeGreaterThan(Date.now());

    jest.useRealTimers();
  });

  it('uses default options when none provided', () => {
    const defaultBreaker = new CircuitBreaker();
    expect(defaultBreaker.name).toBe('default');
    expect(defaultBreaker.isClosed()).toBe(true);
  });

  it('handles non-Error throws', async () => {
    const throwString = async () => { throw 'string error'; };
    await expect(breaker.execute(throwString)).rejects.toBe('string error');
    // Should still count as a failure
    await expect(breaker.execute(throwString)).rejects.toBe('string error');
    await expect(breaker.execute(throwString)).rejects.toBe('string error');
    expect(breaker.isOpen()).toBe(true);
  });
});
