import { createPlanController } from '../planController';
import { PlanCacheService } from '../../domain/PlanCacheService';
import { InMemoryPlanRepository } from '../../domain/PlanRepository';
import type { RedisClient } from '../../../shared/cache/types';
import type { PlanMetadata } from '../../domain/types';

class FakeRedis implements RedisClient {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number): Promise<'OK'> {
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
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

const seedPlan: PlanMetadata = {
  id: 'plan-1',
  name: 'Starter',
  price: 5,
  currency: 'USD',
  billingCycle: 'monthly',
  features: [],
  limits: {},
  isActive: true,
  metadata: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('planController', () => {
  let controller: ReturnType<typeof createPlanController>;
  let planCache: PlanCacheService;

  beforeEach(() => {
    InMemoryPlanRepository.resetIdCounter();
    const repo = new InMemoryPlanRepository([seedPlan]);
    planCache = new PlanCacheService(new FakeRedis(), repo);
    controller = createPlanController({ planCache });
  });

  it('getPlan returns active plan', async () => {
    const res = await controller.getPlan('plan-1');
    expect(res.success).toBe(true);
    expect((res as { data: PlanMetadata }).data.name).toBe('Starter');
  });

  it('getPlan returns 404 for missing plan', async () => {
    const res = await controller.getPlan('missing');
    expect(res.success).toBe(false);
    expect(res.status).toBe(404);
  });

  it('createPlan writes through to cache', async () => {
    const res = await controller.createPlan({
      name: 'Growth',
      price: 25,
      currency: 'USD',
      billingCycle: 'monthly',
    });
    expect(res.success).toBe(true);
    const created = (res as { data: PlanMetadata }).data;
    const cached = await planCache.getPlan(created.id);
    expect(cached?.name).toBe('Growth');
  });

  it('updatePlan invalidates stale cache via write-through', async () => {
    await planCache.getPlan('plan-1');
    const res = await controller.updatePlan('plan-1', { price: 7.5 });
    expect(res.success).toBe(true);
    const cached = await planCache.getPlan('plan-1');
    expect(cached?.price).toBe(7.5);
  });

  it('deactivatePlan marks plan inactive and invalidates cache', async () => {
    await planCache.getPlan('plan-1');
    const res = await controller.deactivatePlan('plan-1');
    expect(res.success).toBe(true);

    const inactiveRes = await controller.getPlan('plan-1');
    expect(inactiveRes.success).toBe(false);
    expect(inactiveRes.status).toBe(409);
  });

  it('rejects invalid create body', async () => {
    const res = await controller.createPlan({
      name: '',
      price: -1,
      currency: '',
      billingCycle: '',
    });
    expect(res.success).toBe(false);
  });
});
