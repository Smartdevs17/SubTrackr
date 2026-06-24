/**
 * CacheService — multi-layer caching with offline queue and sync conflict resolution.
 *
 * Layers (read order):
 *   L1: in-memory Map (fastest, process-lifetime)
 *   L2: AsyncStorage (survives app restarts)
 *
 * Features:
 *   - TTL-based invalidation per entry
 *   - Tag-based bulk invalidation
 *   - Offline operation queue with conflict resolution (last-write-wins by default)
 *   - Prefetch API for navigation hints
 *   - Cache metrics (hits, misses, evictions, queue depth)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  value: T;
  expiresAt: number; // epoch ms; 0 = never
  tags: string[];
}

export interface OfflineOperation {
  id: string;
  key: string;
  value: unknown;
  timestamp: number;
  /** Conflict key: operations sharing the same key are deduplicated (last wins) */
  conflictKey: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  offlineQueueDepth: number;
}

export interface CacheOptions {
  /** TTL in milliseconds. 0 = never expires. Default: 60_000 */
  ttl?: number;
  /** Tags for bulk invalidation */
  tags?: string[];
}

export type ConflictResolution = 'last-write-wins' | 'first-write-wins';

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = '@subtrackr_cache:';
const OFFLINE_QUEUE_KEY = '@subtrackr_offline_queue';
const DEFAULT_TTL_MS = 60_000;

// ── CacheService ──────────────────────────────────────────────────────────────

export class CacheService {
  private l1 = new Map<string, CacheEntry<unknown>>();
  private offlineQueue: OfflineOperation[] = [];
  private metrics: CacheMetrics = { hits: 0, misses: 0, evictions: 0, offlineQueueDepth: 0 };
  private conflictResolution: ConflictResolution;

  constructor(conflictResolution: ConflictResolution = 'last-write-wins') {
    this.conflictResolution = conflictResolution;
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  async get<T>(key: string): Promise<T | null> {
    // L1
    const l1Entry = this.l1.get(key) as CacheEntry<T> | undefined;
    if (l1Entry) {
      if (this._isExpired(l1Entry)) {
        this.l1.delete(key);
        this.metrics.evictions++;
      } else {
        this.metrics.hits++;
        return l1Entry.value;
      }
    }

    // L2
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PREFIX + key);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry<T>;
        if (this._isExpired(entry)) {
          await AsyncStorage.removeItem(STORAGE_PREFIX + key);
          this.metrics.evictions++;
        } else {
          this.l1.set(key, entry as CacheEntry<unknown>); // promote to L1
          this.metrics.hits++;
          return entry.value;
        }
      }
    } catch {
      // storage read failure is non-fatal
    }

    this.metrics.misses++;
    return null;
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const ttl = options.ttl ?? DEFAULT_TTL_MS;
    const entry: CacheEntry<T> = {
      value,
      expiresAt: ttl === 0 ? 0 : Date.now() + ttl,
      tags: options.tags ?? [],
    };

    this.l1.set(key, entry as CacheEntry<unknown>);

    try {
      await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // L2 write failure is non-fatal; L1 still serves reads
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    try {
      await AsyncStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // non-fatal
    }
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  /** Invalidate all entries carrying the given tag. */
  async invalidateByTag(tag: string): Promise<void> {
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.l1.entries()) {
      if (entry.tags.includes(tag)) keysToDelete.push(key);
    }

    for (const key of keysToDelete) {
      this.l1.delete(key);
      this.metrics.evictions++;
      try {
        await AsyncStorage.removeItem(STORAGE_PREFIX + key);
      } catch {
        // non-fatal
      }
    }
  }

  /** Clear all L1 entries (L2 untouched — survives for offline reads). */
  clearMemory(): void {
    this.metrics.evictions += this.l1.size;
    this.l1.clear();
  }

  /** Full wipe of both layers. */
  async clearAll(): Promise<void> {
    this.clearMemory();
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter((k) => k.startsWith(STORAGE_PREFIX));
      if (cacheKeys.length) await AsyncStorage.multiRemove(cacheKeys);
    } catch {
      // non-fatal
    }
  }

  // ── Offline queue ─────────────────────────────────────────────────────────

  /**
   * Enqueue an operation to be replayed when connectivity is restored.
   * Conflict resolution is applied immediately on enqueue.
   */
  async enqueueOfflineOperation(key: string, value: unknown, conflictKey?: string): Promise<void> {
    const op: OfflineOperation = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      key,
      value,
      timestamp: Date.now(),
      conflictKey: conflictKey ?? key,
    };

    const existing = this.offlineQueue.findIndex((o) => o.conflictKey === op.conflictKey);

    if (existing !== -1) {
      if (this.conflictResolution === 'last-write-wins') {
        this.offlineQueue[existing] = op; // replace
      }
      // first-write-wins: discard new op (do nothing)
    } else {
      this.offlineQueue.push(op);
    }

    this.metrics.offlineQueueDepth = this.offlineQueue.length;
    await this._persistQueue();
  }

  /** Drain the offline queue, applying each operation to the cache. */
  async flushOfflineQueue(): Promise<OfflineOperation[]> {
    const flushed = [...this.offlineQueue];
    for (const op of flushed) {
      await this.set(op.key, op.value, { ttl: DEFAULT_TTL_MS });
    }
    this.offlineQueue = [];
    this.metrics.offlineQueueDepth = 0;
    await this._persistQueue();
    return flushed;
  }

  /** Restore the offline queue from AsyncStorage (call on app start). */
  async hydrateOfflineQueue(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
      if (raw) this.offlineQueue = JSON.parse(raw) as OfflineOperation[];
      this.metrics.offlineQueueDepth = this.offlineQueue.length;
    } catch {
      // non-fatal
    }
  }

  getOfflineQueue(): OfflineOperation[] {
    return [...this.offlineQueue];
  }

  // ── Prefetch ──────────────────────────────────────────────────────────────

  /**
   * Prefetch a value into cache using the provided loader.
   * No-ops if a valid entry already exists.
   */
  async prefetch<T>(
    key: string,
    loader: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<void> {
    const existing = await this.get<T>(key);
    if (existing !== null) return;
    try {
      const value = await loader();
      await this.set(key, value, options);
    } catch {
      // prefetch failure is silent — cache miss will trigger a fresh load
    }
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      offlineQueueDepth: this.offlineQueue.length,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _isExpired(entry: CacheEntry<unknown>): boolean {
    return entry.expiresAt !== 0 && Date.now() > entry.expiresAt;
  }

  private async _persistQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(this.offlineQueue));
    } catch {
      // non-fatal
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const cacheService = new CacheService();
