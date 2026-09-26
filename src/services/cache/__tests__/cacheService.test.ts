/**
 * Unit + integration tests for CacheService.
 *
 * Covers:
 *  - L1 / L2 read/write/promotion
 *  - TTL expiry and eviction
 *  - Tag-based invalidation
 *  - Offline queue: enqueue, conflict resolution, flush, hydrate
 *  - Prefetch (hit / miss / loader error)
 *  - Metrics
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CacheService } from '../cacheService';

// ── In-memory AsyncStorage ────────────────────────────────────────────────────
const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItem: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
  removeItem: jest.fn((k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve([...mockStore.keys()])),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach((k) => mockStore.delete(k));
    return Promise.resolve();
  }),
}));

beforeEach(() => {
  mockStore.clear();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
});

// ═════════════════════════════════════════════════════════════════════════════
describe('CacheService', () => {
  // ── L1 / L2 read-write ────────────────────────────────────────────────────

  it('set then get returns value from L1 without hitting AsyncStorage again', async () => {
    const svc = new CacheService();
    await svc.set('k1', { name: 'Netflix' }, { ttl: 60_000 });
    (AsyncStorage.getItem as jest.Mock).mockClear();

    const result = await svc.get<{ name: string }>('k1');
    expect(result).toEqual({ name: 'Netflix' });
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('get promotes L2 entry to L1 on first read', async () => {
    const svc = new CacheService();
    await svc.set('k2', 42, { ttl: 60_000 });

    // Simulate cold L1 (new instance shares same AsyncStorage mock)
    const svc2 = new CacheService();
    const result = await svc2.get<number>('k2');
    expect(result).toBe(42);
  });

  it('get returns null for unknown key', async () => {
    const svc = new CacheService();
    expect(await svc.get('missing')).toBeNull();
  });

  it('delete removes from both L1 and L2', async () => {
    const svc = new CacheService();
    await svc.set('k3', 'hello');
    await svc.delete('k3');

    expect(await svc.get('k3')).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('@subtrackr_cache:k3');
  });

  // ── TTL / expiry ──────────────────────────────────────────────────────────

  it('expired L1 entry is evicted and returns null', async () => {
    const svc = new CacheService();
    await svc.set('ttl-key', 'value', { ttl: 1 }); // 1 ms TTL

    await new Promise((r) => setTimeout(r, 5)); // let it expire

    const result = await svc.get('ttl-key');
    expect(result).toBeNull();
    expect(svc.getMetrics().evictions).toBeGreaterThanOrEqual(1);
  });

  it('ttl=0 entry never expires', async () => {
    const svc = new CacheService();
    await svc.set('forever', 'persistent', { ttl: 0 });

    await new Promise((r) => setTimeout(r, 5));
    expect(await svc.get('forever')).toBe('persistent');
  });

  // ── Tag invalidation ──────────────────────────────────────────────────────

  it('invalidateByTag removes all entries with that tag', async () => {
    const svc = new CacheService();
    await svc.set('a', 1, { tags: ['subs'] });
    await svc.set('b', 2, { tags: ['subs'] });
    await svc.set('c', 3, { tags: ['wallet'] });

    await svc.invalidateByTag('subs');

    expect(await svc.get('a')).toBeNull();
    expect(await svc.get('b')).toBeNull();
    expect(await svc.get<number>('c')).toBe(3); // unaffected
  });

  it('clearMemory wipes L1 but L2 still serves reads', async () => {
    const svc = new CacheService();
    await svc.set('persist', 'yes', { ttl: 60_000 });
    svc.clearMemory();

    // L2 should still have it
    const result = await svc.get('persist');
    expect(result).toBe('yes');
  });

  it('clearAll wipes both layers', async () => {
    const svc = new CacheService();
    await svc.set('wipe-me', 'data');
    await svc.clearAll();

    expect(await svc.get('wipe-me')).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  // ── Offline queue ─────────────────────────────────────────────────────────

  it('enqueueOfflineOperation adds an operation to the queue', async () => {
    const svc = new CacheService();
    await svc.enqueueOfflineOperation('update:sub-1', { price: 9.99 });

    expect(svc.getOfflineQueue()).toHaveLength(1);
    expect(svc.getOfflineQueue()[0].key).toBe('update:sub-1');
    expect(svc.getMetrics().offlineQueueDepth).toBe(1);
  });

  it('last-write-wins: second enqueue with same conflictKey replaces first', async () => {
    const svc = new CacheService('last-write-wins');
    await svc.enqueueOfflineOperation('update:sub-1', { price: 9.99 }, 'update:sub-1');
    await svc.enqueueOfflineOperation('update:sub-1', { price: 14.99 }, 'update:sub-1');

    const queue = svc.getOfflineQueue();
    expect(queue).toHaveLength(1);
    expect((queue[0].value as { price: number }).price).toBe(14.99);
  });

  it('first-write-wins: second enqueue with same conflictKey is discarded', async () => {
    const svc = new CacheService('first-write-wins');
    await svc.enqueueOfflineOperation('update:sub-1', { price: 9.99 }, 'update:sub-1');
    await svc.enqueueOfflineOperation('update:sub-1', { price: 14.99 }, 'update:sub-1');

    const queue = svc.getOfflineQueue();
    expect(queue).toHaveLength(1);
    expect((queue[0].value as { price: number }).price).toBe(9.99);
  });

  it('flushOfflineQueue applies operations to cache and clears the queue', async () => {
    const svc = new CacheService();
    await svc.enqueueOfflineOperation('sub:1', { name: 'Spotify' });
    await svc.enqueueOfflineOperation('sub:2', { name: 'Netflix' });

    const flushed = await svc.flushOfflineQueue();

    expect(flushed).toHaveLength(2);
    expect(svc.getOfflineQueue()).toHaveLength(0);
    expect(svc.getMetrics().offlineQueueDepth).toBe(0);
    expect(await svc.get('sub:1')).toEqual({ name: 'Spotify' });
  });

  it('hydrateOfflineQueue restores queue from AsyncStorage', async () => {
    const svc = new CacheService();
    await svc.enqueueOfflineOperation('op:1', { x: 1 });

    // New instance — L1 is empty, queue is empty
    const svc2 = new CacheService();
    await svc2.hydrateOfflineQueue();

    expect(svc2.getOfflineQueue()).toHaveLength(1);
    expect(svc2.getOfflineQueue()[0].key).toBe('op:1');
  });

  // ── Prefetch ──────────────────────────────────────────────────────────────

  it('prefetch calls loader and caches result on miss', async () => {
    const svc = new CacheService();
    const loader = jest.fn(async () => [1, 2, 3]);

    await svc.prefetch('list', loader as () => Promise<number[]>);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(await svc.get('list')).toEqual([1, 2, 3]);
  });

  it('prefetch skips loader when valid entry already cached', async () => {
    const svc = new CacheService();
    await svc.set('list', [1, 2, 3], { ttl: 60_000 });
    const loader = jest.fn(async () => [4, 5, 6]);

    await svc.prefetch('list', loader as () => Promise<number[]>);

    expect(loader).not.toHaveBeenCalled();
    expect(await svc.get('list')).toEqual([1, 2, 3]);
  });

  it('prefetch silently swallows loader errors', async () => {
    const svc = new CacheService();
    const loader = jest.fn(async () => {
      throw new Error('network error');
    });

    await expect(svc.prefetch('fail', loader as () => Promise<never>)).resolves.toBeUndefined();
    expect(await svc.get('fail')).toBeNull();
  });

  // ── Metrics ───────────────────────────────────────────────────────────────

  it('metrics track hits and misses correctly', async () => {
    const svc = new CacheService();
    await svc.get('no-exist'); // miss
    await svc.set('exists', 1);
    await svc.get('exists'); // hit

    const m = svc.getMetrics();
    expect(m.hits).toBe(1);
    expect(m.misses).toBe(1);
  });

  it('resetMetrics zeroes counters but preserves queue depth', async () => {
    const svc = new CacheService();
    await svc.get('x'); // miss
    await svc.enqueueOfflineOperation('op', {});
    svc.resetMetrics();

    const m = svc.getMetrics();
    expect(m.hits).toBe(0);
    expect(m.misses).toBe(0);
    expect(m.offlineQueueDepth).toBe(1); // preserved
  });
});
