import type { CachedInvoicePreview, PreviewCache, PreviewCacheStats } from './types';

export interface InMemoryPreviewCacheOptions {
  /** Upper bound; the least-recently inserted entry is evicted first. */
  maxEntries?: number;
  now?: () => number;
}

/**
 * Process-local preview cache. TTL is carried on each entry so callers control
 * freshness; the cache only enforces expiry and the size bound.
 */
export class InMemoryPreviewCache implements PreviewCache {
  private readonly entries = new Map<string, CachedInvoicePreview>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private counters: PreviewCacheStats = {
    size: 0,
    hits: 0,
    misses: 0,
    sets: 0,
    invalidations: 0,
  };

  constructor(options: InMemoryPreviewCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 500);
    this.now = options.now ?? Date.now;
  }

  get(key: string): CachedInvoicePreview | undefined {
    this.pruneExpired();
    const entry = this.entries.get(key);
    if (!entry) {
      this.counters.misses += 1;
      this.syncSize();
      return undefined;
    }
    this.counters.hits += 1;
    this.syncSize();
    return entry;
  }

  set(key: string, preview: CachedInvoicePreview): void {
    this.pruneExpired();
    this.entries.delete(key);
    this.entries.set(key, preview);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.counters.sets += 1;
    this.syncSize();
  }

  invalidate(invoiceId: string): void {
    this.invalidateWhere((entry) => entry.invoiceId === invoiceId);
  }

  invalidateTenant(tenantId: string): void {
    this.invalidateWhere((entry) => entry.tenantId === tenantId);
  }

  stats(): PreviewCacheStats {
    this.pruneExpired();
    this.syncSize();
    return { ...this.counters };
  }

  private invalidateWhere(predicate: (entry: CachedInvoicePreview) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(entry)) this.entries.delete(key);
    }
    this.counters.invalidations += 1;
    this.syncSize();
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private syncSize(): void {
    this.counters.size = this.entries.size;
  }
}
