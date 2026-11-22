/**
 * Shared transport helpers for outbound HTTP calls made by payment and billing
 * gateways.
 *
 * Every gateway adapter needs the same four things: resolve a `fetch`
 * implementation, parse a JSON body defensively, decide whether an HTTP status
 * is transient, and run an attempt loop with backoff. Those were previously
 * copy-pasted per adapter, which meant a fix to the retry policy had to be
 * applied three times and could silently diverge on the money path.
 *
 * This module owns the shared mechanics. Provider-specific concerns (error
 * body shapes, GraphQL error arrays, auth headers) stay in the adapters.
 */

/** Default attempt budget for a retryable request. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Default base delay, in milliseconds, for the linear backoff. */
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;

/** Default `fetch`-alike signature used by the adapters. */
export type FetchLike = (...args: never[]) => unknown;

/**
 * Canonical retry policy for gateway transports.
 *
 * `429` and any `5xx` are transient. `409` is transient only for Stripe
 * lock timeouts, which clear on their own.
 */
export function isRetryableStatus(status: number, code?: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 409 && code === 'lock_timeout';
}

/** Resolves after `ms` milliseconds using a timer. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Computes the delay before a given attempt. */
export type RetryBackoff = (attempt: number, baseDelayMs: number) => number;

/**
 * Linear backoff: the delay grows by one base interval per attempt
 * (`base * 1`, `base * 2`, ...). This preserves the behaviour the gateways
 * had before the policy was centralised.
 */
export const linearBackoff: RetryBackoff = (attempt, baseDelayMs) => baseDelayMs * attempt;

/**
 * Clamps a configured attempt budget into a usable range. A non-retryable
 * request is pinned to a single attempt.
 */
export function resolveMaxAttempts(retryable: boolean, maxAttempts: number): number {
  if (!retryable) return 1;
  return Math.max(1, maxAttempts);
}

/**
 * Picks the `fetch` implementation to use: an injected implementation always
 * wins, otherwise the runtime global is used if it is callable.
 */
export function resolveFetchImpl<TFetch extends FetchLike>(injected: TFetch | undefined): TFetch | undefined {
  if (injected) return injected;
  const candidate = (globalThis as { fetch?: TFetch }).fetch;
  return typeof candidate === 'function' ? candidate : undefined;
}

/**
 * `JSON.parse` that returns `null` instead of throwing, and rejects non-object
 * payloads (`null`, arrays and primitives are not valid gateway bodies).
 */
export function parseJsonObject<T extends object = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as T;
}

/** The result of a single attempt inside {@link runWithRetries}. */
export type RetryAttempt<T> =
  /** Settled — return `value` and stop. */
  | { readonly done: true; readonly value: T }
  /** Transient — back off and try again; `value` is returned if the budget runs out. */
  | { readonly done: false; readonly retry: true; readonly value: T }
  /** Terminal — return `value` immediately without spending another attempt. */
  | { readonly done: false; readonly retry: false; readonly value: T };

export interface RetryContext {
  /** 1-based index of the attempt about to run. */
  readonly attempt: number;
  /** Total attempts this operation is allowed. */
  readonly maxAttempts: number;
}

export interface RunWithRetriesOptions {
  /** Total attempts allowed, including the first. */
  readonly maxAttempts: number;
  /** Base delay handed to {@link RetryBackoff}. */
  readonly baseDelayMs: number;
  /** Injectable timer, for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Backoff policy; defaults to {@link linearBackoff}. */
  readonly backoff?: RetryBackoff;
  /** Invoked after a transient failure and before the next attempt. */
  readonly onRetry?: (context: RetryContext, error: unknown) => void;
}

/**
 * Runs `attempt` until it settles, until it reports a terminal outcome, or
 * until the attempt budget is exhausted — whichever comes first.
 *
 * Anything thrown by `attempt` is treated as a transient transport failure and
 * retried; on the final attempt the last thrown value is rethrown so callers
 * keep their existing error semantics. When the budget is exhausted on a
 * reported transient outcome, the last reported `value` is returned.
 */
export async function runWithRetries<T>(
  attempt: (context: RetryContext) => Promise<RetryAttempt<T>>,
  options: RunWithRetriesOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts);
  const sleep = options.sleep ?? defaultSleep;
  const backoff = options.backoff ?? linearBackoff;
  let lastError: unknown;
  let lastValue: T | undefined;
  let hasValue = false;

  for (let index = 1; index <= maxAttempts; index += 1) {
    const context: RetryContext = { attempt: index, maxAttempts };
    let result: RetryAttempt<T>;

    try {
      result = await attempt(context);
    } catch (error) {
      lastError = error;
      if (index === maxAttempts) throw error;
      options.onRetry?.(context, error);
      await sleep(backoff(index, options.baseDelayMs));
      continue;
    }

    if (result.done) return result.value;

    lastValue = result.value;
    hasValue = true;

    // A terminal outcome is answered immediately, without burning the budget.
    if (!result.retry) return result.value;

    if (index === maxAttempts) break;

    options.onRetry?.(context, result.value);
    await sleep(backoff(index, options.baseDelayMs));
  }

  if (hasValue) return lastValue as T;
  throw lastError ?? new Error('retry loop exhausted without a result');
}
