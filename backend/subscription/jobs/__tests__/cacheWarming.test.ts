import { runPlanCacheWarming } from '../cacheWarming';
import { PlanCacheService } from '../../domain/PlanCacheService';
import { InMemoryPlanRepository } from '../../domain/PlanRepository';
import type { RedisClient } from '../../../shared/cache/types';
import type { PlanMetadata } from '../../domain/types';

class FakeRedis implements RedisClient {
  public healthy = true;
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    if (!this.healthy) throw new Error('down');
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number): Promise<'OK'> {
    if (!this.healthy) throw new Error('down');
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, '');
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }

  async ping(): Promise<string> {
    if (!this.healthy) throw new Error('down');
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

const activePlan: PlanMetadata = {
  id: 'plan-a',
  name: 'A',
  price: 1,
  currency: 'USD',
  billingCycle: 'monthly',
  features: [],
  limits: {},
  isActive: true,
  metadata: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('cacheWarming job', () => {
  it('warms active plans on deploy', async () => {
    const redis = new FakeRedis();
    const repo = new InMemoryPlanRepository([activePlan]);
    const planCache = new PlanCacheService(redis, repo);

    const result = await runPlanCacheWarming(planCache);
    expect(result.skipped).toBe(false);
    expect(result.warmed).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skips warming when Redis is unhealthy', async () => {
    const redis = new FakeRedis();
    redis.healthy = false;
    const repo = new InMemoryPlanRepository([activePlan]);
    const planCache = new PlanCacheService(redis, repo);

    const result = await runPlanCacheWarming(planCache);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('Redis unavailable');
    expect(result.warmed).toBe(0);
  });

  it('invokes onComplete callback', async () => {
    const redis = new FakeRedis();
    const repo = new InMemoryPlanRepository([activePlan]);
    const planCache = new PlanCacheService(redis, repo);
    const onComplete = jest.fn();

    await runPlanCacheWarming(planCache, { onComplete });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ warmed: 1, skipped: false }),
    );
  });
});
