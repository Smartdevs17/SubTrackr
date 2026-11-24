/**
 * backend/src/lib/cache.ts
 *
 * Household-membership cache primitives (issue #2264).
 *
 * A zero-dependency, side-effect-free TTL + LRU cache. It performs no I/O and
 * reads no ambient state other than an injectable clock, so every policy
 * decision — hit/miss, expiry, eviction, invalidation — is deterministic and
 * unit-testable without a database or a real timer.
 *
 * Design rules (mirrors the other `backend/src/lib` engines):
 *  - Pure data in, pure data out. State lives only inside the returned handle.
 *  - Every rejection is a typed `CacheError` with a stable `code`.
 *  - Entries expire lazily on access and can be pruned eagerly.
 *  - Insertion order doubles as an LRU order; the oldest entry is evicted first
 *    once `maxEntries` is reached. A `get` refreshes recency; a `set` on an
 *    existing key replaces the value and refreshes recency.
 *  - Metrics and logger hooks are optional; no-op defaults are provided.
 *  - Returned snapshots are frozen so callers cannot mutate internal state.
 *
 * Usage:
 *   const cache = createTtlCache<string>({ maxEntries: 100, defaultTtlMs: 30_000 });
 *   cache.set('k', 'v');
 *   const value = cache.get('k'); // 'v' | undefined
 */

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/** Stable machine-readable codes emitted by this module. */
export const CacheErrorCode = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_KEY: 'INVALID_KEY',
  INVALID_TTL: 'INVALID_TTL',
  INVALID_VALUE: 'INVALID_VALUE',
} as const;

/** Union of every stable error code emitted by this module. */
export type CacheErrorCode = (typeof CacheErrorCode)[keyof typeof CacheErrorCode];

/** Typed error thrown for invalid configuration and invalid cache input. */
export class CacheError extends Error {
  readonly code: CacheErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CacheErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'CacheError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Configuration and data types
// ---------------------------------------------------------------------------

/**
 * Fully resolved cache configuration. Callers normally supply a `Partial` of
 * this shape to {@link createTtlCache}; defaults are filled in by
 * {@link validateCacheConfig}.
 */
export interface CacheConfig {
  /** Maximum number of live entries. Must be a positive integer. */
  maxEntries: number;
  /** Default time-to-live in milliseconds. Must be a positive finite number. */
  defaultTtlMs: number;
  /** Injectable clock; defaults to `Date.now`. Enables deterministic tests. */
  nowMs: () => number;
}

/** Immutable snapshot of a single cached entry. */
export interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
  /** Wall-clock time at which the entry was stored (ms). */
  readonly createdAtMs: number;
  /** Wall-clock time at which the entry becomes stale (ms). */
  readonly expiresAtMs: number;
  /** Per-entry TTL actually applied (ms). */
  readonly ttlMs: number;
}

/** Immutable snapshot of internal counters. */
export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly sets: number;
  readonly deletes: number;
  readonly expiries: number;
  readonly evictions: number;
  readonly prefixInvalidations: number;
  readonly size: number;
}

/** Reason an entry left the cache; reported through metrics/logging. */
export type CacheEvictionReason = 'ttl' | 'lru' | 'delete' | 'clear' | 'invalidate';

/** Optional observability hook for cache decisions. */
export interface CacheMetrics {
  recordHit(key: string): void;
  recordMiss(key: string): void;
  recordSet(key: string, ttlMs: number): void;
  recordDelete(key: string): void;
  recordExpiry(key: string): void;
  recordEviction(key: string, reason: CacheEvictionReason): void;
  recordClear(removed: number): void;
  recordInvalidateByPrefix(prefix: string, removed: number): void;
}

/** Optional logging hook for cache anomalies (expiry, eviction). */
export interface CacheLogger {
  debug(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
}

/** Defaults used when a caller omits configuration values. */
export const DEFAULT_CACHE_CONFIG: CacheConfig = Object.freeze({
  maxEntries: 500,
  defaultTtlMs: 60_000,
  nowMs: Date.now,
});

/** No-op metrics implementation, safe to use in tests and development. */
export const noopCacheMetrics: CacheMetrics = Object.freeze({
  recordHit: () => {},
  recordMiss: () => {},
  recordSet: () => {},
  recordDelete: () => {},
  recordExpiry: () => {},
  recordEviction: () => {},
  recordClear: () => {},
  recordInvalidateByPrefix: () => {},
});

/** No-op logger implementation. */
export const noopCacheLogger: CacheLogger = Object.freeze({
  debug: () => {},
  warn: () => {},
});

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new CacheError(CacheErrorCode.INVALID_CONFIG, `${field} must be a positive integer`, {
      field,
      value,
    });
  }
  return value;
}

function assertPositiveFinite(value: unknown, field: string, code: CacheErrorCode): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new CacheError(code, `${field} must be a positive finite number`, { field, value });
  }
  return value;
}

/** Validate a cache key: must be a non-empty string. */
function assertKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new CacheError(CacheErrorCode.INVALID_KEY, 'cache key must be a non-empty string', { key });
  }
  return key;
}

/** Validate a prefix: must be a non-empty string. */
function assertPrefix(prefix: unknown): string {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new CacheError(CacheErrorCode.INVALID_KEY, 'prefix must be a non-empty string', { prefix });
  }
  return prefix;
}

/**
 * Validate and resolve a partial configuration into a complete, frozen
 * `CacheConfig`. Throws `CacheError(INVALID_CONFIG)` on bad values.
 */
export function validateCacheConfig(config: Partial<CacheConfig> = {}): CacheConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new CacheError(CacheErrorCode.INVALID_CONFIG, 'config must be an object', { config });
  }

  const resolved: CacheConfig = {
    maxEntries: assertPositiveInteger(
      config.maxEntries ?? DEFAULT_CACHE_CONFIG.maxEntries,
      'maxEntries'
    ),
    defaultTtlMs: assertPositiveFinite(
      config.defaultTtlMs ?? DEFAULT_CACHE_CONFIG.defaultTtlMs,
      'defaultTtlMs',
      CacheErrorCode.INVALID_CONFIG
    ),
    nowMs: typeof config.nowMs === 'function' ? config.nowMs : DEFAULT_CACHE_CONFIG.nowMs,
  };
  return Object.freeze(resolved);
}

// ---------------------------------------------------------------------------
// Cache handle
// ---------------------------------------------------------------------------

/** In-memory TTL + LRU cache handle returned by {@link createTtlCache}. */
export interface TtlCache<T> {
  /** Return the live value for `key`, or `undefined` on miss/expiry. Refreshes LRU recency. */
  get(key: string): T | undefined;
  /** Store `value` under `key` with an optional per-entry TTL. Returns the frozen entry. */
  set(key: string, value: T, ttlMs?: number): CacheEntry<T>;
  /** Delete one key. Returns true when an entry was removed. */
  delete(key: string): boolean;
  /** Remove every entry. Returns the number removed. */
  clear(): number;
  /** True when a live (non-expired) entry exists for `key`. */
  has(key: string): boolean;
  /** Current number of live entries (prunes expired entries first). */
  size(): number;
  /** Frozen snapshot of all live entries, oldest (LRU) first. */
  entries(): readonly CacheEntry<T>[];
  /** Frozen snapshot of all live keys, oldest (LRU) first. */
  keys(): readonly string[];
  /** Delete every live key beginning with `prefix`. Returns the number removed. */
  invalidateByPrefix(prefix: string): number;
  /** Eagerly remove all expired entries. Returns the number removed. */
  prune(): number;
  /** Frozen snapshot of internal counters. */
  stats(): CacheStats;
  /** The fully resolved, frozen configuration. */
  readonly config: CacheConfig;
}

interface MutableEntry<T> {
  key: string;
  value: T;
  createdAtMs: number;
  expiresAtMs: number;
  ttlMs: number;
}

function freezeEntry<T>(entry: MutableEntry<T>): CacheEntry<T> {
  return Object.freeze({
    key: entry.key,
    value: entry.value,
    createdAtMs: entry.createdAtMs,
    expiresAtMs: entry.expiresAtMs,
    ttlMs: entry.ttlMs,
  });
}

/**
 * Create a zero-dependency TTL + LRU cache.
 *
 * @param config Partial configuration; see {@link DEFAULT_CACHE_CONFIG}.
 * @param metrics Optional observability sink (partial implementations allowed).
 * @param logger Optional logging sink (partial implementations allowed).
 */
export function createTtlCache<T>(
  config: Partial<CacheConfig> = {},
  metrics: Partial<CacheMetrics> = {},
  logger: Partial<CacheLogger> = {}
): TtlCache<T> {
  const cfg = validateCacheConfig(config);
  const m: CacheMetrics = { ...noopCacheMetrics, ...metrics };
  const l: CacheLogger = { ...noopCacheLogger, ...logger };
  // Map insertion order is LRU order: first = least recently used.
  const store = new Map<string, MutableEntry<T>>();
  const counters = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    expiries: 0,
    evictions: 0,
    prefixInvalidations: 0,
  };

  function now(): number {
    return cfg.nowMs();
  }

  function isExpired(entry: MutableEntry<T>, atMs: number): boolean {
    return atMs >= entry.expiresAtMs;
  }

  function dropEntry(key: string, entry: MutableEntry<T>, reason: CacheEvictionReason): void {
    store.delete(key);
    if (reason === 'ttl') {
      counters.expiries += 1;
    } else if (reason === 'lru') {
      counters.evictions += 1;
    }
    m.recordEviction(key, reason);
    if (reason === 'lru' || reason === 'ttl') {
      l.debug('cache entry removed', { key, reason });
    }
  }

  function touch(key: string, entry: MutableEntry<T>): void {
    // Re-insert to move the entry to the most-recently-used end.
    store.delete(key);
    store.set(key, entry);
  }

  function get(key: string): T | undefined {
    const k = assertKey(key);
    const entry = store.get(k);
    if (!entry) {
      counters.misses += 1;
      m.recordMiss(k);
      return undefined;
    }
    if (isExpired(entry, now())) {
      dropEntry(k, entry, 'ttl');
      counters.misses += 1;
      m.recordMiss(k);
      m.recordExpiry(k);
      return undefined;
    }
    touch(k, entry);
    counters.hits += 1;
    m.recordHit(k);
    return entry.value;
  }

  function set(key: string, value: T, ttlMs?: number): CacheEntry<T> {
    const k = assertKey(key);
    if (value === undefined) {
      throw new CacheError(CacheErrorCode.INVALID_VALUE, 'cache value must not be undefined', { key: k });
    }
    const ttl =
      ttlMs === undefined
        ? cfg.defaultTtlMs
        : assertPositiveFinite(ttlMs, 'ttlMs', CacheErrorCode.INVALID_TTL);
    const at = now();

    const existing = store.get(k);
    if (existing) {
      // Replace in place and refresh recency; eviction is not needed.
      store.delete(k);
    } else if (store.size >= cfg.maxEntries) {
      // Evict the least recently used entry (first in insertion order).
      const oldestKey = store.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        const oldest = store.get(oldestKey);
        if (oldest) dropEntry(oldestKey, oldest, 'lru');
      }
    }

    const entry: MutableEntry<T> = {
      key: k,
      value,
      createdAtMs: at,
      expiresAtMs: at + ttl,
      ttlMs: ttl,
    };
    store.set(k, entry);
    counters.sets += 1;
    m.recordSet(k, ttl);
    return freezeEntry(entry);
  }

  function del(key: string): boolean {
    const k = assertKey(key);
    const entry = store.get(k);
    if (!entry) return false;
    store.delete(k);
    counters.deletes += 1;
    m.recordDelete(k);
    m.recordEviction(k, 'delete');
    return true;
  }

  function clear(): number {
    const removed = store.size;
    store.clear();
    m.recordClear(removed);
    if (removed > 0) l.debug('cache cleared', { removed });
    return removed;
  }

  function has(key: string): boolean {
    const k = assertKey(key);
    const entry = store.get(k);
    if (!entry) return false;
    if (isExpired(entry, now())) {
      dropEntry(k, entry, 'ttl');
      m.recordExpiry(k);
      return false;
    }
    touch(k, entry);
    return true;
  }

  function size(): number {
    prune();
    return store.size;
  }

  function entries(): readonly CacheEntry<T>[] {
    prune();
    const snapshot: CacheEntry<T>[] = [];
    for (const entry of store.values()) snapshot.push(freezeEntry(entry));
    return Object.freeze(snapshot);
  }

  function keys(): readonly string[] {
    prune();
    return Object.freeze(Array.from(store.keys()));
  }

  function invalidateByPrefix(prefix: string): number {
    const p = assertPrefix(prefix);
    let removed = 0;
    for (const [key, entry] of store) {
      if (key.startsWith(p)) {
        store.delete(key);
        removed += 1;
        m.recordEviction(key, 'invalidate');
      }
    }
    if (removed > 0) {
      counters.prefixInvalidations += 1;
      m.recordInvalidateByPrefix(p, removed);
      l.debug('cache prefix invalidated', { prefix: p, removed });
    }
    return removed;
  }

  function prune(): number {
    const at = now();
    let removed = 0;
    for (const [key, entry] of store) {
      if (isExpired(entry, at)) {
        dropEntry(key, entry, 'ttl');
        m.recordExpiry(key);
        removed += 1;
      }
    }
    return removed;
  }

  function stats(): CacheStats {
    return Object.freeze({
      ...counters,
      size: store.size,
    });
  }

  return Object.freeze({
    get,
    set,
    delete: del,
    clear,
    has,
    size,
    entries,
    keys,
    invalidateByPrefix,
    prune,
    stats,
    config: cfg,
  });
}
