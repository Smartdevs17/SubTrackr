/**
 * Shared cache types — Redis application cache and CDN edge purge.
 */

export type CdnProvider = 'fastly' | 'cloudflare';

export interface CdnPurgeConfig {
  provider: CdnProvider;
  apiToken: string;
  serviceId: string;
  fetchImpl?: typeof fetch;
}

export interface CdnPurgeResult {
  success: boolean;
  provider: CdnProvider;
  surrogateKeys: string[];
  statusCode?: number;
  error?: string;
}

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
  hitRatio: number;
  latencyMs: { p50: number; p95: number; p99: number };
  memoryUsageBytes: number;
}

export interface RedisCacheConfig {
  keyPrefix?: string;
  defaultTtlSeconds?: number;
  onDegradation?: (message: string, context?: Record<string, unknown>) => void;
}
