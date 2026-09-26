import { bootstrapPlanCache, shutdownPlanCache } from '../bootstrap';
import { PlanCacheService } from '../domain/PlanCacheService';
import { InMemoryPlanRepository } from '../domain/PlanRepository';
import { getPlanCacheService, setPlanCacheService } from '../planCacheRegistry';
import type { RedisClient } from '../../shared/cache/types';
import type { PlanMetadata } from '../domain/types';

class FakeRedis implements RedisClient {
  async get(): Promise<string | null> {
    return null;
  }
  async set(): Promise<'OK'> {
    return 'OK';
  }
  async del(): Promise<number> {
    return 0;
  }
  async keys(): Promise<string[]> {
    return [];
  }
  async ping(): Promise<string> {
    return 'PONG';
  }
  async quit(): Promise<'OK'> {
    return 'OK';
  }
}

const seed: PlanMetadata = {
  id: 'plan-1',
  name: 'Basic',
  price: 10,
  currency: 'USD',
  billingCycle: 'monthly',
  features: [],
  limits: {},
  isActive: true,
  metadata: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('bootstrapPlanCache', () => {
  afterEach(async () => {
    setPlanCacheService(null);
  });

  it('registers PlanCacheService globally', async () => {
    const result = await bootstrapPlanCache({
      redis: new FakeRedis(),
      repository: new InMemoryPlanRepository([seed]),
      warmOnStart: false,
    });

    expect(result).not.toBeNull();
    expect(getPlanCacheService()).toBeInstanceOf(PlanCacheService);
    await shutdownPlanCache(result);
  });

  it('bootstraps even when Redis warming is skipped due to unhealthy connection', async () => {
    const brokenRedis: RedisClient = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => {
        throw new Error('down');
      },
      del: async () => {
        throw new Error('down');
      },
      keys: async () => {
        throw new Error('down');
      },
      ping: async () => {
        throw new Error('down');
      },
      quit: async () => 'OK',
    };

    const result = await bootstrapPlanCache({
      redis: brokenRedis,
      repository: new InMemoryPlanRepository([seed]),
      warmOnStart: true,
    });

    expect(result).not.toBeNull();
    expect(getPlanCacheService()).not.toBeNull();
    await shutdownPlanCache(result);
  });
});
