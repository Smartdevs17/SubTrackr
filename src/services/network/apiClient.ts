/**
 * Traced HTTP client for the mobile app.
 *
 * Every request opens a client span and injects a W3C `traceparent` header so the
 * backend can continue the same trace — giving an end-to-end view from a user tap
 * through API → ML → webhook. The client is a thin wrapper over `fetch` (so the
 * E2E mock-network interceptor still applies) and adds timing, status and error
 * attributes to the span. Sensitive headers are never recorded.
 */

import { formatTraceparent, mobileTracer, MobileSpan, MobileTracer } from './trace';
import { CircuitBreaker, CircuitBreakerOptions } from './circuitBreaker';
import {
  CertificatePinner,
  CertificatePinningConfig,
  CertificatePinningError,
  defaultPeerCertificateProvider,
  hostnameOf,
  PeerCertificateProvider,
} from './certificatePinning';

export interface ApiCertificatePinningOptions {
  /** Pre-built pinner; takes precedence over `config`. */
  pinner?: CertificatePinner;
  /** Raw pin configuration (e.g. from build-time env / remote config). */
  config?: CertificatePinningConfig;
  /** Source of the peer SPKI hash; defaults to the native TLS hook. */
  peerCertificateProvider?: PeerCertificateProvider;
}

export interface ApiClientOptions {
  baseUrl?: string;
  tracer?: MobileTracer;
  fetchImpl?: typeof fetch;
  /** Default headers merged into every request (e.g. content-type). */
  defaultHeaders?: Record<string, string>;
  /** Optional circuit breaker configuration */
  circuitBreaker?: CircuitBreakerOptions;
  /**
   * Certificate pinning. Defaults to `CertificatePinner.fromEnv()` with the
   * native TLS hook provider — i.e. config-driven, and a no-op until pins or
   * the native provider are configured.
   */
  certificatePinning?: ApiCertificatePinningOptions;
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
  private readonly circuitBreaker: CircuitBreaker;
  private readonly pinner: CertificatePinner;
  private readonly peerCertificateProvider: PeerCertificateProvider;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(
      /\/$/,
      ''
    );
    this.tracer = options.tracer ?? mobileTracer;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.defaultHeaders = { 'Content-Type': 'application/json', ...options.defaultHeaders };
    this.circuitBreaker = new CircuitBreaker({
      name: 'frontend-api-client',
      tracer: this.tracer,
      ...options.circuitBreaker,
    });
    const pinning = options.certificatePinning ?? {};
    this.pinner =
      pinning.pinner ??
      (pinning.config ? new CertificatePinner(pinning.config) : CertificatePinner.fromEnv());
    this.peerCertificateProvider =
      pinning.peerCertificateProvider ?? defaultPeerCertificateProvider;
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
      await this.verifyCertificate(url, span);

      let response: Response;
      try {
        response = await this.circuitBreaker.execute(async () => {
          const res = await this.fetchImpl(url, {
            method,
            headers,
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
          });
          if (res.status >= 500) {
            throw res;
          }
          return res;
        });
      } catch (err) {
        if (err instanceof Response) {
          response = err;
        } else {
          throw err;
        }
      }

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

  /**
   * Verify the peer certificate against the configured pins for HTTPS URLs.
   * Non-HTTPS requests (local dev, mock E2E hosts) are skipped. Throws
   * `CertificatePinningError` when the fallback/mode says the request must not
   * proceed; in `report` mode mismatches are only recorded on the span.
   */
  private async verifyCertificate(url: string, span: MobileSpan): Promise<void> {
    if (!/^https:\/\//i.test(url)) return;

    const hostname = hostnameOf(url);
    let peer = null;
    try {
      peer = await this.peerCertificateProvider(url);
    } catch {
      peer = null; // provider failure → treated as "unavailable"
    }

    const result = this.pinner.verify(hostname, peer);
    span.attributes['security.cert_pinning.mode'] = this.pinner.getMode();
    span.attributes['security.cert_pinning.status'] = result.status;

    if (!result.ok) {
      // Span attributes above stay attached; the caller's catch ends the span.
      throw new CertificatePinningError(result);
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
