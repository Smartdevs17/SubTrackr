/**
 * backend/src/lib/__tests__/cache.test.ts
 *
 * Unit tests for the zero-dependency TTL + LRU cache (issue #2264).
 * Every documented behaviour — defaults, validation, happy path, TTL expiry
 * with an injectable clock, bounded LRU eviction, invalidation, malformed
 * input, counters and observability — is pinned here.
 */

import {
  CacheErrorCode,
  CacheError,
  DEFAULT_CACHE_CONFIG,
  noopCacheMetrics,
  noopCacheLogger,
  validateCacheConfig,
  createTtlCache,
} from '../cache';

/** Assert that `fn` throws a CacheError carrying the expected stable code. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error('expected function to throw');
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe('error surface and constants', () => {
  it('exposes stable error codes', () => {
    expect(CacheErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(CacheErrorCode.INVALID_KEY).toBe('INVALID_KEY');
    expect(CacheErrorCode.INVALID_TTL).toBe('INVALID_TTL');
    expect(CacheErrorCode.INVALID_VALUE).toBe('INVALID_VALUE');
  });

  it('builds a typed CacheError with code and details', () => {
    const error = new CacheError(CacheErrorCode.INVALID_KEY, 'bad key', { key: '' });
    expect(error instanceof Error).toBe(true);
    expect(error instanceof CacheError).toBe(true);
    expect(error.name).toBe('CacheError');
    expect(error.code).toBe('INVALID_KEY');
    expect(error.message).toBe('bad key');
    expect(error.details).toEqual({ key: '' });
  });

  it('exposes frozen defaults and noop hooks', () => {
    expect(Object.isFrozen(DEFAULT_CACHE_CONFIG)).toBe(true);
    expect(DEFAULT_CACHE_CONFIG.maxEntries).toBe(500);
    expect(DEFAULT_CACHE_CONFIG.defaultTtlMs).toBe(60000);
    expect(typeof noopCacheMetrics.recordHit).toBe('function');
    expect(typeof noopCacheLogger.warn).toBe('function');
  });
});

describe('validateCacheConfig', () => {
  it('fills in documented defaults', () => {
    const config = validateCacheConfig({});
    expect(config.maxEntries).toBe(500);
    expect(config.defaultTtlMs).toBe(60000);
    expect(typeof config.nowMs).toBe('function');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('preserves valid overrides and a custom clock', () => {
    const clock = () => 42;
    const config = validateCacheConfig({ maxEntries: 3, defaultTtlMs: 250, nowMs: clock });
    expect(config.maxEntries).toBe(3);
    expect(config.defaultTtlMs).toBe(250);
    expect(config.nowMs()).toBe(42);
  });

  it('rejects invalid configuration', () => {
    expectCode(() => validateCacheConfig({ maxEntries: 0 }), 'INVALID_CONFIG');
    expectCode(() => validateCacheConfig({ maxEntries: 1.5 }), 'INVALID_CONFIG');
    expectCode(() => validateCacheConfig({ defaultTtlMs: -1 }), 'INVALID_CONFIG');
    expectCode(() => validateCacheConfig({ defaultTtlMs: NaN }), 'INVALID_CONFIG');
    expectCode(() => validateCacheConfig(null), 'INVALID_CONFIG');
    expectCode(() => validateCacheConfig([]), 'INVALID_CONFIG');
  });
});

describe('createTtlCache happy path', () => {
  it('stores and retrieves a value', () => {
    const cache = createTtlCache<string>();
    const entry = cache.set('a', 'alpha');
    expect(cache.get('a')).toBe('alpha');
    expect(entry.key).toBe('a');
    expect(entry.value).toBe('alpha');
    expect(entry.ttlMs).toBe(60000);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it('returns undefined on a miss and tracks has/size', () => {
    const cache = createTtlCache<string>();
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('missing')).toBe(false);
    cache.set('x', 'one');
    expect(cache.has('x')).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it('deletes and clears entries', () => {
    const cache = createTtlCache<string>();
    cache.set('x', 'one');
    cache.set('y', 'two');
    expect(cache.delete('x')).toBe(true);
    expect(cache.delete('x')).toBe(false);
    expect(cache.size()).toBe(1);
    expect(cache.clear()).toBe(1);
    expect(cache.size()).toBe(0);
    expect(cache.get('y')).toBeUndefined();
  });

  it('returns frozen key and entry snapshots', () => {
    const cache = createTtlCache<string>();
    cache.set('a', '1');
    cache.set('b', '2');
    const keys = cache.keys();
    const entries = cache.entries();
    expect(Object.isFrozen(keys)).toBe(true);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(keys).toEqual(['a', 'b']);
    expect(entries).toHaveLength(2);
    expect(Object.isFrozen(entries[0])).toBe(true);
  });
});

describe('TTL expiry with an injectable clock', () => {
  it('expires an entry once the clock passes its deadline', () => {
    let clock = 1000;
    const cache = createTtlCache<string>({ defaultTtlMs: 100, nowMs: () => clock });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    clock = 1099;
    expect(cache.get('k')).toBe('v');
    clock = 1100;
    expect(cache.get('k')).toBeUndefined();
    expect(cache.has('k')).toBe(false);
    expect(cache.size()).toBe(0);
  });

  it('honours a per-entry TTL override', () => {
    let clock = 0;
    const cache = createTtlCache<string>({ defaultTtlMs: 1000, nowMs: () => clock });
    cache.set('short', 'v', 10);
    clock = 11;
    expect(cache.get('short')).toBeUndefined();
  });

  it('prunes expired entries eagerly', () => {
    let clock = 0;
    const cache = createTtlCache<string>({ defaultTtlMs: 5, nowMs: () => clock });
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.prune()).toBe(0);
    clock = 5;
    expect(cache.prune()).toBe(2);
    expect(cache.size()).toBe(0);
  });
});

describe('bounded LRU eviction', () => {
  it('evicts the least recently used entry when full', () => {
    const cache = createTtlCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.size()).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('refreshes recency on get', () => {
    const cache = createTtlCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.get('a')).toBe('1');
    cache.set('c', '3');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
  });

  it('replacing an existing key does not grow the cache', () => {
    const cache = createTtlCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('a', 'updated');
    expect(cache.size()).toBe(2);
    expect(cache.get('a')).toBe('updated');
  });
});

describe('invalidation', () => {
  it('invalidates every key beginning with a prefix', () => {
    const cache = createTtlCache<string>();
    cache.set('u:1|h:a', 'a');
    cache.set('u:1|h:b', 'b');
    cache.set('u:2|h:a', 'c');
    expect(cache.invalidateByPrefix('u:1|')).toBe(2);
    expect(cache.size()).toBe(1);
    expect(cache.has('u:2|h:a')).toBe(true);
    expect(cache.invalidateByPrefix('none')).toBe(0);
  });
});

describe('malformed input', () => {
  it('rejects invalid keys, TTLs and values', () => {
    const cache = createTtlCache<string>();
    expectCode(() => cache.set('', 'v'), 'INVALID_KEY');
    expectCode(() => cache.get(''), 'INVALID_KEY');
    expectCode(() => cache.set('k', 'v', 0), 'INVALID_TTL');
    expectCode(() => cache.set('k', 'v', NaN), 'INVALID_TTL');
    expectCode(() => cache.set('k', undefined), 'INVALID_VALUE');
    expectCode(() => cache.invalidateByPrefix(''), 'INVALID_KEY');
  });
});

describe('counters and observability hooks', () => {
  it('tracks hits, misses, sets, deletes and evictions in stats', () => {
    const cache = createTtlCache<string>({ maxEntries: 1 });
    cache.set('a', '1');
    cache.get('a');
    cache.get('miss');
    cache.set('b', '2');
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.sets).toBe(2);
    expect(stats.evictions).toBe(1);
    expect(Object.isFrozen(stats)).toBe(true);
  });

  it('emits metrics and log events for decisions and evictions', () => {
    const events: string[] = [];
    const warnings: string[] = [];
    const cache = createTtlCache<string>(
      { maxEntries: 1, defaultTtlMs: 10, nowMs: () => clock },
      {
        recordHit: () => { events.push('hit'); },
        recordMiss: () => { events.push('miss'); },
        recordSet: () => { events.push('set'); },
        recordDelete: () => { events.push('delete'); },
        recordExpiry: () => { events.push('expiry'); },
        recordEviction: (_key, reason) => { events.push('evict:' + reason); },
        recordClear: () => { events.push('clear'); },
        recordInvalidateByPrefix: () => { events.push('prefix'); },
      },
      { warn: (message) => { warnings.push(message); }, debug: () => {} }
    );
    let clock = 0;
    cache.set('a', '1');
    cache.get('a');
    cache.get('nope');
    cache.set('b', '2');
    cache.invalidateByPrefix('b');
    expect(events).toContain('set');
    expect(events).toContain('hit');
    expect(events).toContain('miss');
    expect(events).toContain('evict:lru');
    expect(events).toContain('prefix');
  });
});
