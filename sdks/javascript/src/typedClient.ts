/**
 * SubTrackr Typed API Client with automatic retry.
 *
 * Features:
 *  - Fully-typed request/response signatures for every endpoint
 *  - Automatic retry with exponential back-off + jitter on transient failures
 *  - Respects Retry-After header on 429 responses
 *  - Injects X-Request-ID and X-API-Version on every request
 *  - Standard ApiResponse<T> envelope parsing (with legacy fallback)
 *  - Idempotency-Key header for POST /payments mutations
 *  - Cursor-based pagination helper
 *  - Configurable timeout with AbortController
 *
 * Usage:
 *   const client = new TypedSubTrackrClient({ apiKey: 'sk_live_...', baseUrl: 'https://api.subtrackr.io' });
 *   const { data } = await client.getSubscription({ subscription_id: 42 });
 */

import {
  SDKOptions,
  Plan,
  Subscription,
  Webhook,
  CreatePlanRequest,
  InitializeRequest,
  PlanIdRequest,
  SubscriberRequest,
  SubscriptionIdRequest,
  SubscriberSubscriptionRequest,
  RequestRefundRequest,
  BillingInterval,
  SubscriptionStatus,
} from './types';
import { ApiError, AuthenticationError, SubTrackrError } from './errors';
import { AuthManager } from './auth';
import {
  withRetry,
  RetryableError,
  isRetryableStatus,
  parseRetryAfterMs,
  type RetryOptions,
} from './retry';

// ─── Response envelope ────────────────────────────────────────────────────────

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta: {
    timestamp: string;
    requestId: string;
    apiVersion: number;
    pagination?: PaginationMeta;
  };
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
  meta: {
    timestamp: string;
    requestId: string;
    apiVersion: number;
  };
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export interface PaginationMeta {
  cursor?: string;
  hasMore: boolean;
  total?: number;
}

// ─── Client options ───────────────────────────────────────────────────────────

export interface TypedClientOptions extends SDKOptions {
  /**
   * Override the base URL (default: production or sandbox depending on `environment`).
   */
  baseUrl?: string;
  /**
   * Request timeout in ms. Default: 30 000.
   * Set to 0 to disable.
   */
  timeoutMs?: number;
  /**
   * Retry policy applied to transient failures. Set `maxAttempts: 1` to disable.
   */
  retry?: RetryOptions;
  /**
   * Custom fetch implementation (useful for SSR / testing).
   */
  fetchImpl?: typeof fetch;
  /**
   * Extra headers merged into every request.
   */
  defaultHeaders?: Record<string, string>;
}

// ─── Request options ──────────────────────────────────────────────────────────

export interface RequestOptions {
  /** Override per-request timeout in ms. */
  timeoutMs?: number;
  /** Override per-request retry policy. */
  retry?: RetryOptions;
  /** Extra headers for this request only. */
  headers?: Record<string, string>;
  /** Idempotency key (for payment mutations). Auto-generated if omitted. */
  idempotencyKey?: string;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface ClientMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalRetries: number;
  totalTimeMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API_VERSION_HEADER = 'X-API-Version';
const REQUEST_ID_HEADER = 'X-Request-ID';
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class TypedSubTrackrClient {
  private readonly baseUrl: string;
  private readonly authManager: AuthManager;
  private readonly timeoutMs: number;
  private readonly retryOptions: RetryOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  private metrics: ClientMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalRetries: 0,
    totalTimeMs: 0,
  };

  constructor(options: TypedClientOptions) {
    this.authManager = new AuthManager(options);
    this.baseUrl = (
      options.baseUrl ??
      (options.environment === 'sandbox'
        ? 'https://sandbox.api.subtrackr.app'
        : 'https://api.subtrackr.app')
    ).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryOptions = options.retry ?? { maxAttempts: 3 };
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  // ── Core request ────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiSuccessEnvelope<T>> {
    const retryOpts: RetryOptions = {
      ...this.retryOptions,
      ...options.retry,
      onRetry: (attempt, delayMs, reason) => {
        this.metrics.totalRetries += 1;
        options.retry?.onRetry?.(attempt, delayMs, reason);
      },
    };

    const start = Date.now();
    this.metrics.totalRequests += 1;

    try {
      const result = await withRetry<ApiSuccessEnvelope<T>>(async (attempt) => {
        const requestId = generateRequestId();
        const token = await this.authManager.getToken().catch(() => {
          throw new AuthenticationError('Failed to acquire authentication token');
        });

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          [REQUEST_ID_HEADER]: requestId,
          [API_VERSION_HEADER]: '1',
          ...this.defaultHeaders,
          ...options.headers,
        };

        if (options.idempotencyKey) {
          headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;
        }

        const timeoutMs = options.timeoutMs ?? this.timeoutMs;
        let abortController: AbortController | undefined;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        if (timeoutMs > 0) {
          abortController = new AbortController();
          timeoutHandle = setTimeout(() => abortController!.abort(), timeoutMs);
        }

        let response: Response;
        try {
          response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: abortController?.signal,
          });
        } catch (err: unknown) {
          clearTimeout(timeoutHandle);
          const isAbort =
            err instanceof Error &&
            (err.name === 'AbortError' || err.message.includes('abort'));
          if (isAbort) {
            throw new RetryableError(`Request timeout after ${timeoutMs}ms`, 408);
          }
          // Network errors are retryable for idempotent methods
          if (isRetryableStatus(0, method)) {
            throw new RetryableError(`Network error: ${String(err)}`, 0);
          }
          throw new SubTrackrError(`Network error: ${String(err)}`);
        } finally {
          clearTimeout(timeoutHandle);
        }

        // Handle retryable HTTP status codes
        if (!response.ok && isRetryableStatus(response.status, method)) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
          throw new RetryableError(
            `HTTP ${response.status}`,
            response.status,
            retryAfterMs,
          );
        }

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const envelope = errBody as Partial<ApiErrorEnvelope>;
          throw new ApiError(
            envelope?.error?.message ?? response.statusText,
            response.status,
            envelope?.error?.code,
          );
        }

        const text = await response.text();
        if (!text) {
          return {
            success: true,
            data: undefined as unknown as T,
            meta: { timestamp: new Date().toISOString(), requestId, apiVersion: 1 },
          };
        }

        const json: unknown = JSON.parse(text);

        // Detect whether the server returns the standard envelope
        const hasEnvelope = response.headers.get(API_VERSION_HEADER) !== null;

        if (!hasEnvelope) {
          // Legacy endpoint — wrap raw body
          return {
            success: true,
            data: json as T,
            meta: { timestamp: new Date().toISOString(), requestId, apiVersion: 0 },
          };
        }

        const envelope = json as ApiEnvelope<T>;
        if (!envelope.success) {
          const errEnv = envelope as ApiErrorEnvelope;
          throw new ApiError(
            errEnv.error.message,
            response.status,
            errEnv.error.code,
          );
        }

        return envelope as ApiSuccessEnvelope<T>;
      }, retryOpts);

      this.metrics.successfulRequests += 1;
      this.metrics.totalTimeMs += Date.now() - start;
      return result.value;
    } catch (err) {
      this.metrics.failedRequests += 1;
      this.metrics.totalTimeMs += Date.now() - start;
      throw err;
    }
  }

  // ── Cursor-based pagination ──────────────────────────────────────────────────

  async *paginate<T>(
    path: string,
    params: Record<string, string> = {},
    requestOptions: RequestOptions = {},
  ): AsyncGenerator<ApiSuccessEnvelope<T[]>> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const query = new URLSearchParams(params);
      if (cursor) query.set('cursor', cursor);
      const fullPath = query.size ? `${path}?${query}` : path;

      const page = await this.request<T[]>('GET', fullPath, undefined, requestOptions);
      yield page;

      hasMore = page.meta.pagination?.hasMore ?? false;
      cursor = page.meta.pagination?.cursor;
    }
  }

  // ── Metrics ──────────────────────────────────────────────────────────────────

  getMetrics(): Readonly<ClientMetrics> {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalRetries: 0,
      totalTimeMs: 0,
    };
  }

  // ── Contract / Plan APIs ─────────────────────────────────────────────────────

  async initialize(data: InitializeRequest, opts?: RequestOptions): Promise<void> {
    await this.request<void>('POST', '/initialize', data, opts);
  }

  async createPlan(data: CreatePlanRequest, opts?: RequestOptions): Promise<number> {
    const res = await this.request<number>('POST', '/create_plan', data, opts);
    return res.data;
  }

  async deactivatePlan(
    data: PlanIdRequest & { merchant: string },
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request<void>('POST', '/deactivate_plan', data, opts);
  }

  async getPlan(data: PlanIdRequest, opts?: RequestOptions): Promise<Plan> {
    const res = await this.request<Plan>('POST', '/get_plan', data, opts);
    return res.data;
  }

  async getPlanCount(opts?: RequestOptions): Promise<number> {
    const res = await this.request<number>('POST', '/get_plan_count', undefined, opts);
    return res.data;
  }

  async getMerchantPlans(data: { merchant: string }, opts?: RequestOptions): Promise<number[]> {
    const res = await this.request<number[]>('POST', '/get_merchant_plans', data, opts);
    return res.data;
  }

  // ── Subscription APIs ────────────────────────────────────────────────────────

  async subscribe(
    data: { subscriber: string; plan_id: number },
    opts?: RequestOptions,
  ): Promise<number> {
    const res = await this.request<number>('POST', '/subscribe', data, {
      ...opts,
      idempotencyKey: opts?.idempotencyKey ?? generateRequestId(),
    });
    return res.data;
  }

  async cancelSubscription(
    data: SubscriberSubscriptionRequest,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request<void>('POST', '/cancel_subscription', data, opts);
  }

  async pauseSubscription(
    data: SubscriberSubscriptionRequest,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request<void>('POST', '/pause_subscription', data, opts);
  }

  async resumeSubscription(
    data: SubscriberSubscriptionRequest,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request<void>('POST', '/resume_subscription', data, opts);
  }

  async chargeSubscription(
    data: SubscriptionIdRequest,
    opts?: RequestOptions,
  ): Promise<void> {
    await this.request<void>('POST', '/charge_subscription', data, {
      ...opts,
      idempotencyKey: opts?.idempotencyKey ?? generateRequestId(),
    });
  }

  async getSubscription(
    data: SubscriptionIdRequest,
    opts?: RequestOptions,
  ): Promise<Subscription> {
    const res = await this.request<Subscription>('POST', '/get_subscription', data, opts);
    return res.data;
  }

  async getSubscriptionCount(opts?: RequestOptions): Promise<number> {
    const res = await this.request<number>('POST', '/get_subscription_count', undefined, opts);
    return res.data;
  }

  async getUserSubscriptions(
    data: SubscriberRequest,
    opts?: RequestOptions,
  ): Promise<number[]> {
    const res = await this.request<number[]>('POST', '/get_user_subscriptions', data, opts);
    return res.data;
  }

  // ── REST Subscription APIs ───────────────────────────────────────────────────

  async getSubscriptions(opts?: RequestOptions): Promise<Subscription[]> {
    const res = await this.request<Subscription[]>('GET', '/v1/subscriptions', undefined, opts);
    return res.data;
  }

  async createSubscription(
    data: Omit<Subscription, 'id' | 'status'>,
    opts?: RequestOptions,
  ): Promise<Subscription> {
    const res = await this.request<Subscription>('POST', '/v1/subscriptions', data, {
      ...opts,
      idempotencyKey: opts?.idempotencyKey ?? generateRequestId(),
    });
    return res.data;
  }

  // ── Refund APIs ──────────────────────────────────────────────────────────────

  async requestRefund(data: RequestRefundRequest, opts?: RequestOptions): Promise<void> {
    await this.request<void>('POST', '/request_refund', data, {
      ...opts,
      idempotencyKey: opts?.idempotencyKey ?? generateRequestId(),
    });
  }

  async approveRefund(data: SubscriptionIdRequest, opts?: RequestOptions): Promise<void> {
    await this.request<void>('POST', '/approve_refund', data, opts);
  }

  async rejectRefund(data: SubscriptionIdRequest, opts?: RequestOptions): Promise<void> {
    await this.request<void>('POST', '/reject_refund', data, opts);
  }

  // ── Webhook APIs ─────────────────────────────────────────────────────────────

  async getWebhooks(opts?: RequestOptions): Promise<Webhook[]> {
    const res = await this.request<Webhook[]>('GET', '/v1/webhooks', undefined, opts);
    return res.data;
  }

  async createWebhook(
    data: Omit<Webhook, 'id'>,
    opts?: RequestOptions,
  ): Promise<Webhook> {
    const res = await this.request<Webhook>('POST', '/v1/webhooks', data, opts);
    return res.data;
  }
}
