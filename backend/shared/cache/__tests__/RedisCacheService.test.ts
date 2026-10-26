import { RedisCacheService, type RedisClient } from '../RedisCacheService';

class FakeRedis implements RedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();
  public failReads = false;
  public failWrites = false;
  public getCalls = 0;

  async get(key: string): Promise<string | null> {
    this.getCalls++;
    if (this.failReads) throw new Error('Redis down');
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode: 'EX', ttl: number): Promise<'OK'> {
    if (this.failWrites) throw new Error('Redis down');
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (this.failWrites) throw new Error('Redis down');
    let count = 0;
    for (const k of keys) {
      if (this.store.delete(k)) count++;
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  async ping(): Promise<string> {
    if (this.failReads) throw new Error('Redis down');
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }

  seed(key: string, value: string): void {
    this.store.set(key, { value, expiresAt: Date.now() + 3_600_000 });
  }
}

describe('RedisCacheService', () => {
  let redis: FakeRedis;
  let svc: RedisCacheService;
  let degradationWarnings: string[];

  beforeEach(() => {
    redis = new FakeRedis();
    degradationWarnings = [];
    svc = new RedisCacheService(redis, {
      keyPrefix: 'test:',
      defaultTtlSeconds: 60,
      onDegradation: (msg) => degradationWarnings.push(msg),
    });
  });

  it('returns null on cache miss', async () => {
    expect(await svc.get('missing')).toBeNull();
    const metrics = svc.getMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(0);
  });

  it('stores and retrieves values', async () => {
    await svc.set('plan-1', '{"id":"plan-1"}');
    expect(await svc.get('plan-1')).toBe('{"id":"plan-1"}');
    expect(svc.getMetrics().hits).toBe(1);
  });

  it('invalidates a single key', async () => {
    await svc.set('plan-1', 'value');
    await svc.invalidate('plan-1');
    expect(await svc.get('plan-1')).toBeNull();
    expect(svc.getMetrics().invalidations).toBe(1);
  });

  it('invalidates all keys under prefix', async () => {
    await svc.set('a', '1');
    await svc.set('b', '2');
    await svc.invalidateAll();
    expect(await svc.get('a')).toBeNull();
    expect(await svc.get('b')).toBeNull();
  });

  it('getOrLoad runs loader only once on concurrent misses (single-flight)', async () => {
    let loadCount = 0;
    const loader = async () => {
      loadCount++;
      await new Promise((r) => setTimeout(r, 20));
      return 'loaded';
    };

    const results = await Promise.all([
      svc.getOrLoad('sf-key', loader),
      svc.getOrLoad('sf-key', loader),
      svc.getOrLoad('sf-key', loader),
    ]);

    expect(results).toEqual(['loaded', 'loaded', 'loaded']);
    expect(loadCount).toBe(1);
  });

  it('degrades gracefully when Redis read fails', async () => {
    redis.failReads = true;
    expect(await svc.get('x')).toBeNull();
    expect(svc.getMetrics().degradations).toBe(1);
    expect(degradationWarnings.length).toBeGreaterThan(0);
  });

  it('degrades gracefully when Redis write fails', async () => {
    redis.failWrites = true;
    expect(await svc.set('x', 'y')).toBe(false);
    expect(svc.getMetrics().degradations).toBe(1);
  });

  it('set returns true on success', async () => {
    expect(await svc.set('ok', 'value')).toBe(true);
  });

  it('decrements memory usage on invalidate', async () => {
    await svc.set('mem-key', 'hello');
    expect(svc.getMetrics().memoryUsageBytes).toBe(5);
    await svc.invalidate('mem-key');
    expect(svc.getMetrics().memoryUsageBytes).toBe(0);
  });

  it('skips Redis reads after entering degraded mode', async () => {
    redis.failReads = true;
    await svc.get('first');
    expect(svc.isDegraded()).toBe(true);

    redis.failReads = false;
    const callsBefore = redis.getCalls;
    await svc.get('second');
    expect(redis.getCalls).toBe(callsBefore);
  });

  it('exports Prometheus metrics with hit ratio and latency', async () => {
    await svc.set('p', 'v');
    await svc.get('p');
    await svc.get('missing');

    const output = svc.prometheusMetrics('test_cache');
    expect(output).toContain('test_cache_hits_total 1');
    expect(output).toContain('test_cache_misses_total 1');
    expect(output).toContain('test_cache_hit_ratio');
    expect(output).toContain('test_cache_latency_ms{quantile="0.5"}');
    expect(output).toContain('test_cache_memory_usage_bytes');
    expect(output).toContain('test_cache_degradations_total');
  });

  it('reports healthy when ping succeeds', async () => {
    expect(await svc.isHealthy()).toBe(true);
  });

  it('reports unhealthy when ping fails', async () => {
    redis.failReads = true;
    expect(await svc.isHealthy()).toBe(false);
  });

  it('resetMetrics clears counters', async () => {
    await svc.get('missing');
    svc.resetMetrics();
    expect(svc.getMetrics().misses).toBe(0);
  });
});
