import { linearBackoff, defaultSleep, isRetryableStatus } from './httpRetry';

export class OutboundTimeoutError extends Error {
  readonly code = 'OUTBOUND_TIMEOUT' as const;

  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`Outbound request to ${url} timed out after ${timeoutMs}ms`);
    this.name = 'OutboundTimeoutError';
  }
}

export interface OutboundRequestOptions {
  /** Request timeout in milliseconds. Defaults to 5000 ms. */
  timeoutMs?: number;
  /** Max retry attempts (including initial call). Defaults to 3. */
  maxRetries?: number;
  /** Base delay between retries in milliseconds. Defaults to 250 ms. */
  baseDelayMs?: number;
  /** Force retry even if request method/headers are not strictly idempotent. Defaults to false. */
  forceRetry?: boolean;
  /** Custom fetch implementation (useful for tests or mocking). */
  fetchImpl?: typeof fetch;
  /** Custom sleep implementation (for fast unit testing). */
  sleep?: (ms: number) => Promise<void>;
  /** Callback fired before a retry attempt. */
  onRetry?: (attempt: number, error: unknown) => void;
}

export type OutboundRequestInit = RequestInit & OutboundRequestOptions;

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
const IDEMPOTENCY_HEADERS = ['idempotency-key', 'x-idempotency-key'];

/**
 * Checks whether an HTTP method is inherently idempotent.
 */
export function isIdempotentMethod(method: string): boolean {
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}

/**
 * Determines whether a request is safe to retry.
 * Standard idempotent methods (GET, PUT, DELETE, etc.) are always safe.
 * Mutating methods (POST, PATCH) are only safe if an Idempotency-Key header is supplied.
 */
export function isIdempotentRequest(init?: RequestInit | OutboundRequestInit): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (isIdempotentMethod(method)) {
    return true;
  }

  if (init?.headers) {
    if (init.headers instanceof Headers) {
      for (const key of IDEMPOTENCY_HEADERS) {
        if (init.headers.has(key)) return true;
      }
    } else if (Array.isArray(init.headers)) {
      for (const [k] of init.headers) {
        if (IDEMPOTENCY_HEADERS.includes(k.toLowerCase())) return true;
      }
    } else if (typeof init.headers === 'object') {
      const headerKeys = Object.keys(init.headers).map((k) => k.toLowerCase());
      for (const key of IDEMPOTENCY_HEADERS) {
        if (headerKeys.includes(key)) return true;
      }
    }
  }

  return false;
}

/**
 * Executes a single fetch call bounded by a strict timeout using AbortController.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Link existing signal if caller provided one
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', () => {
        clearTimeout(timer);
        controller.abort();
      });
    }
  }

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (err: unknown) {
    if (timedOut) {
      throw new OutboundTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Performs an outbound HTTP request with strict timeouts and bounded idempotent retries.
 */
export async function outboundRequest(
  url: string | URL,
  init: OutboundRequestInit = {},
): Promise<Response> {
  const urlStr = url.toString();
  const timeoutMs = Math.max(1, init.timeoutMs ?? 5_000);
  const maxRetries = Math.max(1, init.maxRetries ?? 3);
  const baseDelayMs = init.baseDelayMs ?? 250;
  const sleep = init.sleep ?? defaultSleep;
  const fetchImpl = init.fetchImpl ?? fetch;

  const idempotent = isIdempotentRequest(init) || init.forceRetry === true;
  // Non-idempotent calls without idempotency keys are strictly bounded to 1 attempt
  const allowedAttempts = idempotent ? maxRetries : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= allowedAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(urlStr, init, timeoutMs, fetchImpl);

      // Transient HTTP errors (429, 5xx)
      if (isRetryableStatus(response.status) && attempt < allowedAttempts) {
        init.onRetry?.(attempt, new Error(`HTTP ${response.status}`));
        await sleep(linearBackoff(attempt, baseDelayMs));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err;

      if (attempt < allowedAttempts) {
        init.onRetry?.(attempt, err);
        await sleep(linearBackoff(attempt, baseDelayMs));
        continue;
      }

      throw err;
    }
  }

  throw lastError ?? new Error('Outbound request failed after retries');
}
