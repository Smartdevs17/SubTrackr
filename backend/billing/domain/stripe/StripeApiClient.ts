/**
 * Minimal Stripe REST client for the Billing API (issue #1239).
 *
 * The existing `StripeAdapter` in `services/payment` is a card-charge stub that
 * fabricates ids; it cannot manage a subscription. This client is the real
 * transport underneath `StripeBillingService` and deliberately small: it knows
 * how to talk to Stripe, and nothing about the subscription domain.
 *
 * Three details are easy to get wrong and are therefore handled here rather
 * than at every call site:
 *
 *  - **Form encoding, including nesting.** Stripe's API is
 *    `application/x-www-form-urlencoded` and addresses nested values with
 *    bracket keys (`items[0][price]`, `metadata[order_id]`,
 *    `expand[]`). `encodeForm` builds those keys from plain objects.
 *  - **Idempotency.** Every write accepts an `Idempotency-Key`. Without one, a
 *    network retry creates a *second* customer or subscription. Callers pass
 *    their own business key (e.g. `sub_123:create`) so a replay is a no-op.
 *  - **Which failures are worth retrying.** `429` and `5xx` are transient;
 *    `409 lock_timeout` is explicitly retryable; a `4xx` is a bug or a bad
 *    request and is raised immediately so it surfaces in logs.
 *
 * `fetch` is injected so the client is testable without a network and without
 * the `stripe` npm package.
 *
 * ```bash
 * STRIPE_SECRET_KEY=sk_test_…        # sk_live_… in production
 * STRIPE_API_VERSION=2024-06-20      # optional; pinned so upgrades are deliberate
 * ```
 */

import { createLoggerFor } from '../../../services/shared/logging';

const logger = createLoggerFor('billing.stripe');

/** Stripe's default API version; pinned so a dashboard change is not silent. */
export const DEFAULT_STRIPE_API_VERSION = '2024-06-20';
export const STRIPE_API_BASE = 'https://api.stripe.com/v1';
/** Stripe caps an `Idempotency-Key` at 255 characters. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;

export interface StripeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface StripeFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export type StripeFetch = (
  url: string,
  init: StripeFetchInit,
) => Promise<StripeFetchResponse>;

export type StripeParams = Record<string, unknown>;

export interface StripeErrorBody {
  readonly error?: {
    readonly type?: string;
    readonly code?: string;
    readonly message?: string;
    readonly param?: string;
    readonly decline_code?: string;
  };
}

export interface StripeRequestOptions {
  /**
   * Sent as `Idempotency-Key`. Stripe stores the first response for 24 h and
   * replays it for a repeated key, so a retry cannot double-charge.
   */
  readonly idempotencyKey?: string;
  /**
   * Overrides the default attempt count. `false` (or 1) disables retries,
   * which is what reads should do.
   */
  readonly maxAttempts?: number;
}

export interface StripeApiClientOptions {
  readonly secretKey: string;
  /** Defaults to `https://api.stripe.com/v1`. Overridable for Stripe's mock server. */
  readonly baseUrl?: string;
  /** Pinned via the `Stripe-Version` header. Defaults to 2024-06-20. */
  readonly apiVersion?: string;
  readonly fetchImpl?: StripeFetch;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly param: string;
  /** True when retrying the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    message: string,
    details: {
      status: number;
      type?: string;
      code?: string;
      param?: string;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'StripeApiError';
    this.status = details.status;
    this.type = details.type ?? 'api_error';
    this.code = details.code ?? '';
    this.param = details.param ?? '';
    this.retryable = details.retryable ?? false;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flattens a nested object into Stripe's bracketed form-encoding.
 *
 * ```ts
 * encodeForm({ items: [{ price: 'price_1', quantity: 2 }], metadata: { order_id: '7' } });
 * // { 'items[0][price]': 'price_1', 'items[0][quantity]': '2', 'metadata[order_id]': '7' }
 * encodeForm({ expand: ['a', 'b'] });
 * // { 'expand[]': 'a', 'expand[]': 'b' }
 * ```
 *
 * `null` and `undefined` are dropped, which is how Stripe expects an unset
 * field to be expressed. `false` and `0` are kept, because they are real values
 * (e.g. `proration_behavior[create_prorations]=false`).
 */
export function encodeForm(
  params: StripeParams,
  prefix = '',
  target: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const path = prefix ? `${prefix}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (entry === undefined || entry === null) return;
        if (isPlainObject(entry) || Array.isArray(entry)) {
          // Positional, e.g. items[0][price]=price_1.
          encodeForm({ [String(index)]: entry }, path, target);
        } else {
          // Scalar arrays are repeated, e.g. expand[]=a&expand[]=b.
          target[`${path}[]`] = String(entry);
        }
      });
    } else if (isPlainObject(value)) {
      encodeForm(value, path, target);
    } else {
      target[path] = String(value);
    }
  }
  return target;
}

export function toIdempotencyKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);
}

export class StripeApiClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly injectedFetch: StripeFetch | undefined;
  private readonly defaultMaxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: StripeApiClientOptions) {
    const secretKey = options.secretKey?.trim();
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is required to call the Stripe API');
    }
    this.secretKey = secretKey;
    this.baseUrl = (options.baseUrl ?? STRIPE_API_BASE).replace(/\/+$/, '');
    this.apiVersion = options.apiVersion ?? DEFAULT_STRIPE_API_VERSION;
    this.injectedFetch = options.fetchImpl;
    this.defaultMaxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Builds a client from the environment, or `null` when Stripe is not
   * configured, so a deployment without `STRIPE_SECRET_KEY` does not expose
   * billing routes that cannot work.
   */
  static fromEnvironment(
    env: Record<string, string | undefined> = process.env,
  ): StripeApiClient | null {
    const secretKey = env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      logger.info('STRIPE_SECRET_KEY is not set; Stripe Billing routes stay disabled');
      return null;
    }
    return new StripeApiClient({
      secretKey,
      apiVersion: env.STRIPE_API_VERSION?.trim() || undefined,
    });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiVersion(): string {
    return this.apiVersion;
  }

  get<T>(path: string, params: StripeParams = {}, options: StripeRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, params, options);
  }

  post<T>(path: string, params: StripeParams = {}, options: StripeRequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, params, options);
  }

  delete<T>(path: string, params: StripeParams = {}, options: StripeRequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, params, options);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: StripeParams,
    options: StripeRequestOptions,
  ): Promise<T> {
    const fetchImpl = this.resolveFetch();
    if (!fetchImpl) {
      throw new StripeApiError('No fetch implementation is available in this runtime', {
        status: 0,
        code: 'stripe_fetch_unavailable',
      });
    }

    const encoded = encodeForm(params);
    const body = new URLSearchParams(encoded).toString();
    const url = `${this.baseUrl}${path}${method === 'GET' && body ? `?${body}` : ''}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Stripe-Version': this.apiVersion,
      Accept: 'application/json',
    };
    if (method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    // Reads are safe to repeat; only writes get the retry budget.
    const maxAttempts =
      options.maxAttempts ?? (method === 'GET' ? 1 : this.defaultMaxAttempts);

    let lastError: StripeApiError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          body: method === 'GET' ? undefined : body,
        });
        const text = await response.text();

        if (response.ok) {
          if (!text) return {} as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            throw new StripeApiError('Stripe returned a body that is not JSON', {
              status: response.status,
              code: 'stripe_invalid_json',
            });
          }
        }

        const parsedError = parseStripeError(text);
        const error = new StripeApiError(
          stripeErrorMessage(text, `Stripe API returned HTTP ${response.status}`),
          {
            status: response.status,
            ...parsedError,
            retryable: isRetryableStatus(response.status, parsedError.code),
          },
        );

        if (!error.retryable || attempt === maxAttempts) throw error;
        lastError = error;
        logger.warn('Retrying Stripe request after a transient failure', {
          method,
          path,
          status: response.status,
          attempt,
        });
      } catch (error) {
        if (error instanceof StripeApiError) {
          if (!error.retryable || attempt === maxAttempts) throw error;
          lastError = error;
        } else {
          const transportError = new StripeApiError(
            error instanceof Error ? error.message : String(error),
            { status: 0, code: 'stripe_transport_error', retryable: true },
          );
          if (attempt === maxAttempts) throw transportError;
          lastError = transportError;
          logger.warn('Stripe request failed in transport', { method, path, attempt });
        }
      }

      if (attempt < maxAttempts) {
        await this.sleep(this.retryBaseDelayMs * attempt);
      }
    }

    throw (
      lastError ??
      new StripeApiError('Stripe request failed', { status: 0, code: 'stripe_unreachable' })
    );
  }

  private resolveFetch(): StripeFetch | undefined {
    if (this.injectedFetch) return this.injectedFetch;
    const candidate = (globalThis as { fetch?: StripeFetch }).fetch;
    return typeof candidate === 'function' ? candidate : undefined;
  }
}

function parseStripeError(text: string): {
  type?: string;
  code?: string;
  param?: string;
} {
  try {
    const parsed = JSON.parse(text) as StripeErrorBody;
    const error = parsed?.error;
    if (!error) return {};
    return {
      type: typeof error.type === 'string' ? error.type : undefined,
      code: typeof error.code === 'string' ? error.code : undefined,
      param: typeof error.param === 'string' ? error.param : undefined,
    };
  } catch {
    return {};
  }
}

function stripeErrorMessage(text: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text) as StripeErrorBody;
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    // Non-JSON error bodies (a proxy's HTML 502) fall through to the fallback.
  }
  return text.slice(0, 300) || fallback;
}

/**
 * `429` is a rate limit and `5xx` is Stripe or its edge failing, so both are
 * worth another attempt. `409` is transient only for Stripe's object locks
 * (`lock_timeout`); any other 409 is a conflict the retry cannot resolve.
 * Everything else in the 4xx range is a bad request the retry cannot fix.
 */
export function isRetryableStatus(status: number, code?: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 409 && code === 'lock_timeout';
}
