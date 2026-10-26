/**
 * Generic Redis Cache Service — SubTrackr
 *
 * Features:
 *  - Generic typed get/set with JSON serialization
 *  - TTL-based expiration with per-key override
 *  - Event-driven invalidation via EventBus subscriptions
 *  - Single-flight protection on concurrent cache misses
 *  - Cache warming on startup with concurrency control
 *  - Graceful degradation: Redis failure → DB fallback, no throws
 *  - Cache bypass for stale data (force-refresh flag)
 *  - Prometheus metrics: hit ratio, latency percentiles, memory, degradations
 *  - Compatible with the existing RedisCacheService low-level layer
 */

import type { RedisClient } from '../../shared/cache/types';
import type { IEventBus, AnyDomainEvent } from './events';
import { logger } from './logging';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface CacheServiceConfig {
  /** Redis key prefix — default `"subtrackr:cache:"` */
  keyPrefix?: string;
  /** Default TTL in seconds — default 300 (5 min) */
  defaultTtlSeconds?: number;
  /** Max concurrent warm-up writes — default 10 */
  warmConcurrency?: number;
  /** Called on Redis failure for external alerting */
  onDegradation?: (msg: string, ctx?: Record<string, unknown>) => void;
}

const DEFAULTS: Required<Omit<CacheServiceConfig, 'onDegradation'>> = {
  keyPrefix: 'subtrackr:cache:',
  defaultTtlSeconds: 300,
  warmConcurrency: 10,
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface CacheMetrics {
  hits: number;
  misses: number;
  writes: number;
  invalidations: number;
  errors: number;
  degradations: number;
  hitRatio: number;
  latencyMs: { p50: number; p95: number; p99: number };
  memoryUsageBytes: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ─── Cache Entry ──────────────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttlSeconds: number;
}

// ─── Event-Driven Invalidation Rule ──────────────────────────────────────────

export interface InvalidationRule<T extends AnyDomainEvent = AnyDomainEvent> {
  /** Event name or `"*"` to match all events */
  eventName: T['name'] | '*';
  /** Given the event, return the cache keys to invalidate */
  keysFromEvent: (event: T) => string[];
}

// ─── Service Interface ────────────────────────────────────────────────────────

export interface ICacheService {
  /**
   * Returns the cached value or calls `loader` on miss.
   * Pass `bypassCache: true` to skip the cache and force a fresh load.
   */
  getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    options?: { ttlSeconds?: number; bypassCache?: boolean },
  ): Promise<T | null>;

  /** Explicitly set a value in the cache */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean>;

  /** Invalidate one or more cache keys */
  invalidate(...keys: string[]): Promise<void>;

  /** Invalidate all keys matching a prefix pattern */
  invalidatePattern(prefix: string): Promise<void>;

  /** Warm the cache from a bulk data source */
  warm<T>(
    entries: Array<{ key: string; value: T; ttlSeconds?: number }>,
  ): Promise<{ warmed: number; errors: number }>;

  getMetrics(): CacheMetrics;
  resetMetrics(): void;
  isHealthy(): Promise<boolean>;
  isDegraded(): boolean;
  prometheusMetrics(namespace?: string): string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class CacheService implements ICacheService {
  private readonly prefix: string;
  private readonly defaultTtl: number;
  private readonly warmConcurrency: number;
  private readonly onDegradation?: CacheServiceConfig['onDegradation'];

  private degraded = false;

  // Metrics
  private hits = 0;
  private misses = 0;
  private writes = 0;
  private invalidations = 0;
  private errors = 0;
  private degradations = 0;
  private latencies: number[] = [];
  private memoryUsageBytes = 0;
  private readonly keySizes = new Map<string, number>();

  /** Single-flight map: one loader per key on concurrent misses */
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly redis: RedisClient,
    config: CacheServiceConfig = {},
  ) {
    this.prefix = config.keyPrefix ?? DEFAULTS.keyPrefix;
    this.defaultTtl = config.defaultTtlSeconds ?? DEFAULTS.defaultTtlSeconds;
    this.warmConcurrency = config.warmConcurrency ?? DEFAULTS.warmConcurrency;
    this.onDegradation = config.onDegradation;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async getOrLoad<T>(
    key: string,
    loader: () => Promise<T | null>,
    options: { ttlSeconds?: number; bypassCache?: boolean } = {},
  ): Promise<T | null> {
    // Bypass: skip cache, load fresh, write through
    if (options.bypassCache) {
      const fresh = await loader();
      if (fresh !== null && fresh !== undefined) {
        await this.set(key, fresh, options.ttlSeconds);
      }
      return fresh;
    }

    if (!this.degraded) {
      const cached = await this.redisGet(key);
      if (cached !== null) {
        this.hits++;
        return this.deserialize<T>(cached);
      }
    }

    this.misses++;
    return this.singleFlight(key, loader, options.ttlSeconds);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    if (this.degraded) return false;
    const serialized = this.serialize(value);
    return this.redisSet(key, serialized, ttlSeconds ?? this.defaultTtl);
  }

  async invalidate(...keys: string[]): Promise<void> {
    if (this.degraded) return;
    const fullKeys = keys.map((k) => this.fullKey(k));
    try {
      const start = Date.now();
      await this.redis.del(...fullKeys);
      this.recordLatency(Date.now() - start);
      this.invalidations += fullKeys.length;
      for (const fk of fullKeys) this.releaseMemory(fk);
    } catch (err) {
      this.errors++;
      this.enterDegraded('Redis del failed', { keys });
    }
  }

  async invalidatePattern(prefix: string): Promise<void> {
    if (this.degraded) return;
    const pattern = `${this.prefix}${prefix}*`;
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.invalidations += keys.length;
        for (const k of keys) this.releaseMemory(k);
      }
    } catch (err) {
      this.errors++;
      this.enterDegraded('Redis keys/del failed during pattern invalidation', { pattern });
    }
  }

  async warm<T>(
    entries: Array<{ key: string; value: T; ttlSeconds?: number }>,
  ): Promise<{ warmed: number; errors: number }> {
    const healthy = await this.isHealthy();
    if (!healthy) return { warmed: 0, errors: 1 };

    let warmed = 0;
    let errorCount = 0;

    // Process in chunks to respect concurrency limit
    for (let i = 0; i < entries.length; i += this.warmConcurrency) {
      const chunk = entries.slice(i, i + this.warmConcurrency);
      await Promise.all(
        chunk.map(async ({ key, value, ttlSeconds }) => {
          const ok = await this.set(key, value, ttlSeconds);
          if (ok) warmed++;
          else errorCount++;
        }),
      );
    }

    logger.info('[CacheService] Warm complete', { warmed, errors: errorCount, total: entries.length });
    return { warmed, errors: errorCount };
  }

  getMetrics(): CacheMetrics {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      invalidations: this.invalidations,
      errors: this.errors,
      degradations: this.degradations,
      hitRatio: total === 0 ? NaN : this.hits / total,
      latencyMs: {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      },
      memoryUsageBytes: this.memoryUsageBytes,
    };
  }

  resetMetrics(): void {
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.invalidations = 0;
    this.errors = 0;
    this.degradations = 0;
    this.latencies = [];
    this.memoryUsageBytes = 0;
    this.keySizes.clear();
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      if (pong === 'PONG') {
        this.degraded = false;
        return true;
      }
      return false;
    } catch {
      this.enterDegraded('Redis ping failed');
      return false;
    }
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  prometheusMetrics(namespace = 'subtrackr_cache'): string {
    const m = this.getMetrics();
    return [
      `# HELP ${namespace}_hits_total Cache hits`,
      `# TYPE ${namespace}_hits_total counter`,
      `${namespace}_hits_total ${m.hits}`,
      `# HELP ${namespace}_misses_total Cache misses`,
      `# TYPE ${namespace}_misses_total counter`,
      `${namespace}_misses_total ${m.misses}`,
      `# HELP ${namespace}_hit_ratio Cache hit ratio`,
      `# TYPE ${namespace}_hit_ratio gauge`,
      `${namespace}_hit_ratio ${Number.isNaN(m.hitRatio) ? 0 : m.hitRatio}`,
      `# HELP ${namespace}_writes_total Cache writes`,
      `# TYPE ${namespace}_writes_total counter`,
      `${namespace}_writes_total ${m.writes}`,
      `# HELP ${namespace}_invalidations_total Cache invalidations`,
      `# TYPE ${namespace}_invalidations_total counter`,
      `${namespace}_invalidations_total ${m.invalidations}`,
      `# HELP ${namespace}_errors_total Redis errors`,
      `# TYPE ${namespace}_errors_total counter`,
      `${namespace}_errors_total ${m.errors}`,
      `# HELP ${namespace}_degradations_total Redis degradation events`,
      `# TYPE ${namespace}_degradations_total counter`,
      `${namespace}_degradations_total ${m.degradations}`,
      `# HELP ${namespace}_latency_ms Cache operation latency percentiles`,
      `# TYPE ${namespace}_latency_ms summary`,
      `${namespace}_latency_ms{quantile="0.5"} ${m.latencyMs.p50}`,
      `${namespace}_latency_ms{quantile="0.95"} ${m.latencyMs.p95}`,
      `${namespace}_latency_ms{quantile="0.99"} ${m.latencyMs.p99}`,
      `# HELP ${namespace}_memory_usage_bytes Approximate cached payload size`,
      `# TYPE ${namespace}_memory_usage_bytes gauge`,
      `${namespace}_memory_usage_bytes ${m.memoryUsageBytes}`,
    ].join('\n');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private serialize<T>(value: T): string {
    const entry: CacheEntry<T> = {
      value,
      cachedAt: Date.now(),
      ttlSeconds: this.defaultTtl,
    };
    return JSON.stringify(entry);
  }

  private deserialize<T>(raw: string): T | null {
    try {
      const entry = JSON.parse(raw) as CacheEntry<T>;
      return entry.value ?? null;
    } catch {
      return null;
    }
  }

  private async redisGet(key: string): Promise<string | null> {
    const fk = this.fullKey(key);
    const start = Date.now();
    try {
      const val = await this.redis.get(fk);
      this.recordLatency(Date.now() - start);
      return val;
    } catch {
      this.errors++;
      this.enterDegraded('Redis get failed', { key });
      return null;
    }
  }

  private async redisSet(key: string, value: string, ttl: number): Promise<boolean> {
    const fk = this.fullKey(key);
    const start = Date.now();
    const newSize = Buffer.byteLength(value, 'utf8');
    try {
      await this.redis.set(fk, value, 'EX', ttl);
      this.writes++;
      const oldSize = this.keySizes.get(fk) ?? 0;
      this.keySizes.set(fk, newSize);
      this.memoryUsageBytes += newSize - oldSize;
      this.recordLatency(Date.now() - start);
      return true;
    } catch {
      this.errors++;
      this.enterDegraded('Redis set failed', { key });
      return false;
    }
  }

  private async singleFlight<T>(
    key: string,
    loader: () => Promise<T | null>,
    ttlSeconds?: number,
  ): Promise<T | null> {
    if (this.degraded) {
      return loader();
    }

    const existing = this.inflight.get(key);
    if (existing) {
      const raw = await existing;
      return raw !== null ? this.deserialize<T>(raw) : null;
    }

    const flight = (async (): Promise<string | null> => {
      try {
        const value = await loader();
        if (value !== null && value !== undefined) {
          const serialized = this.serialize(value);
          await this.redisSet(key, serialized, ttlSeconds ?? this.defaultTtl);
          return serialized;
        }
        return null;
      } catch {
        this.errors++;
        return null;
      }
    })();

    this.inflight.set(key, flight);
    try {
      const raw = await flight;
      return raw !== null ? this.deserialize<T>(raw) : null;
    } finally {
      this.inflight.delete(key);
    }
  }

  private releaseMemory(fullKey: string): void {
    const size = this.keySizes.get(fullKey) ?? 0;
    if (size > 0) {
      this.memoryUsageBytes = Math.max(0, this.memoryUsageBytes - size);
      this.keySizes.delete(fullKey);
    }
  }

  private enterDegraded(msg: string, ctx?: Record<string, unknown>): void {
    if (!this.degraded) {
      this.degraded = true;
      this.degradations++;
    }
    if (this.onDegradation) {
      this.onDegradation(msg, ctx);
    } else {
      logger.warn(`[CacheService] ${msg}`, ctx);
    }
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 10_000) this.latencies.shift();
  }
}

// ─── Event-Driven Invalidation Wiring ────────────────────────────────────────

/**
 * Attaches event-driven cache invalidation rules to a CacheService.
 * Each rule maps an event type to the cache keys it should evict.
 *
 * @example
 * wireInvalidation(cache, eventBus, [
 *   {
 *     eventName: 'subscription.cancelled',
 *     keysFromEvent: (e) => [`sub:${e.payload.subscriptionId}`, `user:${e.payload.userId}`],
 *   },
 * ]);
 */
export function wireInvalidation(
  cache: ICacheService,
  bus: IEventBus,
  rules: InvalidationRule[],
): Array<{ unsubscribe(): void }> {
  return rules.map((rule) =>
    bus.subscribe(rule.eventName, async (event) => {
      const keys = (rule as InvalidationRule<typeof event>).keysFromEvent(event as never);
      if (keys.length > 0) {
        await cache.invalidate(...keys);
        logger.debug('[CacheService] Event-driven invalidation', {
          eventName: event.name,
          keys,
        });
      }
    }),
  );
}

// ─── Null / No-Op Cache (for tests or Redis-less envs) ───────────────────────

export class NullCacheService implements ICacheService {
  async getOrLoad<T>(_key: string, loader: () => Promise<T | null>): Promise<T | null> {
    return loader();
  }
  async set<T>(_key: string, _value: T): Promise<boolean> { return false; }
  async invalidate(..._keys: string[]): Promise<void> { /* noop */ }
  async invalidatePattern(_prefix: string): Promise<void> { /* noop */ }
  async warm<T>(_entries: Array<{ key: string; value: T }>): Promise<{ warmed: number; errors: number }> {
    return { warmed: 0, errors: 0 };
  }
  getMetrics(): CacheMetrics {
    return { hits: 0, misses: 0, writes: 0, invalidations: 0, errors: 0, degradations: 0, hitRatio: NaN, latencyMs: { p50: 0, p95: 0, p99: 0 }, memoryUsageBytes: 0 };
  }
  resetMetrics(): void { /* noop */ }
  async isHealthy(): Promise<boolean> { return false; }
  isDegraded(): boolean { return true; }
  prometheusMetrics(): string { return ''; }
}
