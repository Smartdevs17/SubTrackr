/**
 * Integrated resilience layer — combines circuit breaker + retry.
 *
 * Issue #2216: Robust client SDK with circuit breaker and backoff retry.
 *
 * The retry policy handles transient failures (network blips, 503s). The
 * circuit breaker handles sustained failures (API is down). Together they
 * form a defense-in-depth resilience layer:
 *
 *  1. If the circuit is OPEN, the request fails immediately with
 *     `CircuitOpenError` — no retry, no network call.
 *  2. If the circuit is CLOSED or HALF-OPEN, the request runs through the
 *     retry policy. A successful request moves the breaker toward CLOSED;
 *     a failed request moves it toward OPEN.
 *
 * This means a single network blip is retried transparently, but a
 * sustained outage trips the breaker and stops the client from hammering
 * a dead server.
 */

import {
  CircuitBreaker,
  type CircuitBreakerOptions,
  CircuitOpenError,
  type CircuitState,
} from './circuitBreaker';
import { withRetry, type RetryOptions, RetryableError } from './retry';

export interface ResilienceOptions {
  /** Circuit breaker configuration. */
  circuitBreaker?: CircuitBreakerOptions;
  /** Retry policy configuration. */
  retry?: RetryOptions;
}

export interface ResilienceResult<T> {
  value: T;
  attempts: number;
  totalDelayMs: number;
  /** Whether the circuit breaker was involved in this request. */
  circuitState: 'closed' | 'half-open';
}

/**
 * Wraps an async operation with circuit breaker + retry.
 *
 * @param action The operation to execute (called once per retry attempt).
 * @param options Resilience configuration.
 */
export async function withResilience<T>(
  action: (attempt: number) => Promise<T>,
  options: ResilienceOptions = {}
): Promise<ResilienceResult<T>> {
  const breaker = new CircuitBreaker(options.circuitBreaker ?? { name: 'sdk' });
  return withResilienceAndBreaker(action, breaker, options);
}

/**
 * Same as `withResilience` but accepts a pre-created circuit breaker, so
 * callers can share one breaker across multiple requests.
 */
export async function withResilienceAndBreaker<T>(
  action: (attempt: number) => Promise<T>,
  breaker: CircuitBreaker,
  options: ResilienceOptions = {}
): Promise<ResilienceResult<T>> {
  const retryOpts: RetryOptions = {
    maxAttempts: 3,
    ...options.retry,
  };

  const result = await withRetry(async (attempt: number) => {
    // The circuit breaker wraps the entire attempt. If the circuit is
    // open, it throws CircuitOpenError immediately (non-retryable).
    return breaker.execute(() => action(attempt));
  }, retryOpts);

  return {
    value: result.value,
    attempts: result.attempts,
    totalDelayMs: result.totalDelayMs,
    circuitState: breaker.isHalfOpen() ? 'half-open' : 'closed',
  };
}

/** Re-export commonly used types. */
export { CircuitBreaker, CircuitOpenError, withRetry, RetryableError };
export type { CircuitBreakerOptions, CircuitState, RetryOptions };
