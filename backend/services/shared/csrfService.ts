/**
 * Issue #1005 – CSRF Protection with Double-Submit Cookie
 *
 * Implements the "Double-Submit Cookie" strategy for CSRF mitigation:
 *
 *   1. On the first visit (or token refresh), the server generates a
 *      cryptographically random token and sends it to the client as a cookie
 *      (`__Host-csrf` by default) AND echoes it in a response header so that
 *      SPAs/mobile apps can read it without cookie-jar access.
 *
 *   2. On subsequent state-mutating requests (POST / PUT / PATCH / DELETE),
 *      the client echoes the token back in the `X-CSRF-Token` request header.
 *
 *   3. The server verifies that the header value matches the cookie value
 *      using a constant-time comparison (prevents timing attacks).
 *
 * Why double-submit works:
 *   Cross-origin attackers cannot read the cookie value from a victim's browser
 *   (same-origin policy), so they cannot forge the matching header. The attack
 *   surface is eliminated without any server-side session state.
 *
 * Exports:
 *   - `generateCsrfToken()`         – generate a new random token
 *   - `verifyCsrfToken(a, b)`       – constant-time equality check
 *   - `parseCookies(header)`        – parse a raw Cookie header string
 *   - `buildCsrfCookieValue(token)` – format a Set-Cookie header value
 *   - `CsrfService`                 – stateless service class wrapping all helpers
 *   - `csrfService`                 – singleton instance
 *   - `createCsrfMiddleware(opts?)` – Express/Fastify-compatible middleware factory
 */

import { randomBytes, timingSafeEqual } from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Default name for the CSRF cookie.  The `__Host-` prefix enforces Secure + no Domain. */
export const CSRF_COOKIE_NAME = '__Host-csrf' as const;

/** Request header clients must echo the CSRF token in. */
export const CSRF_HEADER_NAME = 'X-CSRF-Token' as const;

/** Response header the server uses to send the token to JavaScript clients. */
export const CSRF_TOKEN_RESPONSE_HEADER = 'X-CSRF-Token' as const;

/** Token byte length (32 bytes → 64 hex characters). */
const TOKEN_BYTES = 32;

/** HTTP methods that require CSRF verification. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ─────────────────────────────────────────────────────────────────────────────
// Token generation & verification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random CSRF token (64 hex characters).
 *
 * @example
 * const token = generateCsrfToken();
 * // → 'a3f1c2...' (64 chars)
 */
export function generateCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Compare two CSRF token strings in constant time to prevent timing attacks.
 *
 * Returns `false` immediately (without a timing-safe comparison) when the
 * strings differ in length, because differing lengths do not leak bit-level
 * information about the secret.
 *
 * @param a - Token from the cookie.
 * @param b - Token from the request header.
 */
export function verifyCsrfToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw `Cookie` request header string into a key→value map.
 *
 * @example
 * parseCookies('__Host-csrf=abc123; sessionId=xyz')
 * // → { '__Host-csrf': 'abc123', sessionId: 'xyz' }
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie builder
// ─────────────────────────────────────────────────────────────────────────────

/** Options for the CSRF cookie. */
export interface CsrfCookieOptions {
  /**
   * Cookie name.
   * @default '__Host-csrf'
   */
  cookieName?: string;
  /**
   * Cookie max-age in seconds.
   * @default 86400 (24 hours)
   */
  maxAgeSeconds?: number;
  /**
   * Set the `SameSite` attribute.
   * - `'Strict'` – cookie not sent on cross-site navigations (most restrictive)
   * - `'Lax'`    – sent on top-level navigations (recommended default)
   * - `'None'`   – requires `Secure`; only for cross-site API use cases
   * @default 'Strict'
   */
  sameSite?: 'Strict' | 'Lax' | 'None';
  /**
   * Whether the cookie requires HTTPS.
   * Should always be `true` in production.
   * @default true
   */
  secure?: boolean;
  /**
   * Set the cookie `Path`.
   * The `__Host-` prefix requires `Path=/`.
   * @default '/'
   */
  path?: string;
}

/**
 * Build a `Set-Cookie` header value for the CSRF token.
 *
 * @example
 * buildCsrfCookieValue('abc123')
 * // → '__Host-csrf=abc123; Path=/; SameSite=Strict; Secure; Max-Age=86400'
 */
export function buildCsrfCookieValue(token: string, opts: CsrfCookieOptions = {}): string {
  const {
    cookieName = CSRF_COOKIE_NAME,
    maxAgeSeconds = 86_400,
    sameSite = 'Strict',
    secure = true,
    path = '/',
  } = opts;

  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];

  if (secure) parts.push('Secure');
  if (maxAgeSeconds > 0) parts.push(`Max-Age=${maxAgeSeconds}`);

  // HttpOnly is intentionally omitted: JavaScript must be able to read the
  // cookie value to forward it in the request header (double-submit pattern).

  return parts.join('; ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware types
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal request interface the CSRF middleware works with. */
export interface CsrfRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string>;
}

/** Minimal response interface the CSRF middleware works with. */
export interface CsrfResponse {
  setHeader(name: string, value: string): void;
}

/** Options for `createCsrfMiddleware`. */
export interface CsrfMiddlewareOptions {
  /** Cookie configuration forwarded to `buildCsrfCookieValue`. */
  cookie?: CsrfCookieOptions;
  /**
   * Override which HTTP methods are considered unsafe and require CSRF verification.
   * @default ['POST', 'PUT', 'PATCH', 'DELETE']
   */
  unsafeMethods?: string[];
  /**
   * Paths that should skip CSRF verification (e.g. webhook endpoints that use
   * a separate HMAC-based verification).
   */
  skipPaths?: string[];
  /**
   * Extract the URL path from the request.  Override when using a framework
   * that exposes the path differently (e.g. `req.path` in Express).
   */
  getPath?: (req: CsrfRequest) => string | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// CsrfService class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stateless CSRF service exposing the double-submit cookie helpers.
 *
 * @example
 * const service = new CsrfService();
 *
 * // Issue a token
 * const token = service.generateToken();
 * res.setHeader('Set-Cookie', service.buildCookieValue(token));
 * res.setHeader('X-CSRF-Token', token);
 *
 * // Verify on incoming request
 * const cookieToken = service.extractFromCookie(req.headers.cookie);
 * const headerToken = service.extractFromHeader(req.headers);
 * if (!service.verify(cookieToken, headerToken)) {
 *   throw new Error('CSRF token mismatch');
 * }
 */
export class CsrfService {
  private readonly cookieName: string;
  private readonly cookieOpts: CsrfCookieOptions;

  constructor(opts: CsrfCookieOptions = {}) {
    this.cookieName = opts.cookieName ?? CSRF_COOKIE_NAME;
    this.cookieOpts = opts;
  }

  /** Generate a new random CSRF token. */
  generateToken(): string {
    return generateCsrfToken();
  }

  /**
   * Constant-time comparison of two CSRF tokens.
   * Returns `true` if they match.
   */
  verify(cookieToken: string | undefined, headerToken: string | undefined): boolean {
    if (!cookieToken || !headerToken) return false;
    return verifyCsrfToken(cookieToken, headerToken);
  }

  /**
   * Extract the CSRF token from a raw `Cookie` header string.
   * Returns `undefined` if the cookie is absent.
   */
  extractFromCookie(cookieHeader: string | undefined): string | undefined {
    const cookies = parseCookies(cookieHeader);
    return cookies[this.cookieName];
  }

  /**
   * Extract the CSRF token from request headers.
   * Looks for `X-CSRF-Token` (case-insensitive lookup via lower-cased keys).
   */
  extractFromHeader(headers: Record<string, string | string[] | undefined>): string | undefined {
    const key = CSRF_HEADER_NAME.toLowerCase();
    const value = headers[key] ?? headers[CSRF_HEADER_NAME];
    if (Array.isArray(value)) return value[0];
    return value;
  }

  /**
   * Build a `Set-Cookie` header value for the given token.
   */
  buildCookieValue(token: string): string {
    return buildCsrfCookieValue(token, this.cookieOpts);
  }
}

export const csrfService = new CsrfService();

// ─────────────────────────────────────────────────────────────────────────────
// Middleware factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an Express/Fastify-compatible CSRF middleware using the double-submit
 * cookie pattern.
 *
 * **Behaviour**:
 * - Safe methods (GET, HEAD, OPTIONS): a fresh CSRF token is issued if the
 *   request does not already carry one, and set on the response cookie +
 *   header so the client can read it.
 * - Unsafe methods (POST, PUT, PATCH, DELETE): the middleware verifies that the
 *   `X-CSRF-Token` request header matches the `__Host-csrf` cookie value.  On
 *   mismatch it calls `next(err)` with a 403-level error.
 *
 * @example
 * // Express
 * app.use(cookieParser());
 * app.use(createCsrfMiddleware());
 *
 * // With custom options
 * app.use(createCsrfMiddleware({
 *   cookie: { sameSite: 'Lax', maxAgeSeconds: 3600 },
 *   skipPaths: ['/webhooks/stripe'],
 * }));
 */
export function createCsrfMiddleware(opts: CsrfMiddlewareOptions = {}) {
  const {
    cookie: cookieOpts = {},
    unsafeMethods = [...UNSAFE_METHODS],
    skipPaths = [],
    getPath,
  } = opts;

  const service = new CsrfService(cookieOpts);
  const cookieName = cookieOpts.cookieName ?? CSRF_COOKIE_NAME;
  const unsafeSet = new Set(unsafeMethods.map((m) => m.toUpperCase()));

  return function csrfMiddleware(
    req: CsrfRequest & { url?: string; path?: string },
    res: CsrfResponse,
    next: (err?: Error) => void,
  ): void {
    // Resolve the request path for skip-list matching
    const path =
      getPath?.(req) ??
      (req as { path?: string }).path ??
      (req as { url?: string }).url ??
      '';

    if (skipPaths.some((p) => path.startsWith(p))) {
      next();
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();

    // Extract the cookie token (supports both cookie-parser and raw header)
    const cookieHeader =
      typeof req.cookies === 'object' && req.cookies !== null
        ? Object.entries(req.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ')
        : (req.headers['cookie'] as string | undefined);

    const cookieToken = service.extractFromCookie(cookieHeader);

    if (unsafeSet.has(method)) {
      // ── Verify ──────────────────────────────────────────────────────────
      const headerToken = service.extractFromHeader(req.headers);

      if (!service.verify(cookieToken, headerToken)) {
        const err = Object.assign(new Error('CSRF token invalid or missing'), {
          status: 403,
          code: 'CSRF_TOKEN_MISMATCH',
        });
        next(err);
        return;
      }
      next();
    } else {
      // ── Issue / refresh token ────────────────────────────────────────────
      const token = cookieToken ?? service.generateToken();

      if (!cookieToken) {
        // Only set the cookie when there is no existing token
        res.setHeader('Set-Cookie', service.buildCookieValue(token));
      }

      // Always expose the token in the response header for JS clients
      res.setHeader(CSRF_TOKEN_RESPONSE_HEADER, token);
      next();
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route helper – manually issue a new token in an endpoint response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue a brand-new CSRF token and set the cookie + response header.
 * Call this from a dedicated `GET /csrf-token` route so clients can
 * bootstrap the token before making their first mutating request.
 *
 * @example
 * // Express route
 * app.get('/csrf-token', (req, res) => {
 *   issueCsrfToken(res, csrfService);
 *   res.json({ ok: true });
 * });
 */
export function issueCsrfToken(
  res: CsrfResponse,
  service: CsrfService = csrfService,
  cookieOpts: CsrfCookieOptions = {},
): string {
  const token = service.generateToken();
  res.setHeader('Set-Cookie', buildCsrfCookieValue(token, cookieOpts));
  res.setHeader(CSRF_TOKEN_RESPONSE_HEADER, token);
  return token;
}
