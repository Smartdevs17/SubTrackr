import {
  SubscriptionCacheService,
  type RedisClient,
  type SubscriptionCacheConfig,
} from '../../subscriptionCacheService';
import type { Subscription } from '../../../../src/types/subscription';
import { SubscriptionCategory, BillingCycle } from '../../../../src/types/subscription';

// ── Test doubles ──────────────────────────────────────────────────────────────

/**
 * In-memory Redis double.
 * Tracks all calls so tests can assert on interaction counts.
 */
class FakeRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();
  public setCalls = 0;
  public delCalls = 0;
  public getCalls = 0;
  public pingResponds = true;

  async get(key: string): Promise<string | null> {
    this.getCalls++;
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode: 'EX', ttlSeconds: number): Promise<'OK'> {
    this.setCalls++;
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    this.delCalls++;
    let count = 0;
    for (const k of keys) {
      if (this.store.delete(k)) count++;
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    // Support simple prefix glob: 'prefix:*'
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  async ping(): Promise<string> {
    if (!this.pingResponds) throw new Error('Redis unavailable');
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  /** Helper: peek at stored value without going through the cache service. */
  peek(key: string): string | null {
    return this.store.get(key)?.value ?? null;
  }

  /** Helper: seed a value directly. */
  seed(key: string, value: string, ttlSeconds = 3600): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/** Redis double that throws on every operation. */
class BrokenRedis implements RedisClient {
  async get(): Promise<string | null> { throw new Error('Redis down'); }
  async set(): Promise<never> { throw new Error('Redis down'); }
  async del(): Promise<never> { throw new Error('Redis down'); }
  async keys(): Promise<never> { throw new Error('Redis down'); }
  async ping(): Promise<never> { throw new Error('Redis down'); }
  async quit(): Promise<never> { throw new Error('Redis down'); }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeSub = (id: string, overrides: Partial<Subscription> = {}): Subscription => ({
  id,
  name: `Sub ${id}`,
  category: SubscriptionCategory.SOFTWARE,
  price: 9.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2025-01-01'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const SUB_A = makeSub('sub-a');
const SUB_B = makeSub('sub-b');
const USER_ID = 'user-1';

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('SubscriptionCacheService', () => {
  let redis: FakeRedis;
  let svc: SubscriptionCacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    svc = new SubscriptionCacheService(redis);
  });

  // ── getById: cache miss ────────────────────────────────────────────────────

  describe('getById', () => {
    it('returns null from db on cache miss when db has no entry', async () => {
      const result = await svc.getById('sub-z', async () => null);
      expect(result).toBeNull();
    });

    it('calls dbFetch on cache miss and returns the result', async () => {
      const dbFetch = jest.fn().mockResolvedValue(SUB_A);
      const result = await svc.getById('sub-a', dbFetch);
      expect(dbFetch).toHaveBeenCalledWith('sub-a');
      expect(result).toEqual(SUB_A);
    });

    it('writes db result through to Redis after a miss', async () => {
      await svc.getById('sub-a', async () => SUB_A);
      expect(redis.setCalls).toBe(1);
      expect(redis.peek('subtrackr:sub:id:sub-a')).not.toBeNull();
    });

    it('returns cached value on subsequent read without calling db', async () => {
      const dbFetch = jest.fn().mockResolvedValue(SUB_A);

      await svc.getById('sub-a', dbFetch);   // miss → writes cache
      const second = await svc.getById('sub-a', dbFetch); // hit

      expect(dbFetch).toHaveBeenCalledTimes(1);
      expect(second).toEqual(SUB_A);
    });

    it('does not write to Redis when db returns null', async () => {
      await svc.getById('missing', async () => null);
      expect(redis.setCalls).toBe(0);
    });
  });

  // ── getByUserId ────────────────────────────────────────────────────────────

  describe('getByUserId', () => {
    it('fetches from db on miss and caches the list', async () => {
      const dbFetch = jest.fn().mockResolvedValue([SUB_A, SUB_B]);
      const result = await svc.getByUserId(USER_ID, dbFetch);

      expect(result).toEqual([SUB_A, SUB_B]);
      expect(dbFetch).toHaveBeenCalledTimes(1);
      expect(redis.peek(`subtrackr:sub:user:${USER_ID}`)).not.toBeNull();
    });

    it('serves list from cache on second call', async () => {
      const dbFetch = jest.fn().mockResolvedValue([SUB_A]);
      await svc.getByUserId(USER_ID, dbFetch);
      await svc.getByUserId(USER_ID, dbFetch);
      expect(dbFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── getAll ─────────────────────────────────────────────────────────────────

  describe('getAll', () => {
    it('fetches from db on miss and caches the global list', async () => {
      const dbFetch = jest.fn().mockResolvedValue([SUB_A, SUB_B]);
      const result = await svc.getAll(dbFetch);
      expect(result).toHaveLength(2);
      expect(redis.peek('subtrackr:sub:all')).not.toBeNull();
    });

    it('serves from cache on second call', async () => {
      const dbFetch = jest.fn().mockResolvedValue([SUB_A]);
      await svc.getAll(dbFetch);
      await svc.getAll(dbFetch);
      expect(dbFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── write-through: writeThrough ────────────────────────────────────────────

  describe('writeThrough', () => {
    it('calls dbWrite first, then updates cache', async () => {
      const log: string[] = [];
      const dbWrite = jest.fn().mockImplementation(async (sub: Subscription) => {
        log.push('db');
        return sub;
      });

      // Spy on redis.set to detect ordering
      const originalSet = redis.set.bind(redis);
      redis.set = jest.fn().mockImplementation((...args) => {
        log.push('redis');
        return originalSet(...args);
      });

      await svc.writeThrough(SUB_A, USER_ID, dbWrite);

      expect(log[0]).toBe('db');
      expect(log).toContain('redis');
    });

    it('stores the persisted (db-returned) value, not the input value', async () => {
      const persisted = { ...SUB_A, name: 'Updated by DB' };
      await svc.writeThrough(SUB_A, USER_ID, async () => persisted);

      const cached = redis.peek('subtrackr:sub:id:sub-a');
      expect(JSON.parse(cached!).name).toBe('Updated by DB');
    });

    it('invalidates user list and global list after write', async () => {
      // Pre-seed list caches
      redis.seed(`subtrackr:sub:user:${USER_ID}`, JSON.stringify([SUB_A]));
      redis.seed('subtrackr:sub:all', JSON.stringify([SUB_A]));

      await svc.writeThrough(SUB_A, USER_ID, async (s) => s);

      expect(redis.peek(`subtrackr:sub:user:${USER_ID}`)).toBeNull();
      expect(redis.peek('subtrackr:sub:all')).toBeNull();
    });

    it('returns the persisted subscription', async () => {
      const persisted = { ...SUB_A, price: 19.99 };
      const result = await svc.writeThrough(SUB_A, USER_ID, async () => persisted);
      expect(result.price).toBe(19.99);
    });
  });

  // ── write-through: writeDelete ─────────────────────────────────────────────

  describe('writeDelete', () => {
    it('calls dbDelete then evicts all related keys', async () => {
      redis.seed('subtrackr:sub:id:sub-a', JSON.stringify(SUB_A));
      redis.seed(`subtrackr:sub:user:${USER_ID}`, JSON.stringify([SUB_A]));
      redis.seed('subtrackr:sub:all', JSON.stringify([SUB_A]));

      const dbDelete = jest.fn().mockResolvedValue(undefined);
      await svc.writeDelete('sub-a', USER_ID, dbDelete);

      expect(dbDelete).toHaveBeenCalledWith('sub-a');
      expect(redis.peek('subtrackr:sub:id:sub-a')).toBeNull();
    });
  });

  // ── Invalidation ───────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('removes individual, user-list, and global keys', async () => {
      redis.seed('subtrackr:sub:id:sub-a', JSON.stringify(SUB_A));
      redis.seed(`subtrackr:sub:user:${USER_ID}`, JSON.stringify([SUB_A]));
      redis.seed('subtrackr:sub:all', JSON.stringify([SUB_A]));

      await svc.invalidate('sub-a', USER_ID);

      expect(redis.peek('subtrackr:sub:id:sub-a')).toBeNull();
      expect(redis.peek(`subtrackr:sub:user:${USER_ID}`)).toBeNull();
      expect(redis.peek('subtrackr:sub:all')).toBeNull();
    });
  });

  describe('invalidateAll', () => {
    it('removes every key under the prefix', async () => {
      redis.seed('subtrackr:sub:id:sub-a', JSON.stringify(SUB_A));
      redis.seed('subtrackr:sub:id:sub-b', JSON.stringify(SUB_B));
      redis.seed('subtrackr:sub:all', JSON.stringify([SUB_A, SUB_B]));

      await svc.invalidateAll();

      expect(redis.peek('subtrackr:sub:id:sub-a')).toBeNull();
      expect(redis.peek('subtrackr:sub:id:sub-b')).toBeNull();
      expect(redis.peek('subtrackr:sub:all')).toBeNull();
    });
  });

  // ── Cache warming ──────────────────────────────────────────────────────────

  describe('warmUp', () => {
    it('writes individual entries, per-user lists, and global list', async () => {
      const subs = [
        makeSub('sub-1'),
        makeSub('sub-2'),
        makeSub('sub-3'),
      ];

      const getUserId = (_sub: Subscription) => USER_ID;

      await svc.warmUp(async () => subs, getUserId);

      expect(redis.peek('subtrackr:sub:id:sub-1')).not.toBeNull();
      expect(redis.peek('subtrackr:sub:id:sub-2')).not.toBeNull();
      expect(redis.peek('subtrackr:sub:id:sub-3')).not.toBeNull();
      expect(redis.peek(`subtrackr:sub:user:${USER_ID}`)).not.toBeNull();
      expect(redis.peek('subtrackr:sub:all')).not.toBeNull();
    });

    it('groups subscriptions by userId into separate user-list keys', async () => {
      const subs = [
        makeSub('sub-1'),  // user-A
        makeSub('sub-2'),  // user-B
      ];
      const getUserId = (sub: Subscription) =>
        sub.id === 'sub-1' ? 'user-A' : 'user-B';

      await svc.warmUp(async () => subs, getUserId);

      const listA = JSON.parse(redis.peek('subtrackr:sub:user:user-A')!) as Subscription[];
      const listB = JSON.parse(redis.peek('subtrackr:sub:user:user-B')!) as Subscription[];
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
    });

    it('returns { warmed: 0, errors: 1 } when Redis ping fails', async () => {
      const broken = new BrokenRedis();
      const svc2 = new SubscriptionCacheService(broken);
      const result = await svc2.warmUp(async () => [SUB_A], () => USER_ID);
      expect(result.errors).toBeGreaterThan(0);
      expect(result.warmed).toBe(0);
    });

    it('returns { warmed: 0, errors: 1 } when dbFetchAll throws', async () => {
      const result = await svc.warmUp(
        async () => { throw new Error('db down'); },
        () => USER_ID,
      );
      expect(result.errors).toBe(1);
      expect(result.warmed).toBe(0);
    });
  });

  // ── Fallback on Redis failure ──────────────────────────────────────────────

  describe('fallback on Redis failure', () => {
    it('falls through to dbFetch when Redis.get throws', async () => {
      const broken = new BrokenRedis();
      const svc2 = new SubscriptionCacheService(broken);
      const dbFetch = jest.fn().mockResolvedValue(SUB_A);

      const result = await svc2.getById('sub-a', dbFetch);
      expect(dbFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(SUB_A);
    });

    it('does not throw on getByUserId when Redis is broken', async () => {
      const broken = new BrokenRedis();
      const svc2 = new SubscriptionCacheService(broken);
      await expect(
        svc2.getByUserId(USER_ID, async () => [SUB_A]),
      ).resolves.toEqual([SUB_A]);
    });

    it('does not throw on invalidate when Redis is broken', async () => {
      const broken = new BrokenRedis();
      const svc2 = new SubscriptionCacheService(broken);
      await expect(svc2.invalidate('sub-a', USER_ID)).resolves.not.toThrow();
    });

    it('increments error counter on Redis failures', async () => {
      const broken = new BrokenRedis();
      const svc2 = new SubscriptionCacheService(broken);

      await svc2.getById('sub-a', async () => SUB_A);
      const metrics = svc2.getMetrics();
      expect(metrics.errors).toBeGreaterThan(0);
    });
  });

  // ── Hit-ratio monitoring ───────────────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns NaN hitRatio with no reads', () => {
      const { hitRatio } = svc.getMetrics();
      expect(hitRatio).toBeNaN();
    });

    it('tracks hits and misses', async () => {
      const dbFetch = jest.fn().mockResolvedValue(SUB_A);

      await svc.getById('sub-a', dbFetch); // miss
      await svc.getById('sub-a', dbFetch); // hit

      const { hits, misses } = svc.getMetrics();
      expect(hits).toBe(1);
      expect(misses).toBe(1);
    });

    it('computes hitRatio correctly', async () => {
      const dbFetch = jest.fn().mockResolvedValue(SUB_A);
      // 1 miss, then 4 hits → ratio = 4/5 = 0.8
      await svc.getById('sub-a', dbFetch);
      for (let i = 0; i < 4; i++) {
        await svc.getById('sub-a', dbFetch);
      }
      const { hitRatio } = svc.getMetrics();
      expect(hitRatio).toBeCloseTo(0.8);
    });

    it('hitRatio exceeds 0.85 target after warm cache', async () => {
      const dbFetch = jest.fn().mockResolvedValue(SUB_A);
      // 1 cold miss, then 9 hits → 0.9 > 0.85
      await svc.getById('sub-a', dbFetch);
      for (let i = 0; i < 9; i++) {
        await svc.getById('sub-a', dbFetch);
      }
      expect(svc.getMetrics().hitRatio).toBeGreaterThan(0.85);
    });

    it('tracks write count', async () => {
      await svc.getById('sub-a', async () => SUB_A); // 1 write (individual entry)
      expect(svc.getMetrics().writes).toBe(1);
    });

    it('tracks invalidation count', async () => {
      await svc.invalidate('sub-a', USER_ID); // 3 keys deleted at once
      expect(svc.getMetrics().invalidations).toBe(3);
    });

    it('resets all counters without clearing the store', async () => {
      await svc.getById('sub-a', async () => SUB_A);
      svc.resetMetrics();

      const m = svc.getMetrics();
      expect(m.hits).toBe(0);
      expect(m.misses).toBe(0);
      expect(m.writes).toBe(0);
      expect(m.invalidations).toBe(0);
      expect(m.errors).toBe(0);

      // Cache entry itself should still be present
      await svc.getById('sub-a', jest.fn()); // should be a hit, db not called
      expect(svc.getMetrics().hits).toBe(1);
    });
  });

  // ── isHealthy ─────────────────────────────────────────────────────────────

  describe('isHealthy', () => {
    it('returns true when Redis responds PONG', async () => {
      expect(await svc.isHealthy()).toBe(true);
    });

    it('returns false when Redis ping throws', async () => {
      redis.pingResponds = false;
      expect(await svc.isHealthy()).toBe(false);
    });
  });

  // ── Custom config ─────────────────────────────────────────────────────────

  describe('custom config', () => {
    it('uses a custom key prefix', async () => {
      const svc2 = new SubscriptionCacheService(redis, { keyPrefix: 'myapp:subs:' });
      await svc2.getById('sub-a', async () => SUB_A);
      expect(redis.peek('myapp:subs:id:sub-a')).not.toBeNull();
    });

    it('does not collide when two instances use different prefixes', async () => {
      const svc1 = new SubscriptionCacheService(redis, { keyPrefix: 'app1:' });
      const svc2 = new SubscriptionCacheService(redis, { keyPrefix: 'app2:' });

      await svc1.getById('sub-a', async () => SUB_A);
      await svc2.invalidateAll();

      // svc1's key should still be present after svc2 cleared its own namespace
      expect(redis.peek('app1:id:sub-a')).not.toBeNull();
    });
  });
});