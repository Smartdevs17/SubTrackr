/**
 * Retry policy with exponential back-off + jitter.
 *
 * Retryable conditions (RFC 7231 / idempotency-aware):
 *   - Network errors (fetch threw)
 *   - 429 Too Many Requests  (respects Retry-After header)
 *   - 503 Service Unavailable
 *   - 502 / 504 Gateway errors
 *   - 408 Request Timeout
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Initial delay in ms before the first retry. Default: 200 */
  initialDelayMs?: number;
  /** Multiplier applied to delay on each subsequent retry. Default: 2 */
  backoffMultiplier?: number;
  /** Maximum delay cap in ms. Default: 10 000 */
  maxDelayMs?: number;
  /** Add ±20% random jitter to prevent thundering herd. Default: true */
  jitter?: boolean;
  /** HTTP status codes that should be retried. Default: [408, 429, 502, 503, 504] */
  retryableStatuses?: number[];
  /** HTTP methods that may be retried. Default: ['GET', 'HEAD', 'OPTIONS', 'DELETE'] */
  retryableMethods?: string[];
  /** Invoked on each failed attempt before waiting. */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

const DEFAULT_RETRYABLE_STATUSES = [408, 429, 502, 503, 504];
const DEFAULT_RETRYABLE_METHODS = ['GET', 'HEAD', 'OPTIONS', 'DELETE'];

export interface RetryResult<T> {
  value: T;
  attempts: number;
  totalDelayMs: number;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 200;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const maxDelayMs = options.maxDelayMs ?? 10_000;
  const jitter = options.jitter !== false;
  const onRetry = options.onRetry;

  let attempt = 0;
  let totalDelay = 0;

  while (true) {
    attempt += 1;
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt, totalDelayMs: totalDelay };
    } catch (err) {
      if (attempt >= maxAttempts) throw err;

      const reason = err instanceof Error ? err.message : String(err);
      let delayMs = Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt - 1), maxDelayMs);

      // Respect Retry-After header when available on RetryableError
      if (err instanceof RetryableError && err.retryAfterMs != null) {
        delayMs = Math.min(err.retryAfterMs, maxDelayMs);
      }

      if (jitter) {
        const jitterFactor = 0.8 + Math.random() * 0.4; // ±20%
        delayMs = Math.round(delayMs * jitterFactor);
      }

      onRetry?.(attempt, delayMs, reason);
      totalDelay += delayMs;

      await sleep(delayMs);
    }
  }
}

/** Thrown by the typed client to signal a retryable failure. */
export class RetryableError extends Error {
  readonly httpStatus: number;
  readonly retryAfterMs?: number;

  constructor(message: string, httpStatus: number, retryAfterMs?: number) {
    super(message);
    this.name = 'RetryableError';
    this.httpStatus = httpStatus;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Determine if an HTTP status should be retried. */
export function isRetryableStatus(
  status: number,
  method: string,
  retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
  retryableMethods = DEFAULT_RETRYABLE_METHODS,
): boolean {
  const methodUpper = method.toUpperCase();
  // Never retry mutating methods unless the status is 429/503 (safe to retry)
  if (!retryableMethods.includes(methodUpper) && ![429, 503].includes(status)) {
    return false;
  }
  return retryableStatuses.includes(status);
}

/** Parse Retry-After header (seconds or HTTP-date) into milliseconds. */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  // HTTP-date format
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
