/**
 * ETag-based API Response Cache — SubTrackr
 *
 * Implements RFC 7232 conditional-request semantics (If-None-Match / ETag)
 * on top of the existing Redis CacheService, enabling:
 *
 *   - 304 Not Modified responses when content hasn't changed → zero body bytes
 *   - Weak ETags derived from content hash for stable comparison
 *   - Cache-Control headers with configurable stale-while-revalidate
 *   - Automatic ETag invalidation on resource mutation
 *   - Per-resource and per-collection ETag tracking
 *   - Prometheus metrics for hit/miss/304 rates
 *
 * ## How ETags work here
 *
 * 1. On first GET, the handler serialises its response and calls
 *    `etagCache.wrap(req, res, key, producer)`.
 * 2. `wrap` checks the Redis cache for an existing ETag for `key`.
 * 3. If found and `If-None-Match` matches → 304, no body.
 * 4. If not found (or stale) → call `producer()`, cache result + new ETag.
 * 5. On writes (POST/PATCH/DELETE) call `etagCache.invalidate(key)`.
 *
 * ## Integration with existing compression middleware
 *
 * `wrap` delegates body delivery to `applyCompression` so Brotli/gzip
 * compression and ETag generation are both applied correctly.
 *
 * Usage:
 * ```ts
 * // In your route handler:
 * await etagCache.wrap(req, res, `plan:${planId}`, async () => {
 *   const plan = await planRepo.findById(planId);
 *   return { success: true, data: plan };
 * });
 *
 * // On mutation:
 * await etagCache.invalidate(`plan:${planId}`);
 * ```
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyCompression } from './compression';
import type { ICacheService } from './cache';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface ETagCacheConfig {
  /**
   * Default Cache-Control value sent on fresh (200) responses.
   * Default: `'public, s-maxage=300, stale-while-revalidate=60'`
   */
  defaultCacheControl?: string;
  /**
   * Redis key prefix for ETag entries.
   * Default: `'etag:'`
   */
  keyPrefix?: string;
  /**
   * TTL in seconds for ETag entries in Redis.
   * Should match or exceed the max-age in Cache-Control.
   * Default: 360 (6 min — slightly longer than the 300 s max-age)
   */
  ttlSeconds?: number;
  /**
   * When true, attach `Vary: Accept-Encoding` to all responses.
   * Default: true
   */
  varyAcceptEncoding?: boolean;
  /**
   * When true, use weak ETags (W/"...") instead of strong ETags.
   * Weak ETags compare semantically equal content.
   * Default: true
   */
  weakEtag?: boolean;
}

const DEFAULTS: Required<ETagCacheConfig> = {
  defaultCacheControl: 'public, s-maxage=300, stale-while-revalidate=60',
  keyPrefix: 'etag:',
  ttlSeconds: 360,
  varyAcceptEncoding: true,
  weakEtag: true,
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface ETagCacheMetrics {
  /** Total calls to wrap() */
  totalRequests: number;
  /** Responses served as 304 Not Modified */
  notModified: number;
  /** Fresh responses computed and cached */
  fresh: number;
  /** Cache hits (ETag retrieved from Redis, content compared) */
  cacheHits: number;
  /** Cache misses (producer called, new ETag stored) */
  cacheMisses: number;
  /** Explicit invalidations called */
  invalidations: number;
  /** Pattern-based invalidations called */
  patternInvalidations: number;
  /** Estimated bytes saved by 304 responses */
  bytesSavedByNotModified: number;
  /** Ratio of 304 responses to total requests */
  notModifiedRate: number;
}

class ETagMetricsStore {
  totalRequests = 0;
  notModified = 0;
  fresh = 0;
  cacheHits = 0;
  cacheMisses = 0;
  invalidations = 0;
  patternInvalidations = 0;
  bytesSavedByNotModified = 0;

  snapshot(): ETagCacheMetrics {
    return {
      totalRequests: this.totalRequests,
      notModified: this.notModified,
      fresh: this.fresh,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      invalidations: this.invalidations,
      patternInvalidations: this.patternInvalidations,
      bytesSavedByNotModified: this.bytesSavedByNotModified,
      notModifiedRate:
        this.totalRequests === 0
          ? 0
          : Math.round((this.notModified / this.totalRequests) * 10_000) / 10_000,
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.notModified = 0;
    this.fresh = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.invalidations = 0;
    this.patternInvalidations = 0;
    this.bytesSavedByNotModified = 0;
  }
}

// ─── Cached ETag entry ────────────────────────────────────────────────────────

interface CachedETagEntry {
  /** The ETag value, e.g. `W/"abc123"` */
  etag: string;
  /** The serialised JSON body (stored so we can re-serve without recomputing) */
  body: string;
  /** Unix ms when this entry was created */
  cachedAt: number;
}

// ─── ETag generation ──────────────────────────────────────────────────────────

/**
 * Compute a reproducible ETag from a JSON body string.
 * Uses SHA-256 (first 27 base64url chars) for a compact, collision-resistant tag.
 */
export function computeETag(body: string, weak = true): string {
  const hash = createHash('sha256').update(body, 'utf8').digest('base64url').slice(0, 27);
  return weak ? `W/"${hash}"` : `"${hash}"`;
}

/**
 * Parse the `If-None-Match` header and return the set of ETags the client has.
 * Handles the `*` wildcard and comma-separated lists per RFC 7232 §3.2.
 */
export function parseIfNoneMatch(header: string | undefined): Set<string> {
  if (!header) return new Set();
  if (header.trim() === '*') return new Set(['*']);
  return new Set(
    header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Returns `true` when the server's `etag` matches any ETag the client sent.
 * Handles weak comparison (W/"..." vs "...") per RFC 7232 §2.3.
 */
export function isETagMatch(serverEtag: string, clientETags: Set<string>): boolean {
  if (clientETags.has('*')) return true;
  if (clientETags.has(serverEtag)) return true;
  // Weak/strong comparison: strip W/ prefix from both sides
  const bare = serverEtag.replace(/^W\//, '');
  for (const e of clientETags) {
    if (e.replace(/^W\//, '') === bare) return true;
  }
  return false;
}

// ─── ETag Cache Service ───────────────────────────────────────────────────────

/**
 * ETag-aware HTTP response cache.
 *
 * Designed to layer on top of any `ICacheService` implementation
 * (Redis-backed `CacheService` in production, `NullCacheService` in tests).
 */
export class ETagCacheService {
  private readonly cfg: Required<ETagCacheConfig>;
  private readonly metrics = new ETagMetricsStore();

  constructor(
    private readonly cache: ICacheService,
    config: ETagCacheConfig = {},
  ) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  // ── Core: wrap a GET handler ───────────────────────────────────────────────

  /**
   * Wrap a GET handler with ETag-based caching.
   *
   * - If Redis has a cached ETag for `cacheKey` and the client's
   *   `If-None-Match` matches → send 304.
   * - Otherwise, call `producer()`, cache the result, and send 200.
   *
   * Compression (Brotli/gzip) is applied automatically via `applyCompression`.
   *
   * @param req        Incoming HTTP request
   * @param res        Server response to write to
   * @param cacheKey   Logical cache key (e.g. `plan:42`)
   * @param producer   Async function that computes the response body
   * @param options    Per-request overrides
   */
  async wrap(
    req: IncomingMessage,
    res: ServerResponse,
    cacheKey: string,
    producer: () => Promise<unknown>,
    options: { cacheControl?: string; ttlSeconds?: number } = {},
  ): Promise<void> {
    this.metrics.totalRequests++;

    const redisKey = this.cfg.keyPrefix + cacheKey;
    const clientETags = parseIfNoneMatch(req.headers['if-none-match'] as string | undefined);

    // ── Check cache ─────────────────────────────────────────────────────────
    const cached = await this.cache.getOrLoad<CachedETagEntry>(
      redisKey,
      async () => null, // don't auto-produce here; we do it below if needed
    );

    if (cached !== null) {
      this.metrics.cacheHits++;

      // ── 304 path ───────────────────────────────────────────────────────────
      if (isETagMatch(cached.etag, clientETags)) {
        this.metrics.notModified++;
        this.metrics.bytesSavedByNotModified += Buffer.byteLength(cached.body, 'utf8');

        const headers: Record<string, string | number> = {
          ETag: cached.etag,
          'Cache-Control': options.cacheControl ?? this.cfg.defaultCacheControl,
        };
        if (this.cfg.varyAcceptEncoding) headers['Vary'] = 'Accept-Encoding';
        res.writeHead(304, headers);
        res.end();
        return;
      }

      // ── Cache hit, ETag mismatch: re-serve body ────────────────────────────
      this.metrics.fresh++;
      await this.sendResponse(req, res, cached.body, cached.etag, options);
      return;
    }

    // ── Cache miss: produce and store ────────────────────────────────────────
    this.metrics.cacheMisses++;

    const data = await producer();
    const body = JSON.stringify(data);
    const etag = computeETag(body, this.cfg.weakEtag);

    const entry: CachedETagEntry = {
      etag,
      body,
      cachedAt: Date.now(),
    };

    await this.cache.set(redisKey, entry, options.ttlSeconds ?? this.cfg.ttlSeconds);

    // Check again now that we have the fresh ETag
    if (isETagMatch(etag, clientETags)) {
      this.metrics.notModified++;
      this.metrics.bytesSavedByNotModified += Buffer.byteLength(body, 'utf8');

      const headers: Record<string, string | number> = {
        ETag: etag,
        'Cache-Control': options.cacheControl ?? this.cfg.defaultCacheControl,
      };
      if (this.cfg.varyAcceptEncoding) headers['Vary'] = 'Accept-Encoding';
      res.writeHead(304, headers);
      res.end();
      return;
    }

    this.metrics.fresh++;
    await this.sendResponse(req, res, body, etag, options);
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  /**
   * Invalidate the cached ETag for a specific resource key.
   * Call this after any mutation (POST / PATCH / DELETE).
   */
  async invalidate(cacheKey: string): Promise<void> {
    this.metrics.invalidations++;
    await this.cache.invalidate(this.cfg.keyPrefix + cacheKey);
  }

  /**
   * Invalidate all ETag entries whose keys start with `prefix`.
   *
   * Useful for collection invalidation, e.g. invalidating all
   * `plan:*` entries when a merchant's plan list changes.
   */
  async invalidatePattern(prefix: string): Promise<void> {
    this.metrics.patternInvalidations++;
    await this.cache.invalidatePattern(this.cfg.keyPrefix + prefix);
  }

  // ── Low-level helpers ─────────────────────────────────────────────────────

  /**
   * Retrieve only the ETag for a cached resource without loading the body.
   * Useful for `HEAD` requests.
   */
  async getETag(cacheKey: string): Promise<string | null> {
    const redisKey = this.cfg.keyPrefix + cacheKey;
    const cached = await this.cache.getOrLoad<CachedETagEntry>(redisKey, async () => null);
    return cached?.etag ?? null;
  }

  /**
   * Store a pre-computed body+ETag into the cache without going through
   * the HTTP response path. Used when batch-prefilling the cache.
   */
  async prime(cacheKey: string, body: unknown, ttlSeconds?: number): Promise<string> {
    const serialised = typeof body === 'string' ? body : JSON.stringify(body);
    const etag = computeETag(serialised, this.cfg.weakEtag);
    const entry: CachedETagEntry = {
      etag,
      body: serialised,
      cachedAt: Date.now(),
    };
    await this.cache.set(
      this.cfg.keyPrefix + cacheKey,
      entry,
      ttlSeconds ?? this.cfg.ttlSeconds,
    );
    return etag;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): ETagCacheMetrics {
    return this.metrics.snapshot();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }

  prometheusMetrics(namespace = 'subtrackr_etag_cache'): string {
    const m = this.metrics.snapshot();
    return [
      `# HELP ${namespace}_requests_total Total wrap() calls`,
      `# TYPE ${namespace}_requests_total counter`,
      `${namespace}_requests_total ${m.totalRequests}`,
      `# HELP ${namespace}_not_modified_total Responses sent as 304`,
      `# TYPE ${namespace}_not_modified_total counter`,
      `${namespace}_not_modified_total ${m.notModified}`,
      `# HELP ${namespace}_fresh_total Fresh 200 responses generated`,
      `# TYPE ${namespace}_fresh_total counter`,
      `${namespace}_fresh_total ${m.fresh}`,
      `# HELP ${namespace}_cache_hits_total Requests with a cached ETag`,
      `# TYPE ${namespace}_cache_hits_total counter`,
      `${namespace}_cache_hits_total ${m.cacheHits}`,
      `# HELP ${namespace}_cache_misses_total Requests without a cached ETag`,
      `# TYPE ${namespace}_cache_misses_total counter`,
      `${namespace}_cache_misses_total ${m.cacheMisses}`,
      `# HELP ${namespace}_invalidations_total Explicit single-key invalidations`,
      `# TYPE ${namespace}_invalidations_total counter`,
      `${namespace}_invalidations_total ${m.invalidations}`,
      `# HELP ${namespace}_pattern_invalidations_total Pattern-based invalidations`,
      `# TYPE ${namespace}_pattern_invalidations_total counter`,
      `${namespace}_pattern_invalidations_total ${m.patternInvalidations}`,
      `# HELP ${namespace}_bytes_saved_total Estimated bytes saved by 304 responses`,
      `# TYPE ${namespace}_bytes_saved_total counter`,
      `${namespace}_bytes_saved_total ${m.bytesSavedByNotModified}`,
      `# HELP ${namespace}_not_modified_rate Fraction of responses that were 304`,
      `# TYPE ${namespace}_not_modified_rate gauge`,
      `${namespace}_not_modified_rate ${m.notModifiedRate}`,
    ].join('\n');
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async sendResponse(
    req: IncomingMessage,
    res: ServerResponse,
    body: string,
    etag: string,
    options: { cacheControl?: string } = {},
  ): Promise<void> {
    const cacheControl = options.cacheControl ?? this.cfg.defaultCacheControl;
    const extraHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ETag: etag,
    };
    if (this.cfg.varyAcceptEncoding) {
      // applyCompression sets Vary itself; we just need the ETag
    }
    await applyCompression(req, res, body, extraHeaders, {
      defaultCacheControl: cacheControl,
      // Disable compression's built-in ETag since we already computed ours
      etag: false,
    });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an `ETagCacheService` with sensible defaults for SubTrackr APIs.
 *
 * @example
 * ```ts
 * import { createETagCache } from './etagCache';
 * import { cacheService } from './cache';
 *
 * const etagCache = createETagCache(cacheService);
 *
 * // In a route handler:
 * await etagCache.wrap(req, res, `plan:${planId}`, () => planRepo.findById(planId));
 * ```
 */
export function createETagCache(
  cacheService: ICacheService,
  config?: ETagCacheConfig,
): ETagCacheService {
  return new ETagCacheService(cacheService, config);
}
