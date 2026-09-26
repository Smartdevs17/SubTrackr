/**
 * RedisCacheService — low-level distributed cache with single-flight protection,
 * graceful degradation, and Prometheus metrics export.
 */

import type { RedisCacheConfig, RedisCacheMetrics, RedisClient } from './types';

const DEFAULT_PREFIX = 'subtrackr:cache:';
const DEFAULT_TTL = 3600;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export class RedisCacheService {
  private readonly prefix: string;
  private readonly defaultTtl: number;
  private readonly onDegradation?: RedisCacheConfig['onDegradation'];

  private hits = 0;
  private misses = 0;
  private writes = 0;
  private invalidations = 0;
  private errors = 0;
  private degradations = 0;
  private latencies: number[] = [];
  private memoryUsageBytes = 0;
  private readonly keySizes = new Map<string, number>();
  private degraded = false;

  /** Single-flight map: only one loader runs per key on concurrent misses. */
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(
    private readonly redis: RedisClient,
    config: RedisCacheConfig = {},
  ) {
    this.prefix = config.keyPrefix ?? DEFAULT_PREFIX;
    this.defaultTtl = config.defaultTtlSeconds ?? DEFAULT_TTL;
    this.onDegradation = config.onDegradation;
  }

  /** True after a Redis failure; skips further Redis reads until health recovers. */
  isDegraded(): boolean {
    return this.degraded;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Returns a cached JSON value or null on miss.
   * When degraded, skips Redis and returns null immediately.
   */
  async get(key: string): Promise<string | null> {
    if (this.degraded) {
      return null;
    }

    const fullKey = this.fullKey(key);
    const start = Date.now();

    try {
      const value = await this.redis.get(fullKey);
      this.recordLatency(Date.now() - start);

      if (value !== null) {
        this.hits++;
        return value;
      }

      this.misses++;
      return null;
    } catch {
      this.errors++;
      this.enterDegraded('Redis get failed; returning cache miss', { key });
      return null;
    }
  }

  /**
   * Cache-aside with single-flight: on miss, exactly one concurrent loader
   * populates Redis while others await the same promise.
   */
  async getOrLoad(
    key: string,
    loader: () => Promise<string | null>,
    ttlSeconds?: number,
  ): Promise<string | null> {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    if (this.degraded) {
      return loader();
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }

    const flight = this.loadAndSet(key, loader, ttlSeconds);
    this.inflight.set(key, flight);

    try {
      return await flight;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** Stores a JSON-serializable string with TTL. Returns false when Redis is unavailable. */
  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    if (this.degraded) {
      return false;
    }

    const fullKey = this.fullKey(key);
    const ttl = ttlSeconds ?? this.defaultTtl;
    const start = Date.now();
    const newSize = Buffer.byteLength(value, 'utf8');

    try {
      await this.redis.set(fullKey, value, 'EX', ttl);
      this.writes++;
      const oldSize = this.keySizes.get(fullKey) ?? 0;
      this.keySizes.set(fullKey, newSize);
      this.memoryUsageBytes += newSize - oldSize;
      this.recordLatency(Date.now() - start);
      return true;
    } catch {
      this.errors++;
      this.enterDegraded('Redis set failed; value not cached', { key });
      return false;
    }
  }

  async invalidate(key: string): Promise<void> {
    if (this.degraded) {
      return;
    }

    const fullKey = this.fullKey(key);

    try {
      await this.redis.del(fullKey);
      this.invalidations++;
      this.releaseKeyMemory(fullKey);
    } catch {
      this.errors++;
      this.enterDegraded('Redis invalidate failed', { key });
    }
  }

  async invalidateAll(): Promise<void> {
    if (this.degraded) {
      return;
    }

    try {
      const keys = await this.redis.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.invalidations += keys.length;
        for (const fullKey of keys) {
          this.releaseKeyMemory(fullKey);
        }
      }
    } catch {
      this.errors++;
      this.enterDegraded('Redis invalidateAll failed');
    }
  }

  getMetrics(): RedisCacheMetrics {
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

  prometheusMetrics(namespace = 'subtrackr_plan_cache'): string {
    const m = this.getMetrics();
    const lines = [
      `# HELP ${namespace}_hits_total Cache hits`,
      `# TYPE ${namespace}_hits_total counter`,
      `${namespace}_hits_total ${m.hits}`,
      `# HELP ${namespace}_misses_total Cache misses`,
      `# TYPE ${namespace}_misses_total counter`,
      `${namespace}_misses_total ${m.misses}`,
      `# HELP ${namespace}_hit_ratio Cache hit ratio`,
      `# TYPE ${namespace}_hit_ratio gauge`,
      `${namespace}_hit_ratio ${Number.isNaN(m.hitRatio) ? 0 : m.hitRatio}`,
      `# HELP ${namespace}_latency_ms Cache operation latency percentiles`,
      `# TYPE ${namespace}_latency_ms summary`,
      `${namespace}_latency_ms{quantile="0.5"} ${m.latencyMs.p50}`,
      `${namespace}_latency_ms{quantile="0.95"} ${m.latencyMs.p95}`,
      `${namespace}_latency_ms{quantile="0.99"} ${m.latencyMs.p99}`,
      `# HELP ${namespace}_memory_usage_bytes Approximate cached payload bytes`,
      `# TYPE ${namespace}_memory_usage_bytes gauge`,
      `${namespace}_memory_usage_bytes ${m.memoryUsageBytes}`,
      `# HELP ${namespace}_degradations_total Redis degradation events`,
      `# TYPE ${namespace}_degradations_total counter`,
      `${namespace}_degradations_total ${m.degradations}`,
    ];
    return lines.join('\n');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.redis.ping();
      if (response === 'PONG') {
        this.degraded = false;
        return true;
      }
      return false;
    } catch {
      this.enterDegraded('Redis ping failed');
      return false;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  private async loadAndSet(
    key: string,
    loader: () => Promise<string | null>,
    ttlSeconds?: number,
  ): Promise<string | null> {
    try {
      const value = await loader();
      if (value !== null) {
        await this.set(key, value, ttlSeconds);
      }
      return value;
    } catch {
      this.errors++;
      return null;
    }
  }

  private releaseKeyMemory(fullKey: string): void {
    const size = this.keySizes.get(fullKey) ?? 0;
    if (size > 0) {
      this.memoryUsageBytes = Math.max(0, this.memoryUsageBytes - size);
      this.keySizes.delete(fullKey);
    }
  }

  private enterDegraded(message: string, context?: Record<string, unknown>): void {
    if (!this.degraded) {
      this.degraded = true;
      this.degradations++;
    }
    this.warnDegradation(message, context);
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 10_000) {
      this.latencies.shift();
    }
  }

  private warnDegradation(message: string, context?: Record<string, unknown>): void {
    if (this.onDegradation) {
      this.onDegradation(message, context);
    } else {
      console.warn(`[RedisCacheService] ${message}`, context ?? {});
    }
  }
}

export type { RedisClient, RedisCacheMetrics, RedisCacheConfig } from './types';
