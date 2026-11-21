/** Bounded, tag-aware in-memory cache used by the query client. */

import { serializeQueryKey } from './queryKey';
import type { QueryEntry } from './types';

export interface QueryCacheOptions {
  /** Maximum number of entries before least-recently-used eviction. Default 200. */
  maxEntries?: number;
  now?: () => number;
  onEvict?: (key: string) => void;
}

export class QueryCache {
  private readonly entries = new Map<string, QueryEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onEvict?: (key: string) => void;

  constructor(options: QueryCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 200);
    this.now = options.now ?? Date.now;
    this.onEvict = options.onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Return a live entry, dropping it first if its TTL has elapsed. */
  get<T>(serializedKey: string): QueryEntry<T> | undefined {
    const entry = this.entries.get(serializedKey);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(serializedKey);
      this.onEvict?.(serializedKey);
      return undefined;
    }
    // Re-insert so LRU eviction reflects actual reads.
    this.entries.delete(serializedKey);
    this.entries.set(serializedKey, entry);
    return entry as QueryEntry<T>;
  }

  peek<T>(serializedKey: string): QueryEntry<T> | undefined {
    return this.entries.get(serializedKey) as QueryEntry<T> | undefined;
  }

  set<T>(
    key: QueryEntry['key'],
    data: T,
    options: { ttlMs: number; tags?: readonly string[] },
  ): QueryEntry<T> {
    const serializedKey = serializeQueryKey(key);
    const storedAt = this.now();
    const entry: QueryEntry<T> = {
      key,
      serializedKey,
      data,
      tags: options.tags ?? [],
      storedAt,
      expiresAt: storedAt + Math.max(0, options.ttlMs),
    };
    this.entries.delete(serializedKey);
    this.entries.set(serializedKey, entry as QueryEntry);
    this.evictOverflow();
    return entry;
  }

  delete(serializedKey: string): boolean {
    return this.entries.delete(serializedKey);
  }

  /** Remove all entries matching a predicate and return their serialised keys. */
  invalidate(predicate: (entry: QueryEntry) => boolean): string[] {
    const removed: string[] = [];
    for (const [serializedKey, entry] of Array.from(this.entries.entries())) {
      if (predicate(entry)) {
        this.entries.delete(serializedKey);
        removed.push(serializedKey);
      }
    }
    return removed;
  }

  clear(): string[] {
    const removed = Array.from(this.entries.keys());
    this.entries.clear();
    return removed;
  }

  entriesSnapshot(): QueryEntry[] {
    return Array.from(this.entries.values()).map((entry) => ({ ...entry }));
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
      this.onEvict?.(oldest);
    }
  }
}
