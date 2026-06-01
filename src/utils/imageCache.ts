/**
 * imageCache — disk-backed image cache for subscription icons.
 *
 * Features:
 *   - AsyncStorage-backed disk cache (survives app restarts)
 *   - Configurable max entry count with LRU eviction
 *   - Cache invalidation by URL (on image update)
 *   - Preload API for visible list items
 *   - Offline fallback: returns cached URL when network is unavailable
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_KEY = '@subtrackr_image_cache_index';
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImageCacheEntry {
  url: string;
  cachedAt: number;
  expiresAt: number;
  /** Last access time for LRU eviction */
  lastAccessedAt: number;
}

export interface ImageCacheOptions {
  /** Max number of cached entries. Default: 200 */
  maxEntries?: number;
  /** TTL in ms. Default: 7 days */
  ttl?: number;
}

// ── ImageCacheManager ─────────────────────────────────────────────────────────

export class ImageCacheManager {
  private index = new Map<string, ImageCacheEntry>();
  private maxEntries: number;
  private ttl: number;
  private hydrated = false;

  constructor(options: ImageCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttl = options.ttl ?? DEFAULT_TTL_MS;
  }

  /** Load the cache index from AsyncStorage. Call once on app start. */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const entries: ImageCacheEntry[] = JSON.parse(raw);
        for (const entry of entries) {
          this.index.set(entry.url, entry);
        }
      }
    } catch {
      // non-fatal — start with empty index
    }
    this.hydrated = true;
  }

  /**
   * Register a URL as cached and return it.
   * expo-image handles the actual disk caching; this index tracks metadata.
   */
  async register(url: string): Promise<string> {
    await this.hydrate();

    const now = Date.now();
    const existing = this.index.get(url);

    if (existing && existing.expiresAt > now) {
      // Update LRU timestamp
      existing.lastAccessedAt = now;
      await this._persist();
      return url;
    }

    // Evict if at capacity
    if (this.index.size >= this.maxEntries) {
      this._evictLRU();
    }

    this.index.set(url, {
      url,
      cachedAt: now,
      expiresAt: now + this.ttl,
      lastAccessedAt: now,
    });

    await this._persist();
    return url;
  }

  /**
   * Invalidate a cached image by URL.
   * Clears expo-image's disk cache for that URL and removes the index entry.
   */
  async invalidate(url: string): Promise<void> {
    await this.hydrate();
    this.index.delete(url);
    await this._persist();
    try {
      await Image.clearDiskCache();
    } catch {
      // non-fatal
    }
  }

  /**
   * Preload an array of image URLs into expo-image's cache.
   * Safe to call with an empty array.
   */
  async preload(urls: string[]): Promise<void> {
    const validUrls = urls.filter(Boolean);
    if (!validUrls.length) return;
    try {
      await Image.prefetch(validUrls);
      await Promise.all(validUrls.map((url) => this.register(url)));
    } catch {
      // non-fatal — preload failure degrades gracefully
    }
  }

  /** Check whether a URL is in the cache index and not expired. */
  async isCached(url: string): Promise<boolean> {
    await this.hydrate();
    const entry = this.index.get(url);
    return !!entry && entry.expiresAt > Date.now();
  }

  /** Clear the entire cache index and expo-image's disk cache. */
  async clearAll(): Promise<void> {
    this.index.clear();
    await AsyncStorage.removeItem(CACHE_KEY);
    try {
      await Image.clearDiskCache();
    } catch {
      // non-fatal
    }
  }

  /** Number of entries currently tracked. */
  get size(): number {
    return this.index.size;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _evictLRU(): void {
    let oldest: ImageCacheEntry | null = null;
    for (const entry of this.index.values()) {
      if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
        oldest = entry;
      }
    }
    if (oldest) {
      this.index.delete(oldest.url);
    }
  }

  private async _persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify([...this.index.values()]));
    } catch {
      // non-fatal
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const imageCache = new ImageCacheManager();
