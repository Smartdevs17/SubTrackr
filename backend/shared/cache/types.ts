/**
 * Minimal Redis client interface for cache services.
 * Compatible with ioredis, node-redis, and test doubles.
 */

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: 'EX', time: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
}

export interface RedisCacheMetrics {
  hits: number;
  misses: number;
  writes: number;
  invalidations: number;
  errors: number;
  degradations: number;
  /** hits / (hits + misses). NaN when no reads yet. */
  hitRatio: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
  };
  /** Approximate serialized payload bytes currently tracked in metrics. */
  memoryUsageBytes: number;
}

export interface RedisCacheConfig {
  /** Key prefix for namespacing. */
  keyPrefix?: string;
  /** Default TTL in seconds when not overridden per entry. */
  defaultTtlSeconds?: number;
  /** Optional warning logger for Redis degradation events. */
  onDegradation?: (message: string, context?: Record<string, unknown>) => void;
}
