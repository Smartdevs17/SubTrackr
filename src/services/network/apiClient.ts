/**
 * Traced HTTP client for the mobile app.
 *
 * Every request opens a client span and injects a W3C `traceparent` header so the
 * backend can continue the same trace — giving an end-to-end view from a user tap
 * through API → ML → webhook. The client is a thin wrapper over `fetch` (so the
 * E2E mock-network interceptor still applies) and adds timing, status and error
 * attributes to the span. Sensitive headers are never recorded.
 */

import { formatTraceparent, mobileTracer, MobileTracer } from './trace';

export interface ApiClientOptions {
  baseUrl?: string;
  tracer?: MobileTracer;
  fetchImpl?: typeof fetch;
  /** Default headers merged into every request (e.g. content-type). */
  defaultHeaders?: Record<string, string>;
}

export interface ApiRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Logical operation name for the span; defaults to "METHOD path". */
  spanName?: string;
}

export interface ApiResponse<T> {
  status: number;
  ok: boolean;
  data: T;
  traceId: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly tracer: MobileTracer;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(
      /\/$/,
      ''
    );
    this.tracer = options.tracer ?? mobileTracer;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultHeaders = { 'Content-Type': 'application/json', ...options.defaultHeaders };
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<ApiResponse<T>> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const span = this.tracer.startClientSpan(options.spanName ?? `${method} ${path}`, {
      'http.method': method,
      'http.url': path, // path only — avoids leaking query-string PII
    });

    // Propagate trace context downstream.
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options.headers,
      traceparent: formatTraceparent(span.context),
    };

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

      const text = await response.text();
      const data = (text ? JSON.parse(text) : null) as T;

      this.tracer.endSpan(span, response.ok ? 'ok' : 'error', {
        'http.status_code': response.status,
      });

      return { status: response.status, ok: response.ok, data, traceId: span.context.traceId };
    } catch (error) {
      this.tracer.endSpan(span, 'error', {
        'error.message': error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  get<T>(
    path: string,
    options: Omit<ApiRequestOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(
    path: string,
    body?: unknown,
    options: Omit<ApiRequestOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }
}

/** Shared client instance for app code. */
export const apiClient = new ApiClient();
