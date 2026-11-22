/**
 * Tests for IntelligentCacheService — intelligentCache.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  IntelligentCacheService,
  createIntelligentCache,
  TIER_TTL,
  SUBSCRIPTION_INVALIDATION_RULES,
  type CacheSetOptions,
} from '../intelligentCache';
import type { RedisClient } from '../../../shared/cache/types';

// ── Mock Redis client ─────────────────────────────────────────────────────────

function makeRedis(overrides: Partial<RedisClient> = {}): jest.Mocked<RedisClient> {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    del: jest.fn(async (...keys: string[]) => { keys.forEach((k) => store.delete(k)); return keys.length; }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return [...store.keys()].filter((k) => k.startsWith(prefix));
    }),
    ping: jest.fn(async () => 'PONG'),
    quit: jest.fn(async () => 'OK'),
    ...overrides,
  } as jest.Mocked<RedisClient>;
}

// ── getOrLoad ─────────────────────────────────────────────────────────────────

describe('IntelligentCacheService.getOrLoad()', () => {
  it('calls loader on cache miss and caches result', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);
    const loader = jest.fn(async () => ({ id: 1 }));

    const result = await cache.getOrLoad('key1', loader);

    expect(result).toEqual({ id: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled();
  });

  it('returns cached value on second call without invoking loader', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);
    const loader = jest.fn(async () => 42);

    await cache.getOrLoad('key1', loader);
    const second = await cache.getOrLoad('key1', loader);

    expect(second).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('uses correct TTL for tier', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);
    const loader = jest.fn(async () => 'value');

    await cache.getOrLoad('key1', loader, { tier: 'cold' });

    const setCall = redis.set.mock.calls.find((c) => c[0].includes('key1'));
    expect(setCall).toBeDefined();
    expect(setCall![3]).toBe(TIER_TTL.cold);
  });

  it('degrades gracefully when Redis get throws', async () => {
    const redis = makeRedis({ get: jest.fn(async () => { throw new Error('Redis down'); }) });
    const cache = createIntelligentCache(redis);
    const loader = jest.fn(async () => 'fallback');

    const result = await cache.getOrLoad('key1', loader);
    expect(result).toBe('fallback');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent misses into a single loader call (single-flight)', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);
    let loaderCalls = 0;
    const loader = jest.fn(async () => {
      loaderCalls++;
      await new Promise((r) => setTimeout(r, 10));
      return 'shared';
    });

    const [a, b, c] = await Promise.all([
      cache.getOrLoad('key-sf', loader),
      cache.getOrLoad('key-sf', loader),
      cache.getOrLoad('key-sf', loader),
    ]);

    expect(a).toBe('shared');
    expect(b).toBe('shared');
    expect(c).toBe('shared');
    expect(loaderCalls).toBe(1);
  });
});

// ── set() ─────────────────────────────────────────────────────────────────────

describe('IntelligentCacheService.set()', () => {
  it('stores JSON-serialised entry with TTL', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.set('mykey', { foo: 'bar' }, { ttlSeconds: 120 });

    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('mykey'),
      expect.stringContaining('"foo"'),
      'EX',
      120,
    );
  });

  it('indexes tags when provided', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.set('sub:1', { id: 1 }, { tags: ['subscription:1', 'user:u1:subscriptions'] });

    // Tag index keys should have been written
    const setCalls = redis.set.mock.calls.map((c) => c[0] as string);
    const tagCalls = setCalls.filter((k) => k.includes('__tag__'));
    expect(tagCalls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── invalidate() ──────────────────────────────────────────────────────────────

describe('IntelligentCacheService.invalidate()', () => {
  it('deletes the key from Redis', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.set('k', 'v');
    await cache.invalidate('k');

    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('k'));
  });
});

// ── invalidateByTag() ────────────────────────────────────────────────────────

describe('IntelligentCacheService.invalidateByTag()', () => {
  it('invalidates all keys registered under a tag', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.set('sub:1:details', { id: 1 }, { tags: ['subscription:1'] });
    await cache.set('sub:1:analytics', { total: 5 }, { tags: ['subscription:1'] });

    const count = await cache.invalidateByTag('subscription:1');
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 when no keys are tagged', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    const count = await cache.invalidateByTag('nonexistent-tag');
    expect(count).toBe(0);
  });
});

describe('IntelligentCacheService.invalidateByTags()', () => {
  it('invalidates keys across multiple tags', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.set('a', 1, { tags: ['tag-a'] });
    await cache.set('b', 2, { tags: ['tag-b'] });

    const count = await cache.invalidateByTags(['tag-a', 'tag-b']);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ── Circuit breaker ───────────────────────────────────────────────────────────

describe('circuit breaker', () => {
  it('opens after threshold consecutive failures and bypasses Redis', async () => {
    let callCount = 0;
    const redis = makeRedis({
      get: jest.fn(async () => { callCount++; throw new Error('Redis down'); }),
      set: jest.fn(async () => { throw new Error('Redis down'); }),
    });

    const cache = createIntelligentCache(redis, {
      circuitBreakerThreshold: 3,
      circuitBreakerResetMs: 60_000,
    });

    const loader = jest.fn(async () => 'value');

    // Trigger 3 failures to open the circuit
    for (let i = 0; i < 3; i++) {
      await cache.getOrLoad(`key-${i}`, loader);
    }

    const beforeCount = callCount;
    // Next call should bypass Redis entirely (circuit open)
    await cache.getOrLoad('key-after', loader);
    expect(callCount).toBe(beforeCount); // Redis not called again
  });

  it('reports circuitOpenEvents in metrics', async () => {
    const redis = makeRedis({
      get: jest.fn(async () => { throw new Error('fail'); }),
      set: jest.fn(async () => { throw new Error('fail'); }),
    });

    const cache = createIntelligentCache(redis, { circuitBreakerThreshold: 2 });
    const loader = jest.fn(async () => 'ok');

    for (let i = 0; i < 3; i++) {
      await cache.getOrLoad(`k${i}`, loader);
    }

    const m = cache.getMetrics();
    expect(m.circuitOpenEvents).toBeGreaterThanOrEqual(1);
    expect(m.errors).toBeGreaterThanOrEqual(2);
  });
});

// ── Metrics ───────────────────────────────────────────────────────────────────

describe('getMetrics()', () => {
  it('tracks hits, misses, and writes', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.getOrLoad('m1', async () => 'a'); // miss + write
    await cache.getOrLoad('m1', async () => 'a'); // hit
    await cache.getOrLoad('m2', async () => 'b'); // miss + write

    const m = cache.getMetrics();
    expect(m.misses).toBe(2);
    expect(m.hits).toBe(1);
    expect(m.writes).toBe(2);
    expect(m.hitRatio).toBeCloseTo(1 / 3, 1);
  });
});

// ── isHealthy() ───────────────────────────────────────────────────────────────

describe('isHealthy()', () => {
  it('returns true when Redis responds PONG', async () => {
    const cache = createIntelligentCache(makeRedis());
    expect(await cache.isHealthy()).toBe(true);
  });

  it('returns false when Redis ping throws', async () => {
    const redis = makeRedis({ ping: jest.fn(async () => { throw new Error('unreachable'); }) });
    const cache = createIntelligentCache(redis);
    expect(await cache.isHealthy()).toBe(false);
  });
});

// ── wireEventInvalidation ────────────────────────────────────────────────────

describe('wireEventInvalidation()', () => {
  it('invalidates tagged keys when a domain event fires', async () => {
    const redis = makeRedis();
    const cache = createIntelligentCache(redis);

    await cache.set('user:u1:subs', [{ id: 1 }], { tags: ['user:u1:subscriptions'] });

    const handlers = new Map<string, ((e: unknown) => Promise<void>)[]>();
    const fakeEventBus = {
      subscribe: jest.fn((eventName: string, handler: (e: unknown) => Promise<void>) => {
        if (!handlers.has(eventName)) handlers.set(eventName, []);
        handlers.get(eventName)!.push(handler);
        return { unsubscribe: jest.fn() };
      }),
    } as any;

    cache.wireEventInvalidation(fakeEventBus, SUBSCRIPTION_INVALIDATION_RULES);

    // Simulate subscription.created event
    const event = {
      name: 'subscription.created',
      payload: { userId: 'u1', subscriptionId: 'sub-new' },
    };
    const handler = handlers.get('subscription.created')?.[0];
    expect(handler).toBeDefined();
    await handler!(event);

    const m = cache.getMetrics();
    expect(m.tagInvalidations).toBeGreaterThanOrEqual(1);
  });
});

// ── SUBSCRIPTION_INVALIDATION_RULES ─────────────────────────────────────────

describe('SUBSCRIPTION_INVALIDATION_RULES', () => {
  it('subscription.created returns user subscriptions tag', () => {
    const rule = SUBSCRIPTION_INVALIDATION_RULES.find((r) => r.eventName === 'subscription.created')!;
    const tags = rule.tagsFromEvent({ name: 'subscription.created', payload: { userId: 'u42' } } as any);
    expect(tags).toContain('user:u42:subscriptions');
  });

  it('subscription.cancelled returns subscription and user tags', () => {
    const rule = SUBSCRIPTION_INVALIDATION_RULES.find((r) => r.eventName === 'subscription.cancelled')!;
    const tags = rule.tagsFromEvent({
      name: 'subscription.cancelled',
      payload: { subscriptionId: 's1', userId: 'u1' },
    } as any);
    expect(tags).toContain('subscription:s1');
    expect(tags).toContain('user:u1:subscriptions');
  });

  it('billing.payment_captured returns subscription and analytics:mrr tags', () => {
    const rule = SUBSCRIPTION_INVALIDATION_RULES.find((r) => r.eventName === 'billing.payment_captured')!;
    const tags = rule.tagsFromEvent({ name: 'billing.payment_captured', payload: { subscriptionId: 's2' } } as any);
    expect(tags).toContain('subscription:s2');
    expect(tags).toContain('analytics:mrr');
  });
});
