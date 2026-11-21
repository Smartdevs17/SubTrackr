/**
 * Strict CORS allow-list for the developer portal (issue #2101).
 *
 * Only origins listed in DEVELOPER_PORTAL_CORS_ALLOWED_ORIGINS (comma-separated,
 * exact `scheme://host[:port]` values) receive CORS headers. Wildcards are
 * rejected at parse time, and the request Origin is never reflected unless it
 * is an exact member of the list.
 */

export const CORS_ALLOWED_ORIGINS_ENV = 'DEVELOPER_PORTAL_CORS_ALLOWED_ORIGINS';

/**
 * Parse the comma-separated env value into normalized exact origins.
 * Throws on wildcards, non-http(s) schemes, or values carrying a path, query or fragment.
 */
export function parseCorsAllowList(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry.includes('*')) {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV}: wildcard origins are not allowed ("${entry}")`);
      }

      let url: URL;
      try {
        url = new URL(entry);
      } catch {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV}: invalid origin "${entry}"`);
      }

      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash) {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV}: origin must be scheme://host[:port] ("${entry}")`);
      }

      return url.origin;
    });
}

/** Read and parse the allow-list from the environment. */
export function getPortalCorsAllowList(env: NodeJS.ProcessEnv = process.env): string[] {
  return parseCorsAllowList(env[CORS_ALLOWED_ORIGINS_ENV]);
}

/**
 * Compute CORS response headers for a request.
 *
 * - Missing or non-allow-listed Origin: only `Vary: Origin`, so no
 *   Access-Control-* headers are sent and the browser blocks the response.
 * - Allow-listed Origin: the exact origin is echoed back (never `*`), with
 *   `Access-Control-Allow-Credentials: true` so cookies or auth headers work.
 */
export function getCorsHeaders(
  requestOrigin: string | undefined,
  allowList: readonly string[]
): Record<string, string> {
  if (!requestOrigin || !allowList.includes(requestOrigin)) {
    return { Vary: 'Origin' };
  }

  return {
    Vary: 'Origin',
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Credentials': 'true',
  };
}
