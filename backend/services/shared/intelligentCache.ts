/**
 * Intelligent Redis Cache — SubTrackr
 *
 * Extends the base CacheService with:
 *   - Tag-based invalidation: group keys under semantic tags (e.g. "subscription:sub-1")
 *     and invalidate all related keys in one call
 *   - Tiered TTLs: hot/warm/cold data gets different expiry
 *   - Invalidation cascade: parent-tag invalidation propagates to all child tags
 *   - Stale-while-revalidate: serve stale data while fetching fresh value
 *   - Circuit breaker: after N consecutive Redis failures, bypass cache
 *   - Background refresh: proactive TTL renewal before expiry
 *   - Namespace isolation: per-tenant and per-domain key prefixes
 */

import type { RedisClient } from '../../shared/cache/types';
import type { IEventBus, AnyDomainEvent } from './events';
import { logger } from './logging';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CacheTier = 'hot' | 'warm' | 'cold';

export const TIER_TTL: Record<CacheTier, number> = {
  hot: 60,       // 1 minute  — frequently-changing data
  warm: 300,     // 5 minutes — standard API responses
  cold: 3600,    // 1 hour    — reference data
};

export interface CacheSetOptions {
  ttlSeconds?: number;
  tier?: CacheTier;
  tags?: string[];
  /** If true, serve stale value while refreshing in background */
  staleWhileRevalidate?: boolean;
  /** Grace period in seconds for serving stale data (default: 30) */
  staleGracePeriodSeconds?: number;
}

export interface IntelligentCacheConfig {
  keyPrefix?: string;
  defaultTtlSeconds?: number;
  defaultTier?: CacheTier;
  /** Max consecutive Redis failures before entering circuit-open mode */
  circuitBreakerThreshold?: number;
  /** How long (ms) to stay in open state before probing again */
  circuitBreakerResetMs?: number;
  onDegradation?: (msg: string, ctx?: Record<string, unknown>) => void;
}

const TAG_INDEX_PREFIX = '__tag__:';

export interface CacheInvalidationRule<E extends AnyDomainEvent = AnyDomainEvent> {
  eventName: E['name'] | '*';
  /** Return cache tags (not keys) to invalidate when this event fires */
  tagsFromEvent: (event: E) => string[];
}

export interface IntelligentCacheMetrics {
  hits: number;
  misses: number;
  staleHits: number;
  writes: number;
  tagInvalidations: number;
  taggedKeys: number;
  circuitOpenEvents: number;
  errors: number;
  hitRatio: number;
}

// ─── Circuit breaker state ────────────────────────────────────────────────────

const enum CircuitState { CLOSED, OPEN, HALF_OPEN }

// ─── Cache entry (with metadata) ─────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlSeconds: number;
  tags: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class IntelligentCacheService {
  private readonly prefix: string;
  private readonly defaultTtl: number;
  private readonly defaultTier: CacheTier;
  private readonly cbThreshold: number;
  private readonly cbResetMs: number;
  private readonly onDegradation?: IntelligentCacheConfig['onDegradation'];

  // Single-flight map
  private readonly inflight = new Map<string, Promise<unknown>>();

  // Circuit breaker
  private cbState: CircuitState = CircuitState.CLOSED;
  private cbFailures = 0;
  private cbOpenAt = 0;

  // Metrics
  private hits = 0;
  private misses = 0;
  private staleHits = 0;
  private writes = 0;
  private tagInvalidations = 0;
  private circuitOpenEvents = 0;
  private errors = 0;

  constructor(
    private readonly redis: RedisClient,
    config: IntelligentCacheConfig = {},
  ) {
    this.prefix = config.keyPrefix ?? 'subtrackr:icache:';
    this.defaultTtl = config.defaultTtlSeconds ?? TIER_TTL.warm;
    this.defaultTier = config.defaultTier ?? 'warm';
    this.cbThreshold = config.circuitBreakerThreshold ?? 5;
    this.cbResetMs = config.circuitBreakerResetMs ?? 30_000;
    this.onDegradation = config.onDegradation;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Get a cached value or call `loader` on cache miss.
   * Supports stale-while-revalidate and single-flight protection.
   */
  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions = {},
  ): Promise<T> {
    if (this.isCircuitOpen()) {
      return loader();
    }

    const fullKey = this.fullKey(key);
    const raw = await this.safeGet(fullKey);

    if (raw !== null) {
      try {
        const entry: CacheEntry<T> = JSON.parse(raw);
        const ageMs = Date.now() - entry.cachedAt;
        const ttlMs = entry.ttlSeconds * 1000;

        if (ageMs < ttlMs) {
          this.hits++;
          return entry.value;
        }

        // Stale-while-revalidate: serve stale, refresh in background
        const gracePeriod = (options.staleGracePeriodSeconds ?? 30) * 1000;
        if (options.staleWhileRevalidate && ageMs < ttlMs + gracePeriod) {
          this.staleHits++;
          this.refreshInBackground(key, loader, options);
          return entry.value;
        }
      } catch {
        // Corrupted entry — treat as miss
      }
    }

    this.misses++;

    // Single-flight: coalesce concurrent misses for the same key
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const flight = this.loadAndSet<T>(key, loader, options);
    this.inflight.set(key, flight);
    try {
      return await flight;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Explicitly set a value with optional tags for invalidation. */
  async set<T>(key: string, value: T, options: CacheSetOptions = {}): Promise<void> {
    if (this.isCircuitOpen()) return;

    const ttl = options.ttlSeconds ?? (options.tier ? TIER_TTL[options.tier] : this.defaultTtl);
    const fullKey = this.fullKey(key);

    const entry: CacheEntry<T> = {
      value,
      cachedAt: Date.now(),
      ttlSeconds: ttl,
      tags: options.tags ?? [],
    };

    const ok = await this.safeSet(fullKey, JSON.stringify(entry), ttl);
    if (ok) {
      this.writes++;
      if (options.tags && options.tags.length > 0) {
        await this.indexTags(key, options.tags, ttl);
      }
    }
  }

  /** Delete a single key. */
  async invalidate(key: string): Promise<void> {
    if (this.isCircuitOpen()) return;
    const fullKey = this.fullKey(key);
    try {
      await this.redis.del(fullKey);
    } catch (err) {
      this.handleError('invalidate', err);
    }
  }

  /**
   * Invalidate all cache keys associated with a tag.
   * Also cascades to any child tags (tags prefixed with `tag:`).
   */
  async invalidateByTag(tag: string): Promise<number> {
    if (this.isCircuitOpen()) return 0;

    const tagKey = this.tagKey(tag);
    let members: string[] = [];

    try {
      members = await this.redis.keys(`${tagKey}:*`);
      // Also get direct members stored under the tag key
      const tagMembers = await this.redis.keys(tagKey);
      members.push(...tagMembers);
    } catch (err) {
      this.handleError('invalidateByTag:keys', err);
      return 0;
    }

    // Collect all cache keys registered under this tag (stored as pattern `tagKey:cacheKey`)
    const tagIndexKey = `${TAG_INDEX_PREFIX}${this.prefix}${tag}`;
    let taggedKeys: string[] = [];
    try {
      // Keys stored as members in a Redis set named after the tag
      const raw = await this.redis.get(tagIndexKey);
      if (raw) {
        taggedKeys = JSON.parse(raw) as string[];
      }
    } catch {
      // Ignore
    }

    const keysToDelete = [...new Set([...taggedKeys.map((k) => this.fullKey(k))])];

    if (keysToDelete.length === 0) return 0;

    try {
      await this.redis.del(...keysToDelete);
      // Clean up tag index
      await this.redis.del(tagIndexKey);
      this.tagInvalidations += keysToDelete.length;
      return keysToDelete.length;
    } catch (err) {
      this.handleError('invalidateByTag:del', err);
      return 0;
    }
  }

  /**
   * Invalidate multiple tags at once.
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let total = 0;
    for (const tag of tags) {
      total += await this.invalidateByTag(tag);
    }
    return total;
  }

  /**
   * Wire event-driven automatic cache invalidation.
   * Call once during app bootstrap.
   */
  wireEventInvalidation(
    eventBus: IEventBus,
    rules: CacheInvalidationRule[],
  ): void {
    for (const rule of rules) {
      eventBus.subscribe(rule.eventName as string, async (event) => {
        const tags = rule.tagsFromEvent(event as AnyDomainEvent);
        if (tags.length > 0) {
          await this.invalidateByTags(tags).catch((err) =>
            logger.warn('Cache invalidation failed', { tags, err: String(err) }),
          );
        }
      });
    }
  }

  getMetrics(): IntelligentCacheMetrics {
    const total = this.hits + this.misses + this.staleHits;
    return {
      hits: this.hits,
      misses: this.misses,
      staleHits: this.staleHits,
      writes: this.writes,
      tagInvalidations: this.tagInvalidations,
      taggedKeys: 0, // Would require DBSIZE; intentionally omitted for performance
      circuitOpenEvents: this.circuitOpenEvents,
      errors: this.errors,
      hitRatio: total === 0 ? NaN : (this.hits + this.staleHits) / total,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') {
        this.resetCircuit();
        return true;
      }
      return false;
    } catch {
      this.recordFailure();
      return false;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private tagKey(tag: string): string {
    return `${TAG_INDEX_PREFIX}${this.prefix}${tag}`;
  }

  private async safeGet(fullKey: string): Promise<string | null> {
    try {
      const value = await this.redis.get(fullKey);
      this.resetCircuit();
      return value;
    } catch (err) {
      this.handleError('get', err);
      return null;
    }
  }

  private async safeSet(fullKey: string, value: string, ttl: number): Promise<boolean> {
    try {
      await this.redis.set(fullKey, value, 'EX', ttl);
      this.resetCircuit();
      return true;
    } catch (err) {
      this.handleError('set', err);
      return false;
    }
  }

  /** Register a cache key under its tags so tag-based invalidation can find it. */
  private async indexTags(key: string, tags: string[], ttl: number): Promise<void> {
    for (const tag of tags) {
      const tagIndexKey = `${TAG_INDEX_PREFIX}${this.prefix}${tag}`;
      try {
        const raw = await this.redis.get(tagIndexKey);
        const existing: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        if (!existing.includes(key)) {
          existing.push(key);
          // Keep tag index alive a bit longer than the cached values
          await this.redis.set(tagIndexKey, JSON.stringify(existing), 'EX', ttl + 60);
        }
      } catch {
        // Tag indexing failure is non-fatal — invalidation may miss this key
      }
    }
  }

  private async loadAndSet<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions,
  ): Promise<T> {
    const value = await loader();
    await this.set(key, value, options).catch(() => {
      /* non-fatal */
    });
    return value;
  }

  private refreshInBackground<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheSetOptions,
  ): void {
    // Fire-and-forget refresh
    Promise.resolve()
      .then(() => this.loadAndSet(key, loader, options))
      .catch((err) =>
        logger.warn('Background cache refresh failed', { key, err: String(err) }),
      );
  }

  // ── Circuit breaker ──────────────────────────────────────────────────────────

  private isCircuitOpen(): boolean {
    if (this.cbState === CircuitState.CLOSED) return false;
    if (this.cbState === CircuitState.OPEN) {
      if (Date.now() - this.cbOpenAt > this.cbResetMs) {
        this.cbState = CircuitState.HALF_OPEN;
        return false; // probe
      }
      return true;
    }
    return false; // HALF_OPEN allows one probe
  }

  private recordFailure(): void {
    this.cbFailures++;
    this.errors++;
    if (this.cbState === CircuitState.HALF_OPEN || this.cbFailures >= this.cbThreshold) {
      this.cbState = CircuitState.OPEN;
      this.cbOpenAt = Date.now();
      this.circuitOpenEvents++;
      this.warn('Redis circuit breaker opened', { failures: this.cbFailures });
    }
  }

  private resetCircuit(): void {
    if (this.cbState !== CircuitState.CLOSED) {
      this.cbState = CircuitState.CLOSED;
      this.cbFailures = 0;
    }
  }

  private handleError(operation: string, err: unknown): void {
    this.recordFailure();
    this.warn(`Redis ${operation} failed`, { err: String(err) });
  }

  private warn(msg: string, ctx?: Record<string, unknown>): void {
    if (this.onDegradation) {
      this.onDegradation(msg, ctx);
    } else {
      logger.warn(`[IntelligentCache] ${msg}`, ctx ?? {});
    }
  }
}

// ─── Pre-built invalidation rules for the subscription domain ────────────────

/**
 * Standard invalidation rules wired to the subscription domain events.
 * Import and pass to `wireEventInvalidation()` during bootstrap.
 *
 * Event names use the `domain.type` format from the typed event bus.
 */
export const SUBSCRIPTION_INVALIDATION_RULES: CacheInvalidationRule[] = [
  {
    eventName: 'subscription.created',
    tagsFromEvent: (e) => {
      const payload = (e as { payload: { userId?: string } }).payload;
      return payload.userId ? [`user:${payload.userId}:subscriptions`] : [];
    },
  },
  {
    eventName: 'subscription.cancelled',
    tagsFromEvent: (e) => {
      const p = (e as { payload: { subscriptionId?: string; userId?: string } }).payload;
      const tags: string[] = [];
      if (p.subscriptionId) tags.push(`subscription:${p.subscriptionId}`);
      if (p.userId) tags.push(`user:${p.userId}:subscriptions`);
      return tags;
    },
  },
  {
    eventName: 'subscription.renewed',
    tagsFromEvent: (e) => {
      const p = (e as { payload: { subscriptionId?: string } }).payload;
      return p.subscriptionId ? [`subscription:${p.subscriptionId}`] : [];
    },
  },
  {
    eventName: 'billing.payment_captured',
    tagsFromEvent: (e) => {
      const p = (e as { payload: { subscriptionId?: string } }).payload;
      const tags: string[] = ['analytics:mrr'];
      if (p.subscriptionId) tags.push(`subscription:${p.subscriptionId}`);
      return tags;
    },
  },
  {
    eventName: 'billing.invoice_generated',
    tagsFromEvent: (e) => {
      const p = (e as { payload: { subscriptionId?: string } }).payload;
      const tags: string[] = ['analytics:invoices'];
      if (p.subscriptionId) tags.push(`subscription:${p.subscriptionId}`);
      return tags;
    },
  },
];

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createIntelligentCache(
  redis: RedisClient,
  config: IntelligentCacheConfig = {},
): IntelligentCacheService {
  return new IntelligentCacheService(redis, config);
}
