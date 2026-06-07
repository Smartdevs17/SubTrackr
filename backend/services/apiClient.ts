/**
 * Issue #401 – API Client for the standardised response envelope
 *
 * This thin client wraps fetch (or any compatible implementation) and:
 *   1. Attaches X-Request-ID and X-API-Version headers on every request.
 *   2. Parses the ApiResponse<T> envelope returned by the backend.
 *   3. Throws a typed ApiClientError on failure responses so callers can
 *      pattern-match on `error.code` instead of raw HTTP status codes.
 *   4. Exposes a `paginate` helper for cursor-based list endpoints.
 *
 * Backward compatibility:
 *   If the server does NOT return the X-API-Version header the client falls
 *   back to treating the raw JSON body as `data` so that legacy endpoints
 *   continue to work without changes.
 */

import { randomUUID } from 'crypto';
import type {
  ApiResponse,
  ApiErrorResponse,
  ApiSuccessResponse,
  ErrorCode,
  PaginationMeta,
} from './apiResponse';
import { API_VERSION_HEADER, REQUEST_ID_HEADER } from './apiResponse';
import { IDEMPOTENCY_KEY_HEADER, generateIdempotencyKey } from './idempotencyService';

// ─────────────────────────────────────────────────────────────────────────────
// Typed error
// ─────────────────────────────────────────────────────────────────────────────

export class ApiClientError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly requestId: string;
  readonly details?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    requestId: string,
    details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = requestId;
    this.details = details;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client options
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiClientOptions {
  /** Base URL prepended to every path, e.g. "https://api.subtrackr.io". */
  baseUrl: string;
  /** Default headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Inject a custom fetch implementation (useful for testing). */
  fetchImpl?: typeof fetch;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────────────

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // ── Core request method ──────────────────────────────────────────────────

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<ApiSuccessResponse<T>> {
    const requestId = randomUUID();
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [REQUEST_ID_HEADER]: requestId,
      ...this.defaultHeaders,
      ...extraHeaders,
    };

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const rawJson: unknown = await response.json();

    // ── Backward-compatibility: detect envelope vs. legacy response ──────
    const isEnveloped = response.headers.get(API_VERSION_HEADER) !== null;

    if (!isEnveloped) {
      // Legacy endpoint – wrap the raw body in a synthetic success envelope.
      return {
        success: true,
        data: rawJson as T,
        meta: {
          timestamp: new Date().toISOString(),
          requestId,
          apiVersion: 0, // 0 signals "legacy, no envelope"
        },
      };
    }

    const envelope = rawJson as ApiResponse<T>;

    if (!envelope.success) {
      const errEnv = envelope as ApiErrorResponse;
      throw new ApiClientError(
        errEnv.error.code,
        errEnv.error.message,
        response.status,
        errEnv.meta.requestId,
        errEnv.error.details,
      );
    }

    return envelope as ApiSuccessResponse<T>;
  }

  // ── Convenience methods ──────────────────────────────────────────────────

  get<T>(path: string, headers?: Record<string, string>) {
    return this.request<T>('GET', path, undefined, headers);
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', path, body, headers);
  }

  put<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('PUT', path, body, headers);
  }

  patch<T>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('PATCH', path, body, headers);
  }

  delete<T>(path: string, headers?: Record<string, string>) {
    return this.request<T>('DELETE', path, undefined, headers);
  }

  /**
   * POST with an Idempotency-Key header attached.
   * Pass an explicit key to reuse one (e.g. on retry); omit to auto-generate.
   * Use this for all payment-mutating endpoints to prevent double charges.
   */
  postIdempotent<T>(
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    headers?: Record<string, string>,
  ) {
    const key = idempotencyKey ?? generateIdempotencyKey();
    return this.request<T>('POST', path, body, {
      ...headers,
      [IDEMPOTENCY_KEY_HEADER]: key,
    });
  }

  // ── Cursor-based pagination helper ───────────────────────────────────────

  /**
   * Iterate through all pages of a cursor-based list endpoint.
   *
   * @example
   * for await (const page of client.paginate<Subscription>('/subscriptions')) {
   *   process(page.data);
   * }
   */
  async *paginate<T>(
    path: string,
    params: Record<string, string> = {},
  ): AsyncGenerator<ApiSuccessResponse<T[]>> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const query = new URLSearchParams(params);
      if (cursor) query.set('cursor', cursor);

      const fullPath = query.toString() ? `${path}?${query}` : path;
      const page = await this.get<T[]>(fullPath);

      yield page;

      const pagination: PaginationMeta | undefined = page.meta.pagination;
      hasMore = pagination?.hasMore ?? false;
      cursor = pagination?.cursor;
    }
  }
}
