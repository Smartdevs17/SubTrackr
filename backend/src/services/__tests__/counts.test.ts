/** Unit tests for the Redis-backed subscription count cache (Issue #2077). */

import {
  createSubscriptionCountCache,
  StructuredCountCacheTelemetry,
  SUBSCRIPTION_COUNTS_TAG,
  SUBSCRIPTIONS_TAG,
  subscriptionCountTag,
  userSubscriptionCountsTag,
  type CountRedisClient,
  type SubscriptionCounts,
} from '../counts';

const COUNTS: SubscriptionCounts = { total: 12, active: 8, canceled: 3, pastDue: 1 };
const UPDATED: SubscriptionCounts = { total: 13, active: 9, canceled: 3, pastDue: 1 };

class FakeRedis implements CountRedisClient {
  private readonly values = new Map<string, { value: string; expiresAt: number | null }>();
  private readonly sets = new Map<string, { members: Set<string>; expiresAt: number | null }>();

  failReads = false;
  failWrites = false;
  failTags = false;
  failInvalidation = false;

  constructor(private readonly now: () => number) {}

  async get(key: string): Promise<string | null> {
    if (this.failReads) throw new Error('redis read failed');
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<void> {
    if (this.failWrites) throw new Error('redis write failed');
    if (mode !== 'EX') throw new Error('cache must use a TTL');
    this.values.set(key, { value, expiresAt: this.now() + ttlSeconds * 1_000 });
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key) || this.sets.delete(key)) removed += 1;
    }
    return removed;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (this.failTags) throw new Error('tag registration failed');
    let set = this.sets.get(key);
    if (!set) {
      set = { members: new Set<string>(), expiresAt: null };
      this.sets.set(key, set);
    }
    for (const member of members) set.members.add(member);
    return members.length;
  }

  async smembers(key: string): Promise<string[]> {
    if (this.failInvalidation) throw new Error('tag read failed');
    const set = this.sets.get(key);
    if (!set) return [];
    if (set.expiresAt !== null && set.expiresAt <= this.now()) {
      this.sets.delete(key);
      return [];
    }
    return [...set.members];
  }

  async expire(key: string, seconds: number): Promise<void> {
    if (this.failTags) throw new Error('tag expiry failed');
    const value = this.values.get(key);
    if (value) value.expiresAt = this.now() + seconds * 1_000;
    const set = this.sets.get(key);
    if (set) set.expiresAt = this.now() + seconds * 1_000;
  }

  /** Test helper: poison a cache value to exercise malformed-entry handling. */
  seedRaw(key: string, value: string): void {
    this.values.set(key, { value, expiresAt: this.now() + 60_000 });
  }

  keys(): string[] {
    return [...this.values.keys()];
  }
}

function harness(overrides: Record<string, unknown> = {}) {
  let clock = 1_700_000_000_000;
  const redis = new FakeRedis(() => clock);
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const metrics = new StructuredCountCacheTelemetry(logger);
  const cache = createSubscriptionCountCache({
    redis,
    ttlSeconds: 30,
    staleGraceSeconds: 60,
    now: () => clock,
    logger,
    metrics,
    ...overrides,
  });

  return {
    cache,
    redis,
    logger,
    metrics,
    advance(ms: number) {
      clock += ms;
    },
    query: { scope: 'user', scopeId: 'u-1' },
  };
}

describe('SubscriptionCountCache (Issue #2077)', () => {
  it('loads counts once and serves subsequent reads from Redis', async () => {
    const { cache, metrics } = harness();
    const loader = jest.fn().mockResolvedValue(COUNTS);

    await expect(cache.getCounts({ scope: 'global' }, loader)).resolves.toEqual(COUNTS);
    await expect(cache.getCounts({ scope: 'global' }, loader)).resolves.toEqual(COUNTS);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(metrics.value('miss')).toBe(1);
    expect(metrics.value('hit')).toBe(1);
  });

  it('builds stable keys that ignore filter order but separate scopes', async () => {
    const { cache } = harness();
    const a = cache.keyFor({
      scope: 'user',
      scopeId: 'u-1',
      filters: { status: 'active', search: 'net' },
    });
    const b = cache.keyFor({
      scope: 'user',
      scopeId: 'u-1',
      filters: { search: 'net', status: 'active' },
    });
    const other = cache.keyFor({ scope: 'user', scopeId: 'u-2' });

    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).toContain('user');
  });

  it('refreshes an expired entry through the loader while still fresh enough to read', async () => {
    const { cache, advance, metrics } = harness();
    const loader = jest
      .fn()
      .mockResolvedValueOnce(COUNTS)
      .mockResolvedValueOnce(UPDATED);

    await cache.getCounts({ scope: 'global' }, loader);
    advance(31_000);
    await expect(cache.getCounts({ scope: 'global' }, loader)).resolves.toEqual(UPDATED);

    expect(loader).toHaveBeenCalledTimes(2);
    expect(metrics.value('refreshed')).toBe(1);
  });

  it('serves a stale entry when the loader fails', async () => {
    const { cache, advance, metrics, logger } = harness();
    const loader = jest
      .fn()
      .mockResolvedValueOnce(COUNTS)
      .mockRejectedValueOnce(new Error('database down'));

    await cache.getCounts({ scope: 'global' }, loader);
    advance(31_000);

    await expect(cache.getCounts({ scope: 'global' }, loader)).resolves.toEqual(COUNTS);
    expect(metrics.value('stale_fallback')).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Serving stale subscription counts after loader failure',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('propagates loader failures when no cached value exists', async () => {
    const { cache, metrics } = harness();
    const loader = jest.fn().mockRejectedValue(new Error('database down'));

    await expect(cache.getCounts({ scope: 'global' }, loader)).rejects.toThrow('database down');
    expect(metrics.value('load_error')).toBe(1);
  });

  it('rejects malformed counts from a loader but can fall back to a stale value', async () => {
    const { cache, advance } = harness();
    const query = { scope: 'global' };
    const loader = jest
      .fn()
      .mockResolvedValueOnce(COUNTS)
      .mockResolvedValueOnce({ total: -1, active: 8, canceled: 3, pastDue: 1 });

    await cache.getCounts(query, loader);
    advance(31_000);
    await expect(cache.getCounts(query, loader)).resolves.toEqual(COUNTS);
  });

  it('invalidates only the counts associated with a user tag', async () => {
    const { cache, redis } = harness();
    const alice = { scope: 'user', scopeId: 'alice' };
    const bob = { scope: 'user', scopeId: 'bob' };
    const aliceLoader = jest.fn().mockResolvedValue(COUNTS);
    const bobLoader = jest.fn().mockResolvedValue(COUNTS);

    await cache.getCounts(alice, aliceLoader);
    await cache.getCounts(bob, bobLoader);
    const removed = await cache.invalidateTags([userSubscriptionCountsTag('alice')]);

    expect(removed).toBe(1);
    expect(redis.keys()).toEqual([expect.stringContaining(':user:bob:')]);
    await cache.getCounts(alice, aliceLoader);
    await cache.getCounts(bob, bobLoader);
    expect(aliceLoader).toHaveBeenCalledTimes(2);
    expect(bobLoader).toHaveBeenCalledTimes(1);
  });

  it('invalidates broad and subscription-specific tags after a change', async () => {
    const { cache } = harness();
    const loader = jest.fn().mockResolvedValue(COUNTS);
    await cache.getCounts({ scope: 'user', scopeId: 'u-1' }, loader, [subscriptionCountTag('sub-9')]);

    const removed = await cache.invalidateSubscription('sub-9', 'u-1');

    expect(removed).toBeGreaterThanOrEqual(1);
    await cache.getCounts({ scope: 'user', scopeId: 'u-1' }, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('clears every count through invalidateAll', async () => {
    const { cache, redis } = harness();
    const loader = jest.fn().mockResolvedValue(COUNTS);
    await cache.getCounts({ scope: 'user', scopeId: 'a' }, loader);
    await cache.getCounts({ scope: 'user', scopeId: 'b' }, loader);

    await cache.invalidateAll();

    expect(redis.keys()).toHaveLength(0);
  });

  it('degrades to the loader when Redis reads and writes fail', async () => {
    const { cache, redis, metrics } = harness();
    redis.failReads = true;
    redis.failWrites = true;

    await expect(cache.getCounts({ scope: 'global' }, async () => COUNTS)).resolves.toEqual(COUNTS);
    expect(metrics.value('read_error')).toBe(1);
    expect(metrics.value('write_error')).toBe(1);
  });

  it('still returns counts when tag registration fails', async () => {
    const { cache, redis, metrics } = harness();
    redis.failTags = true;

    await expect(cache.getCounts({ scope: 'global' }, async () => COUNTS)).resolves.toEqual(COUNTS);
    expect(metrics.value('tag_error')).toBeGreaterThan(0);
  });

  it('does not propagate tag invalidation failures', async () => {
    const { cache, redis, metrics } = harness();
    redis.failInvalidation = true;

    await expect(cache.invalidateTags([SUBSCRIPTIONS_TAG])).resolves.toBe(0);
    expect(metrics.value('invalidation_error')).toBe(1);
  });

  it('shares one loader call between concurrent readers', async () => {
    const { cache } = harness();
    let resolveLoader!: (value: SubscriptionCounts) => void;
    let notifyLoaderCalled!: () => void;
    const loaderCalled = new Promise<void>((resolve) => {
      notifyLoaderCalled = resolve;
    });
    const loader = jest.fn(() => {
      notifyLoaderCalled();
      return new Promise<SubscriptionCounts>((resolve) => {
        resolveLoader = resolve;
      });
    });

    const first = cache.getCounts({ scope: 'global' }, loader);
    const second = cache.getCounts({ scope: 'global' }, loader);
    await loaderCalled;
    resolveLoader(COUNTS);

    await expect(Promise.all([first, second])).resolves.toEqual([COUNTS, COUNTS]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('treats malformed cached JSON as a miss', async () => {
    const { cache, redis, metrics } = harness();
    const key = cache.keyFor({ scope: 'global' });
    redis.seedRaw(key, 'not-json');
    const loader = jest.fn().mockResolvedValue(COUNTS);

    await expect(cache.getCounts({ scope: 'global' }, loader)).resolves.toEqual(COUNTS);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(metrics.value('malformed')).toBe(1);
  });

  it('stops serving stale data once the physical Redis TTL has elapsed', async () => {
    const { cache, advance } = harness();
    const loader = jest
      .fn()
      .mockResolvedValueOnce(COUNTS)
      .mockRejectedValueOnce(new Error('database down'));

    await cache.getCounts({ scope: 'global' }, loader);
    advance(91_000); // 30s freshness + 60s stale grace + 1s

    await expect(cache.getCounts({ scope: 'global' }, loader)).rejects.toThrow('database down');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('reads a single count field from the shared cache entry', async () => {
    const { cache } = harness();
    const loader = jest.fn().mockResolvedValue(COUNTS);

    await expect(cache.getCount({ scope: 'global' }, 'active', loader)).resolves.toBe(8);
    await expect(cache.getCount({ scope: 'global' }, 'pastDue', loader)).resolves.toBe(1);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('emits a structured invalidation metric with the tag and key count', async () => {
    const { cache, metrics } = harness();
    await cache.getCounts({ scope: 'user', scopeId: 'u-1' }, async () => COUNTS);

    await cache.invalidateTags([SUBSCRIPTION_COUNTS_TAG]);

    expect(metrics.value('invalidated')).toBe(1);
    expect(metrics.counters.has('subtrackr.counts.invalidated')).toBe(true);
  });
});
