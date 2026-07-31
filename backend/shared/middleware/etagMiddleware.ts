/**
 * ETag caching middleware.
 *
 * Generates ETags from response bodies and handles conditional GET requests:
 *   - Attaches ETag header to cacheable responses
 *   - Handles If-None-Match → 304 Not Modified for matching ETags
 *   - Sets per-endpoint Cache-Control headers with stale-while-revalidate
 *   - Bypasses ETag logic for authenticated (private) requests
 *   - Prevents ETag collisions via strong entity tags (SHA-256 hex prefix)
 *
 * Usage (Express-style or raw http.Server):
 *   app.use(etagMiddleware());
 *
 * Per-endpoint TTL override:
 *   res.locals.cacheTtl = 600;   // 10 min for this route
 *   res.locals.cacheScope = 'private';  // skip CDN caching
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Constants ─────────────────────────────────────────────────────────────────

export const ETAG_HEADER = 'ETag';
export const IF_NONE_MATCH_HEADER = 'if-none-match';
export const VARY_HEADER = 'Vary';

// Re-use the same string literal as cacheHeaders.ts — not re-exported here to
// avoid a barrel-level duplicate.  Internal use only in this module.
const CACHE_CONTROL_HEADER_NAME = 'Cache-Control';

/** Default public TTL in seconds (5 min). */
export const DEFAULT_PUBLIC_TTL_SECONDS = 300;
/** Stale-while-revalidate window in seconds. */
export const DEFAULT_SWR_SECONDS = 60;
/** Minimum body size (bytes) to bother generating an ETag. */
export const MIN_BODY_SIZE_FOR_ETAG = 8;

/**
 * Per-path Cache-Control overrides.
 * Key = path prefix (exact or prefix match), Value = ttl in seconds.
 * A ttl of 0 means no-store (no caching).
 */
export const PATH_TTL_OVERRIDES: ReadonlyMap<string, number> = new Map([
  ['/plans', 300],
  ['/pricing', 300],
  ['/features', 600],
  ['/public', 3600],
  ['/graphql', 0],         // GraphQL — POST mutations; no public cache
  ['/health', 0],          // Health check — no cache
  ['/metrics', 0],         // Metrics — no cache
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute a strong ETag as a quoted, double-quoted SHA-256 hex (first 32 chars).
 * Format: `"<sha256-prefix>"` (strong ETag per RFC 7232 §2.3).
 */
export function computeETag(body: Buffer | string): string {
  const hash = createHash('sha256')
    .update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body)
    .digest('hex')
    .slice(0, 32);
  return `"${hash}"`;
}

/**
 * Return true if the request ETag list matches the response ETag.
 * Handles `*` wildcard and comma-separated ETag lists (RFC 7232 §3.2).
 */
export function etagMatches(requestEtag: string | undefined, responseEtag: string): boolean {
  if (!requestEtag) return false;
  const trimmed = requestEtag.trim();
  if (trimmed === '*') return true;
  return trimmed
    .split(',')
    .map((t) => t.trim())
    .includes(responseEtag);
}

/** Determine if this request is authenticated (private scope). */
export function isAuthenticatedRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const auth = req.headers['authorization'];
  const cookie = req.headers['cookie'];
  // Any bearer token or session cookie = private
  return Boolean(auth) || Boolean(cookie);
}

/** Resolve the TTL for a given path. Returns null if caching should be disabled. */
export function resolveTtlForPath(path: string): number {
  // Exact match first
  if (PATH_TTL_OVERRIDES.has(path)) {
    return PATH_TTL_OVERRIDES.get(path)!;
  }
  // Prefix match (longest wins)
  let bestPrefix = '';
  let bestTtl = DEFAULT_PUBLIC_TTL_SECONDS;
  for (const [prefix, ttl] of PATH_TTL_OVERRIDES) {
    if (path.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestTtl = ttl;
    }
  }
  return bestTtl;
}

/** Build a Cache-Control header value. */
export function buildCacheControlValue(
  ttlSeconds: number,
  scope: 'public' | 'private' = 'public',
  swrSeconds: number = DEFAULT_SWR_SECONDS,
): string {
  if (ttlSeconds === 0) {
    return 'no-store';
  }
  if (scope === 'private') {
    return `private, max-age=${ttlSeconds}`;
  }
  return `public, s-maxage=${ttlSeconds}, max-age=${ttlSeconds}, stale-while-revalidate=${swrSeconds}`;
}

// ── ETag middleware options ───────────────────────────────────────────────────

export interface ETagMiddlewareOptions {
  /** Default TTL in seconds for public routes. Default: 300. */
  defaultTtlSeconds?: number;
  /** Stale-while-revalidate window. Default: 60. */
  staleWhileRevalidateSeconds?: number;
  /**
   * When true, skips ETag generation for authenticated requests.
   * Default: true (bypass for auth = safety).
   */
  bypassForAuth?: boolean;
  /**
   * HTTP methods to apply ETag logic to. Default: ['GET', 'HEAD'].
   * POST and others are never cached.
   */
  methods?: string[];
  /**
   * Minimum response status code to apply ETags to (inclusive).
   * Default: 200.
   */
  minStatus?: number;
  /**
   * Maximum response status code to apply ETags to (inclusive).
   * Default: 299.
   */
  maxStatus?: number;
}

// ── Core ETag interceptor ─────────────────────────────────────────────────────

/**
 * Wrap a ServerResponse so that:
 * 1. The response body is buffered.
 * 2. On write/end, an ETag is computed from the body.
 * 3. If If-None-Match matches the ETag, a 304 is sent instead.
 * 4. Cache-Control + Vary headers are applied.
 */
export function applyETagInterception(
  req: IncomingMessage,
  res: ServerResponse,
  options: Required<ETagMiddlewareOptions>,
): void {
  const method = (req.method ?? 'GET').toUpperCase();
  if (!options.methods.includes(method)) return;

  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const isAuth = options.bypassForAuth && isAuthenticatedRequest(req);
  const ttl = (res.locals as Record<string, unknown>)?.cacheTtl as number | undefined
    ?? resolveTtlForPath(path);
  const scope = isAuth || ttl === 0
    ? 'private'
    : ((res.locals as Record<string, unknown>)?.cacheScope as 'public' | 'private' | undefined ?? 'public');

  // Buffer the response body to compute ETag
  const chunks: Buffer[] = [];
  const originalEnd = res.end.bind(res) as typeof res.end;

  // Override write to buffer
  (res as ServerResponse & { write: typeof res.write }).write = function (
    chunk: unknown,
    encodingOrCallback?: unknown,
    callback?: () => void,
  ) {
    if (chunk) {
      chunks.push(
        Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string, typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8'),
      );
    }
    if (typeof encodingOrCallback === 'function') {
      encodingOrCallback();
    } else if (callback) {
      callback();
    }
    return true;
  } as typeof res.write;

  // Override end to finalize ETag logic
  (res as ServerResponse & { end: typeof res.end }).end = function (
    chunkOrCallback?: unknown,
    encodingOrCallback?: unknown,
    callback?: () => void,
  ) {
    // Accumulate last chunk if present
    if (chunkOrCallback && typeof chunkOrCallback !== 'function') {
      chunks.push(
        Buffer.isBuffer(chunkOrCallback)
          ? chunkOrCallback
          : Buffer.from(
              chunkOrCallback as string,
              typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8',
            ),
      );
    }

    const status = res.statusCode ?? 200;
    const body = Buffer.concat(chunks);

    // Only ETag on 2xx success responses
    if (
      status >= options.minStatus &&
      status <= options.maxStatus &&
      body.length >= MIN_BODY_SIZE_FOR_ETAG &&
      !res.headersSent
    ) {
      const etag = computeETag(body);

      // Apply Cache-Control
      if (!res.getHeader(CACHE_CONTROL_HEADER_NAME)) {
        res.setHeader(
          CACHE_CONTROL_HEADER_NAME,
          buildCacheControlValue(
            ttl,
            scope,
            options.staleWhileRevalidateSeconds,
          ),
        );
      }

      // Apply Vary to prevent shared-cache collisions across encodings
      if (!res.getHeader(VARY_HEADER) && scope === 'public') {
        res.setHeader(VARY_HEADER, 'Accept-Encoding, Accept');
      }

      // Check If-None-Match
      const ifNoneMatch = req.headers[IF_NONE_MATCH_HEADER] as string | undefined;
      if (etagMatches(ifNoneMatch, etag)) {
        // 304 Not Modified — no body
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Length');
        res.setHeader(ETAG_HEADER, etag);
        res.writeHead(304);
        return originalEnd.call(res);
      }

      // Attach ETag and send full response
      res.setHeader(ETAG_HEADER, etag);
      res.setHeader('Content-Length', body.length);
    }

    // Flush buffered body
    return originalEnd.call(res, body, 'binary', typeof callback === 'function' ? callback : undefined);
  } as typeof res.end;
}

// ── Express-compatible middleware factory ─────────────────────────────────────

type ExpressRequest = IncomingMessage & { path?: string };
type ExpressResponse = ServerResponse & { locals?: Record<string, unknown> };
type NextFunction = () => void;

/**
 * Express-compatible ETag middleware.
 *
 * @example
 * ```ts
 * import { etagMiddleware } from './etagMiddleware';
 * app.use(etagMiddleware({ defaultTtlSeconds: 300 }));
 * ```
 */
export function etagMiddleware(
  options: ETagMiddlewareOptions = {},
): (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => void {
  const resolved: Required<ETagMiddlewareOptions> = {
    defaultTtlSeconds: options.defaultTtlSeconds ?? DEFAULT_PUBLIC_TTL_SECONDS,
    staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds ?? DEFAULT_SWR_SECONDS,
    bypassForAuth: options.bypassForAuth ?? true,
    methods: options.methods ?? ['GET', 'HEAD'],
    minStatus: options.minStatus ?? 200,
    maxStatus: options.maxStatus ?? 299,
  };

  return (req: ExpressRequest, res: ExpressResponse, next: NextFunction): void => {
    applyETagInterception(req as IncomingMessage, res as ServerResponse, resolved);
    next();
  };
}

/**
 * Apply ETag interception directly to a raw http.Server request handler.
 * Use this when not using Express.
 *
 * @example
 * ```ts
 * const server = http.createServer(async (req, res) => {
 *   applyETagToRawHandler(req, res);
 *   // … handler logic …
 * });
 * ```
 */
export function applyETagToRawHandler(
  req: IncomingMessage,
  res: ServerResponse,
  options: ETagMiddlewareOptions = {},
): void {
  const resolved: Required<ETagMiddlewareOptions> = {
    defaultTtlSeconds: options.defaultTtlSeconds ?? DEFAULT_PUBLIC_TTL_SECONDS,
    staleWhileRevalidateSeconds: options.staleWhileRevalidateSeconds ?? DEFAULT_SWR_SECONDS,
    bypassForAuth: options.bypassForAuth ?? true,
    methods: options.methods ?? ['GET', 'HEAD'],
    minStatus: options.minStatus ?? 200,
    maxStatus: options.maxStatus ?? 299,
  };
  applyETagInterception(req, res, resolved);
}
