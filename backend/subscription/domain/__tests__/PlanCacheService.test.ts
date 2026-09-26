import { RedisCacheService, type RedisClient } from '../../../shared/cache/RedisCacheService';
import { PlanCacheService } from '../PlanCacheService';
import { InMemoryPlanRepository } from '../PlanRepository';
import type { PlanMetadata } from '../types';

class FakeRedis implements RedisClient {
  private store = new Map<string, string>();
  public available = true;
  public getCalls = 0;

  async get(key: string): Promise<string | null> {
    this.getCalls++;
    if (!this.available) throw new Error('Redis down');
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _mode: 'EX', _ttl: number): Promise<'OK'> {
    if (!this.available) throw new Error('Redis down');
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (!this.available) throw new Error('Redis down');
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
    if (!this.available) throw new Error('Redis down');
    return 'PONG';
  }

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

const makePlan = (overrides: Partial<PlanMetadata> = {}): PlanMetadata => ({
  id: 'plan-basic',
  name: 'Basic',
  price: 9.99,
  currency: 'USD',
  billingCycle: 'monthly',
  features: ['feature-a'],
  limits: { maxSubscriptions: 10 },
  isActive: true,
  metadata: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('PlanCacheService', () => {
  let redis: FakeRedis;
  let repository: InMemoryPlanRepository;
  let svc: PlanCacheService;
  let dbReads: number;

  beforeEach(() => {
    InMemoryPlanRepository.resetIdCounter();
    redis = new FakeRedis();
    const seed = makePlan();
    repository = new InMemoryPlanRepository([seed]);
    dbReads = 0;
    const trackedRepo = {
      findById: async (id: string) => {
        dbReads++;
        return repository.findById(id);
      },
      findAllActive: () => repository.findAllActive(),
      create: (input: Parameters<typeof repository.create>[0]) => repository.create(input),
      update: (id: string, input: Parameters<typeof repository.update>[1]) =>
        repository.update(id, input),
      deactivate: (id: string) => repository.deactivate(id),
    };
    svc = new PlanCacheService(redis, trackedRepo, { defaultTtlSeconds: 3600 });
  });

  it('getPlan loads from DB on cache miss and caches result', async () => {
    const plan = await svc.getPlan('plan-basic');
    expect(plan?.name).toBe('Basic');
    expect(dbReads).toBe(1);

    dbReads = 0;
    const cached = await svc.getPlan('plan-basic');
    expect(cached?.name).toBe('Basic');
    expect(dbReads).toBe(0);
    expect(svc.getMetrics().hits).toBeGreaterThan(0);
  });

  it('getPlan uses single-flight for concurrent misses', async () => {
    let concurrentReads = 0;
    const slowRepo = {
      findById: async (id: string) => {
        concurrentReads++;
        await new Promise((r) => setTimeout(r, 30));
        return repository.findById(id);
      },
      findAllActive: () => repository.findAllActive(),
      create: (input: Parameters<typeof repository.create>[0]) => repository.create(input),
      update: (id: string, input: Parameters<typeof repository.update>[1]) =>
        repository.update(id, input),
      deactivate: (id: string) => repository.deactivate(id),
    };

    const svc2 = new PlanCacheService(redis, slowRepo, { defaultTtlSeconds: 3600 });
    await Promise.all([
      svc2.getPlan('plan-basic'),
      svc2.getPlan('plan-basic'),
      svc2.getPlan('plan-basic'),
    ]);

    expect(concurrentReads).toBe(1);
  });

  it('setPlan and invalidatePlan work correctly', async () => {
    const plan = makePlan({ id: 'plan-pro', name: 'Pro' });
    await svc.setPlan(plan);
    await svc.invalidatePlan('plan-pro');

    const key = 'subtrackr:plan:id:plan-pro';
    expect(await redis.get(key)).toBeNull();
  });

  it('invalidateAll clears all plan keys', async () => {
    await svc.setPlan(makePlan({ id: 'p1' }));
    await svc.setPlan(makePlan({ id: 'p2' }));
    await svc.invalidateAll();
    expect(await redis.get('subtrackr:plan:id:p1')).toBeNull();
    expect(await redis.get('subtrackr:plan:id:p2')).toBeNull();
  });

  it('writeThroughUpdate persists to DB and refreshes cache', async () => {
    const updated = await svc.writeThroughUpdate('plan-basic', { price: 19.99 });
    expect(updated?.price).toBe(19.99);

    const fromDb = await repository.findById('plan-basic');
    expect(fromDb?.price).toBe(19.99);

    const cached = await svc.getPlan('plan-basic');
    expect(cached?.price).toBe(19.99);
  });

  it('writeThroughDeactivate removes plan from active cache', async () => {
    await svc.getPlan('plan-basic');
    await svc.writeThroughDeactivate('plan-basic');

    const fromDb = await repository.findById('plan-basic');
    expect(fromDb?.isActive).toBe(false);
  });

  it('uses per-plan cacheTTL from metadata when set', async () => {
    const plan = makePlan({ metadata: { cacheTTL: 120 } });
    const setSpy = jest.spyOn(RedisCacheService.prototype, 'set');
    await svc.setPlan(plan);
    expect(setSpy).toHaveBeenCalledWith('id:plan-basic', expect.any(String), 120);
    setSpy.mockRestore();
  });

  it('warmActivePlans pre-loads active plans', async () => {
    await repository.create({
      name: 'Enterprise',
      price: 99,
      currency: 'USD',
      billingCycle: 'yearly',
    });

    const result = await svc.warmActivePlans();
    expect(result.warmed).toBeGreaterThanOrEqual(2);
    expect(result.errors).toBe(0);
  });

  it('falls back to DB when Redis is unavailable', async () => {
    redis.available = false;
    const plan = await svc.getPlan('plan-basic');
    expect(plan?.id).toBe('plan-basic');
  });

  it('exports Prometheus metrics', () => {
    const output = svc.prometheusMetrics();
    expect(output).toContain('subtrackr_plan_cache_hits_total');
    expect(output).toContain('subtrackr_plan_cache_latency_ms');
  });

  it('returns null for unknown plan', async () => {
    expect(await svc.getPlan('does-not-exist')).toBeNull();
  });

  it('does not cache inactive plans on read', async () => {
    const inactive = makePlan({ id: 'inactive-1', isActive: false });
    const repo = new InMemoryPlanRepository([inactive]);
    const localRedis = new FakeRedis();
    const localSvc = new PlanCacheService(localRedis, repo);

    const plan = await localSvc.getPlan('inactive-1');
    expect(plan?.isActive).toBe(false);
    expect(localRedis.getCalls).toBe(1);
    expect(await localRedis.get('subtrackr:plan:id:inactive-1')).toBeNull();
  });

  it('getActivePlans caches the active plan list', async () => {
    const first = await svc.getActivePlans();
    expect(first.length).toBeGreaterThanOrEqual(1);

    const findAllSpy = jest.spyOn(repository, 'findAllActive');
    const second = await svc.getActivePlans();
    expect(second.length).toBe(first.length);
    expect(findAllSpy).not.toHaveBeenCalled();
    findAllSpy.mockRestore();
  });

  it('warmActivePlans records errors when Redis set fails', async () => {
    await svc.isHealthy();
    redis.available = false;
    const result = await svc.warmActivePlans();
    expect(result.warmed).toBe(0);
    expect(result.errors).toBeGreaterThan(0);
  });
});
