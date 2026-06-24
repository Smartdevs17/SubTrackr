/**
 * Admin dashboard security headers.
 *
 * Issue #611: the developer portal renders admin-authored content (including
 * template previews), so its pages must carry a hardened Content-Security-
 * Policy as defence-in-depth against any HTML that escapes sanitization.
 *
 * This re-exports the shared CSP builder configured for the portal so every
 * dashboard route uses one consistent policy. Wire `adminDashboardHeaders()`
 * into your Next.js `headers()` config (or middleware) for the portal routes.
 */

import {
  buildCspHeader,
  securityHeaders,
  nextSecurityHeaders,
  type CspOptions,
} from '../../backend/shared/middleware/cspMiddleware';

/**
 * Portal-tuned CSP options. Override `connectSrc` with the API origin if the
 * dashboard calls a different host than it is served from.
 */
export function portalCspOptions(apiOrigin?: string): CspOptions {
  return {
    connectSrc: apiOrigin ? [apiOrigin] : [],
    imgSrc: [],
  };
}

/** Header map for Express/Connect-style portal servers. */
export function adminDashboardHeaders(apiOrigin?: string): Record<string, string> {
  return securityHeaders(portalCspOptions(apiOrigin));
}

/** Entries for a Next.js `headers()` config covering admin dashboard routes. */
export function adminDashboardNextHeaders(apiOrigin?: string): Array<{ key: string; value: string }> {
  return nextSecurityHeaders(portalCspOptions(apiOrigin));
}

/** The raw CSP header (name + value) for the admin dashboard. */
export function adminDashboardCsp(apiOrigin?: string): { name: string; value: string } {
  return buildCspHeader(portalCspOptions(apiOrigin));
}
