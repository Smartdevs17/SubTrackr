/**
 * Content-Security-Policy middleware for the admin dashboard.
 *
 * Issue #611: even with stored rich-text sanitized, the admin dashboard needs a
 * CSP as defence-in-depth so any HTML that slips through cannot execute inline
 * scripts or load hostile objects. `script-src 'self'` blocks inline/injected
 * scripts; `object-src 'none'` blocks <object>/<embed>/Flash vectors.
 *
 * Framework-agnostic: `buildCspHeader()` returns the header value, and small
 * adapters are provided for Express-style and Next.js responses.
 */

export interface CspOptions {
  /** Extra hosts to allow for images (e.g. a CDN). Default: none beyond self/data/https. */
  imgSrc?: string[];
  /** Extra hosts to allow for XHR/fetch (e.g. the API origin). */
  connectSrc?: string[];
  /** Report-only mode emits the header without enforcing it. Default: false. */
  reportOnly?: boolean;
  /** Optional reporting endpoint. */
  reportUri?: string;
}

/** The hardened CSP directive set for admin pages. */
export function buildCspHeader(options: CspOptions = {}): { name: string; value: string } {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'frame-ancestors': ["'self'"],
    'form-action': ["'self'"],
    // Allow inline styles (rich-text uses the style attribute) but no inline JS.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:', ...(options.imgSrc ?? [])],
    'connect-src': ["'self'", ...(options.connectSrc ?? [])],
    'font-src': ["'self'", 'data:'],
  };

  if (options.reportUri) {
    directives['report-uri'] = [options.reportUri];
  }

  const value = Object.entries(directives)
    .map(([key, vals]) => `${key} ${vals.join(' ')}`)
    .join('; ');

  return {
    name: options.reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy',
    value,
  };
}

/** Companion security headers that pair with the CSP. */
export function securityHeaders(options: CspOptions = {}): Record<string, string> {
  const csp = buildCspHeader(options);
  return {
    [csp.name]: csp.value,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

/** Express/Connect-style middleware. */
export function cspMiddleware(options: CspOptions = {}) {
  const headers = securityHeaders(options);
  return function applyCsp(
    _req: unknown,
    res: { setHeader(name: string, value: string): void },
    next: () => void,
  ): void {
    for (const [name, value] of Object.entries(headers)) {
      res.setHeader(name, value);
    }
    next();
  };
}

/** Next.js `headers()` config entries for admin dashboard routes. */
export function nextSecurityHeaders(options: CspOptions = {}): Array<{ key: string; value: string }> {
  return Object.entries(securityHeaders(options)).map(([key, value]) => ({ key, value }));
}
