/**
 * backend/src/services/counts.ts
 *
 * Redis-backed subscription count cache with tag-based invalidation (Issue #2077).
 *
 * The cache serves the `GET /api/subscriptions/counts` hot path and mirrors the
 * mobile query contract (`total`, `active`, `canceled`, `pastDue`) with the same
 * 30 second freshness window. A shared implementation avoids four separate
 * cache entries drifting out of sync.
 *
 * Design
 * ------
 * - Values are JSON documents `{ value, expiresAt, tags }`. A logical TTL
 *   (`ttlSeconds`) controls freshness; the Redis EXPIRE is longer by
 *   `staleGraceSeconds` so a stale copy can still be served when the database
 *   loader temporarily fails instead of turning a count into a 500.
 * - Every cache key is registered in Redis SETs ("tag indexes"). Invalidating
 *   a tag deletes exactly the tagged keys, with no blocking `KEYS`/`SCAN` on
 *   the request path. The injected Redis client only needs get/set/del/sadd/
 *   smembers/expire, so both ioredis and test doubles work.
 * - Concurrent reads for the same key are single-flighted: callers share one
 *   loader call while the first request fills the cache.
 * - Redis failures degrade safely: a cached value wins over a failing loader,
 *   and a failing cache never fails a count request on its own.
 *
 * Observability
 * -------------
 * Outcomes emit counters/timings through the injected `metrics` client and logs
 * through the injected `logger` (default: shared PII-redacting backend logger).
 * Metric names are prefixed with `subtrackr.counts`.
 */

import { createHash } from 'crypto';
import { logger as defaultLogger } from '../utils/logger';

// ── Contracts ─────────────────────────────────────────────────────────────────

/**
 * Minimal Redis surface used by the cache. Compatible with ioredis and other
 * clients supporting `set(key, value, 'EX', seconds)` and variadic `del`.
 */
export interface CountRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  smembers(key: string): Promise<string[] | null>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface CountCacheLogger {
  debug?(message: string, meta?: Record<string, unknown>): void;
  info?(message: string, meta?: Record<string, unknown>): void;
  warn?(message: string, meta?: Record<string, unknown>): void;
  error?(message: string, meta?: Record<string, unknown>): void;
}

/** Prometheus-style metric sink; all methods are optional. */
export interface CountCacheMetrics {
  increment?(name: string, value?: number, tags?: Record<string, string>): void;
  timing?(name: string, milliseconds: number, tags?: Record<string, string>): void;
}

/** Mirrors `SubscriptionCounts` from the mobile query contract. */
export interface SubscriptionCounts {
  total: number;
  active: number;
  canceled: number;
  pastDue: number;
}

export type SubscriptionCountField = keyof SubscriptionCounts;

/** Identifies whose counts are cached (e.g. a user's subscriptions). */
export interface CountQuery {
  /** Logical scope such as `user`, `account`, or `global`. */
  scope: string;
  /** Identifier within the scope; omit for global counts. */
  scopeId?: string;
  /** Stable filter values. Key order does not affect the cache key. */
  filters?: Record<string, string | number | boolean | null | undefined>;
}

export interface CountCacheOptions {
  redis: CountRedisClient;
  /** Freshness window in seconds. Default: 30 (matches the mobile query TTL). */
  ttlSeconds?: number;
  /** Extra seconds during which a stale value may be served on loader error. Default: 300. */
  staleGraceSeconds?: number;
  /** TTL of tag index sets. Defaults to ttl + staleGrace + 60. */
  tagTtlSeconds?: number;
  /** Redis key namespace. Default: `subtrackr:counts:v1`. */
  keyPrefix?: string;
  logger?: CountCacheLogger;
  metrics?: CountCacheMetrics;
  /** Injectable clock (milliseconds since epoch) for deterministic tests. */
  now?: () => number;
}

interface CacheEntry {
  value: SubscriptionCounts;
  expiresAt: number;
  tags: string[];
}

const METRIC_PREFIX = 'subtrackr.counts';
const DEFAULT_KEY_PREFIX = 'subtrackr:counts:v1';
const DEFAULT_TTL_SECONDS = 30;
const DEFAULT_STALE_GRACE_SECONDS = 300;

export const SUBSCRIPTIONS_TAG = 'subscriptions';
export const SUBSCRIPTION_COUNTS_TAG = 'subscription-counts';

export function subscriptionCountTag(subscriptionId: string): string {
  return `subscription:${subscriptionId}:counts`;
}

export function userSubscriptionCountsTag(userId: string): string {
  return `user:${userId}:subscription-counts`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function safePositiveSeconds(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidCounts(value: unknown): value is SubscriptionCounts {
  if (!value || typeof value !== 'object') return false;
  const counts = value as Partial<SubscriptionCounts>;
  return (
    isCount(counts.total) &&
    isCount(counts.active) &&
    isCount(counts.canceled) &&
    isCount(counts.pastDue)
  );
}

function parseEntry(raw: string | null): CacheEntry | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as Partial<CacheEntry>;
    if (
      !isValidCounts(entry.value) ||
      typeof entry.expiresAt !== 'number' ||
      !Number.isFinite(entry.expiresAt) ||
      !Array.isArray(entry.tags) ||
      !entry.tags.every((tag) => typeof tag === 'string')
    ) {
      return null;
    }
    return {
      value: { ...entry.value },
      expiresAt: entry.expiresAt,
      tags: [...(entry.tags as string[])],
    };
  } catch {
    return null;
  }
}

function canonicalFilters(filters: CountQuery['filters']): Array<[string, string | number | boolean]> {
  if (!filters) return [];
  return Object.keys(filters)
    .filter((key) => filters[key] !== undefined && filters[key] !== null)
    .sort()
    .map((key) => [key, filters[key] as string | number | boolean]);
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

/** No-op sink for callers that do not care about metrics. */
export const noopCountCacheMetrics: CountCacheMetrics = {};

/**
 * In-memory metric sink useful for tests and local dashboards. Counters and
 * elapsed milliseconds are retained and every event is mirrored to the logger.
 */
export class StructuredCountCacheTelemetry implements CountCacheMetrics {
  readonly counters = new Map<string, number>();
  readonly timings = new Map<string, number>();

  constructor(private readonly logger: CountCacheLogger = defaultLogger) {}

  increment(name: string, value = 1, tags: Record<string, string> = {}): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
    this.logger.debug?.('Subscription count cache counter', { metric: name, value, tags });
  }

  timing(name: string, milliseconds: number, tags: Record<string, string> = {}): void {
    this.timings.set(name, (this.timings.get(name) ?? 0) + milliseconds);
    this.logger.debug?.('Subscription count cache timing', { metric: name, milliseconds, tags });
  }

  /** Counter value; accepts either a short name or the fully prefixed name. */
  value(name: string): number {
    const metric = name.startsWith(`${METRIC_PREFIX}.`) ? name : `${METRIC_PREFIX}.${name}`;
    return this.counters.get(metric) ?? 0;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Redis-backed subscription counts cache. Prefer `createSubscriptionCountCache`
 * unless a class type is needed for dependency injection.
 */
export class SubscriptionCountCache {
  private readonly redis: CountRedisClient;
  private readonly logger: CountCacheLogger;
  private readonly metrics: CountCacheMetrics;
  private readonly now: () => number;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly staleGraceSeconds: number;
  private readonly tagTtlSeconds: number;
  private readonly inFlight = new Map<string, Promise<SubscriptionCounts>>();

  constructor(options: CountCacheOptions) {
    if (!options?.redis) throw new Error('SubscriptionCountCache requires a Redis client');
    this.redis = options.redis;
    this.logger = options.logger ?? defaultLogger;
    this.metrics = options.metrics ?? noopCountCacheMetrics;
    this.now = options.now ?? Date.now;
    this.keyPrefix = options.keyPrefix || DEFAULT_KEY_PREFIX;
    this.ttlSeconds = safePositiveSeconds(options.ttlSeconds, DEFAULT_TTL_SECONDS);
    this.staleGraceSeconds = safePositiveSeconds(
      options.staleGraceSeconds,
      DEFAULT_STALE_GRACE_SECONDS,
    );
    this.tagTtlSeconds = Math.max(
      this.ttlSeconds + this.staleGraceSeconds + 60,
      safePositiveSeconds(
        options.tagTtlSeconds,
        this.ttlSeconds + this.staleGraceSeconds + 60,
      ),
    );
  }

  /** Stable, filter-aware Redis key for a count query. */
  keyFor(query: CountQuery): string {
    if (!query?.scope || typeof query.scope !== 'string') {
      throw new Error('Count query requires a scope');
    }
    const fingerprint = hash(
      JSON.stringify([query.scope, query.scopeId ?? null, canonicalFilters(query.filters)]),
    );
    return `${this.keyPrefix}:${encodeURIComponent(query.scope)}:${encodeURIComponent(query.scopeId ?? 'global')}:${fingerprint}`;
  }

  /**
   * Return all subscription counts, using Redis when possible. `loader` runs
   * only on a miss or when a stale value needs refreshing.
   */
  getCounts(
    query: CountQuery,
    loader: () => Promise<SubscriptionCounts>,
    extraTags: readonly string[] = [],
  ): Promise<SubscriptionCounts> {
    const key = this.keyFor(query);
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const tags = this.defaultTags(query, extraTags);
    const task = this.loadCounts(key, query.scope, loader, tags);
    this.inFlight.set(key, task);
    const release = (): void => {
      if (this.inFlight.get(key) === task) this.inFlight.delete(key);
    };
    void task.then(release, release);
    return task;
  }

  /** Read one field from the shared counts entry (e.g. `active`). */
  async getCount(
    query: CountQuery,
    field: SubscriptionCountField,
    loader: () => Promise<SubscriptionCounts>,
    extraTags: readonly string[] = [],
  ): Promise<number> {
    const counts = await this.getCounts(query, loader, extraTags);
    return counts[field];
  }

  /**
   * Delete every cached count associated with the supplied tags.
   * @returns number of value keys removed.
   */
  async invalidateTags(tags: readonly string[]): Promise<number> {
    let removed = 0;
    for (const tag of [...new Set(tags)]) {
      const indexKey = this.tagKey(tag);
      try {
        const members = (await this.redis.smembers(indexKey)) ?? [];
        if (members.length > 0) {
          await this.redis.del(...members, indexKey);
          removed += members.length;
        } else {
          await this.redis.del(indexKey);
        }
        this.emit('invalidated', 1, { tag: hash(tag), keys: String(members.length) });
      } catch (error) {
        this.logWarn('Failed to invalidate subscription count tag', { tag: hash(tag), error });
        this.emit('invalidation_error', 1, { tag: hash(tag) });
      }
    }
    return removed;
  }

  /** Invalidate all counts after a subscription changes. */
  invalidateSubscription(subscriptionId: string, scopeId?: string): Promise<number> {
    const tags = [SUBSCRIPTION_COUNTS_TAG, subscriptionCountTag(subscriptionId)];
    if (scopeId) tags.push(userSubscriptionCountsTag(scopeId));
    return this.invalidateTags(tags);
  }

  /** Invalidate all counts scoped to one user/account. */
  invalidateScope(scopeId: string): Promise<number> {
    return this.invalidateTags([SUBSCRIPTION_COUNTS_TAG, userSubscriptionCountsTag(scopeId)]);
  }

  /** Invalidate every subscription count. */
  invalidateAll(): Promise<number> {
    return this.invalidateTags([SUBSCRIPTION_COUNTS_TAG, SUBSCRIPTIONS_TAG]);
  }

  private defaultTags(query: CountQuery, extraTags: readonly string[]): string[] {
    const tags = [SUBSCRIPTIONS_TAG, SUBSCRIPTION_COUNTS_TAG, ...extraTags];
    if (query.scopeId) tags.push(userSubscriptionCountsTag(query.scopeId));
    return [...new Set(tags)];
  }

  private async loadCounts(
    key: string,
    scope: string,
    loader: () => Promise<SubscriptionCounts>,
    tags: string[],
  ): Promise<SubscriptionCounts> {
    const startedAt = this.now();
    const cached = await this.read(key);
    const tag = { scope };

    if (cached && this.now() < cached.expiresAt) {
      this.emit('hit', 1, tag);
      this.timing('read', startedAt);
      return { ...cached.value };
    }

    try {
      const fresh = await loader();
      if (!isValidCounts(fresh)) {
        throw new Error('Invalid subscription counts returned by loader');
      }
      const expiresAt = this.now() + this.ttlSeconds * 1_000;
      const mergedTags = [...new Set([...(cached?.tags ?? []), ...tags])];
      await this.write(key, { value: { ...fresh }, expiresAt, tags: mergedTags });
      this.emit(cached ? 'refreshed' : 'miss', 1, tag);
      this.timing('load', startedAt);
      return { ...fresh };
    } catch (error) {
      if (cached) {
        this.logWarn('Serving stale subscription counts after loader failure', { key, error });
        this.emit('stale_fallback', 1, tag);
        this.timing('read', startedAt);
        return { ...cached.value };
      }
      this.logger.error?.('Failed to load subscription counts', { key, error });
      this.emit('load_error', 1, tag);
      throw error;
    }
  }

  private async read(key: string): Promise<CacheEntry | null> {
    try {
      const raw = await this.redis.get(key);
      const entry = parseEntry(raw);
      if (raw && !entry) {
        this.logWarn('Discarding malformed subscription count cache entry', { key });
        this.emit('malformed', 1);
      }
      return entry;
    } catch (error) {
      this.logWarn('Subscription count cache read failed', { key, error });
      this.emit('read_error', 1);
      return null;
    }
  }

  private async write(key: string, entry: CacheEntry): Promise<void> {
    const physicalTtl =
      Math.max(1, Math.ceil((entry.expiresAt - this.now()) / 1_000)) + this.staleGraceSeconds;
    try {
      await this.redis.set(key, JSON.stringify(entry), 'EX', physicalTtl);
      this.emit('write', 1);
    } catch (error) {
      this.logWarn('Failed to cache subscription counts', { key, error });
      this.emit('write_error', 1);
      return; // A failed cache write must not fail the request.
    }

    for (const tag of entry.tags) {
      const indexKey = this.tagKey(tag);
      try {
        await this.redis.sadd(indexKey, key);
        await this.redis.expire(indexKey, this.tagTtlSeconds);
      } catch (error) {
        this.logWarn('Failed to register subscription count tag', {
          key,
          tag: hash(tag),
          error,
        });
        this.emit('tag_error', 1);
      }
    }
  }

  private tagKey(tag: string): string {
    return `${this.keyPrefix}:tag:${hash(tag)}`;
  }

  private emit(name: string, value = 1, tags: Record<string, string> = {}): void {
    this.metrics.increment?.(`${METRIC_PREFIX}.${name}`, value, tags);
  }

  private timing(name: string, startedAt: number): void {
    this.metrics.timing?.(`${METRIC_PREFIX}.${name}`, this.now() - startedAt);
  }

  private logWarn(message: string, meta: Record<string, unknown>): void {
    this.logger.warn?.(message, meta);
  }
}

export function createSubscriptionCountCache(
  options: CountCacheOptions,
): SubscriptionCountCache {
  return new SubscriptionCountCache(options);
}
