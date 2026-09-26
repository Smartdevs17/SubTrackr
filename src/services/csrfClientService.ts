/**
 * Issue #1005 – CSRF Client Service (src/services layer)
 *
 * This module provides the **client-side** counterpart to the backend CSRF
 * double-submit cookie middleware.  It handles:
 *
 *   1. Fetching a CSRF token from a dedicated backend endpoint.
 *   2. Caching the token in memory with an expiry window.
 *   3. Providing a helper to inject the `X-CSRF-Token` header into outgoing
 *      fetch / axios requests automatically.
 *   4. Auto-refreshing the token when it is near expiry or when the server
 *      returns a 403 with code `CSRF_TOKEN_MISMATCH`.
 *
 * Usage:
 * ```ts
 * // One-time setup (e.g. in App.tsx or a root provider)
 * await csrfClientService.prefetch();
 *
 * // Later, in any API call:
 * const headers = await csrfClientService.getHeaders();
 * await fetch('/api/subscriptions', { method: 'POST', headers, body: JSON.stringify(data) });
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Request/response header name for the CSRF token. */
export const CSRF_HEADER_NAME = 'X-CSRF-Token' as const;

/** Default endpoint to fetch a fresh CSRF token from. */
const DEFAULT_TOKEN_ENDPOINT = '/api/csrf-token';

/** Token lifetime in ms before client proactively refreshes. */
const TOKEN_TTL_MS = 20 * 60 * 1_000; // 20 minutes

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CsrfClientOptions {
  /**
   * Endpoint that returns a fresh CSRF token in the `X-CSRF-Token` response
   * header and the cookie.
   * @default '/api/csrf-token'
   */
  tokenEndpoint?: string;

  /**
   * Lifetime of the cached token in milliseconds before it is proactively
   * refreshed.
   * @default 1_200_000 (20 minutes)
   */
  tokenTtlMs?: number;

  /**
   * Inject a custom fetch implementation (useful in tests and React Native).
   */
  fetchImpl?: typeof fetch;
}

export interface CsrfTokenEntry {
  token: string;
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CsrfClientService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Client-side CSRF token manager for the SubTrackr frontend.
 *
 * The service is stateful but small: it caches one token at a time and
 * transparently refreshes it when needed.  Thread-safety is not a concern in
 * the JavaScript single-threaded model; a single in-flight refresh promise is
 * deduplicated to prevent stampedes.
 */
export class CsrfClientService {
  private readonly endpoint: string;
  private readonly ttlMs: number;
  private readonly fetchImpl: typeof fetch;

  private cached: CsrfTokenEntry | null = null;
  /** Pending refresh promise – deduplicated so only one fetch is in-flight. */
  private refreshPromise: Promise<string> | null = null;

  constructor(opts: CsrfClientOptions = {}) {
    this.endpoint = opts.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT;
    this.ttlMs = opts.tokenTtlMs ?? TOKEN_TTL_MS;
    this.fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : _noFetch);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Retrieve the current cached CSRF token, refreshing it if absent or expired.
   *
   * @returns The CSRF token string.
   */
  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached.token;
    }
    return this.refresh();
  }

  /**
   * Return a headers object ready to merge into any fetch/axios call.
   *
   * @example
   * const headers = await csrfClientService.getHeaders();
   * await fetch('/api/pay', { method: 'POST', headers, body: JSON.stringify(payload) });
   */
  async getHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return { [CSRF_HEADER_NAME]: token };
  }

  /**
   * Eagerly fetch and cache a token.  Call this once during app bootstrap so
   * the first mutating request doesn't have to wait for a round-trip.
   */
  async prefetch(): Promise<void> {
    await this.refresh();
  }

  /**
   * Inject the CSRF header into an existing headers object (mutates in-place).
   *
   * @example
   * const headers: Record<string, string> = { 'Content-Type': 'application/json' };
   * await csrfClientService.injectHeader(headers);
   * // headers now also contains X-CSRF-Token
   */
  async injectHeader(headers: Record<string, string>): Promise<void> {
    const token = await this.getToken();
    headers[CSRF_HEADER_NAME] = token;
  }

  /**
   * Manually set a token (e.g. extracted from a server-rendered `<meta>` tag
   * or a previous response header).
   */
  setToken(token: string): void {
    this.cached = { token, expiresAt: Date.now() + this.ttlMs };
  }

  /**
   * Clear the cached token.  The next call to `getToken()` will fetch a fresh one.
   */
  clearToken(): void {
    this.cached = null;
    this.refreshPromise = null;
  }

  /**
   * Check whether the current cached token is still valid.
   */
  isTokenValid(): boolean {
    return this.cached !== null && Date.now() < this.cached.expiresAt;
  }

  /**
   * Wrap a fetch call so that 403 CSRF errors automatically trigger a token
   * refresh and one retry.
   *
   * @example
   * const res = await csrfClientService.fetchWithRetry('/api/subscriptions', {
   *   method: 'POST',
   *   body: JSON.stringify(data),
   * });
   */
  async fetchWithRetry(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = await this.getHeaders();
    const mergedInit: RequestInit = {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...headers },
    };

    const response = await this.fetchImpl(url, mergedInit);

    if (response.status === 403) {
      let body: { code?: string } = {};
      try {
        body = await response.clone().json() as { code?: string };
      } catch {
        // ignore parse errors
      }

      if (body?.code === 'CSRF_TOKEN_MISMATCH') {
        // Token was rejected – clear cache and retry once with a fresh token
        this.clearToken();
        const retryHeaders = await this.getHeaders();
        return this.fetchImpl(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), ...retryHeaders },
        });
      }
    }

    return response;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Fetch a fresh token from the server and cache it.
   * Deduplicates concurrent calls so only one HTTP request is made.
   */
  private refresh(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.fetchImpl(this.endpoint, {
      method: 'GET',
      credentials: 'include', // sends cookies cross-origin if needed
    })
      .then((res) => {
        const token = res.headers.get(CSRF_HEADER_NAME);
        if (!token) {
          throw new Error(
            `[CsrfClientService] No ${CSRF_HEADER_NAME} header in response from ${this.endpoint}`,
          );
        }
        this.cached = { token, expiresAt: Date.now() + this.ttlMs };
        return token;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }
}

/** Fallback when `fetch` is not globally available (e.g. some test environments). */
function _noFetch(): never {
  throw new Error('[CsrfClientService] fetch is not available in this environment');
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton export
// ─────────────────────────────────────────────────────────────────────────────

/** Pre-configured singleton – ready to use immediately. */
export const csrfClientService = new CsrfClientService();
