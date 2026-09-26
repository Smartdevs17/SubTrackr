/**
 * CDN Edge Caching Service — SubTrackr
 *
 * Manages edge caching for API responses with TTL, purge, and invalidation.
 */

export interface CdnConfig {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  staleWhileRevalidateSeconds: number;
  purgeBatchSize: number;
}

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  headers: Record<string, string>;
  cachedAt: number;
  ttlMs: number;
  tags: string[];
}

export interface PurgeRequest {
  patterns: string[];
  tags?: string[];
}

export interface PurgeResult {
  purgedCount: number;
  patterns: string[];
}

export interface CdnMetrics {
  hits: number;
  misses: number;
  purges: number;
  hitRate: number;
}

export class CdnService {
  private cache = new Map<string, CacheEntry>();
  private tagIndex = new Map<string, Set<string>>();
  private config: CdnConfig;
  private metrics: CdnMetrics = { hits: 0, misses: 0, purges: 0, hitRate: 0 };

  constructor(config: Partial<CdnConfig> = {}) {
    this.config = {
      defaultTtlSeconds: config.defaultTtlSeconds ?? 300,
      maxTtlSeconds: config.maxTtlSeconds ?? 86400,
      staleWhileRevalidateSeconds: config.staleWhileRevalidateSeconds ?? 60,
      purgeBatchSize: config.purgeBatchSize ?? 100,
    };
  }

  get<T>(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }

    const now = Date.now();
    if (now > entry.cachedAt + entry.ttlMs) {
      this.cache.delete(key);
      this.removeFromTagIndex(key, entry.tags);
      this.metrics.misses++;
      this.updateHitRate();
      return null;
    }

    this.metrics.hits++;
    this.updateHitRate();
    return entry;
  }

  set<T>(key: string, data: T, options: { ttlSeconds?: number; tags?: string[] } = {}): void {
    const ttlMs = Math.min(
      (options.ttlSeconds ?? this.config.defaultTtlSeconds) * 1000,
      this.config.maxTtlSeconds * 1000,
    );

    const entry: CacheEntry<T> = {
      key,
      data,
      headers: {
        'cache-control': `public, max-age=${Math.floor(ttlMs / 1000)}, stale-while-revalidate=${this.config.staleWhileRevalidateSeconds}`,
        'cdn-cache-status': 'HIT',
      },
      cachedAt: Date.now(),
      ttlMs,
      tags: options.tags ?? [],
    };

    this.cache.set(key, entry);
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set());
      this.tagIndex.get(tag)!.add(key);
    }
  }

  purge(request: PurgeRequest): PurgeResult {
    let purgedCount = 0;
    const purgedPatterns: string[] = [];

    for (const pattern of request.patterns) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      for (const [key, entry] of this.cache) {
        if (regex.test(key)) {
          this.cache.delete(key);
          this.removeFromTagIndex(key, entry.tags);
          purgedCount++;
        }
      }
      purgedPatterns.push(pattern);
    }

    if (request.tags) {
      for (const tag of request.tags) {
        const keys = this.tagIndex.get(tag);
        if (keys) {
          for (const key of keys) {
            this.cache.delete(key);
            purgedCount++;
          }
          this.tagIndex.delete(tag);
        }
      }
    }

    this.metrics.purges++;
    return { purgedCount, patterns: purgedPatterns };
  }

  invalidate(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.removeFromTagIndex(key, entry.tags);
      this.cache.delete(key);
      return true;
    }
    return false;
  }

  getMetrics(): CdnMetrics {
    return { ...this.metrics };
  }

  private removeFromTagIndex(key: string, tags: string[]): void {
    for (const tag of tags) {
      this.tagIndex.get(tag)?.delete(key);
    }
  }

  private updateHitRate(): void {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hitRate = total > 0 ? this.metrics.hits / total : 0;
  }
}

export const cdnService = new CdnService();
