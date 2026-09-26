/**
 * Bootstrap plan metadata cache on service startup / deploy.
 */

import type { Pool } from '../shared/db/connectionPool';
import type { RedisClient } from '../shared/cache/types';
import { createRedisClient } from '../shared/cache/createRedisClient';
import { PlanCacheService } from './domain/PlanCacheService';
import { PostgresPlanRepository } from './domain/PostgresPlanRepository';
import { InMemoryPlanRepository } from './domain/PlanRepository';
import type { IPlanRepository } from './domain/PlanRepository';
import { runPlanCacheWarming } from './jobs/cacheWarming';
import { setPlanCacheService } from './planCacheRegistry';

export interface PlanCacheBootstrap {
  planCache: PlanCacheService;
  redis: RedisClient;
  repository: IPlanRepository;
}

export interface BootstrapPlanCacheOptions {
  pool?: Pool;
  repository?: IPlanRepository;
  redis?: RedisClient;
  /** Run cache warming after init (default: true). */
  warmOnStart?: boolean;
}

/**
 * Initialize Redis plan cache and optionally warm it from the database.
 * Registers the instance globally for GraphQL loaders.
 */
export async function bootstrapPlanCache(
  options: BootstrapPlanCacheOptions = {},
): Promise<PlanCacheBootstrap | null> {
  const warmOnStart = options.warmOnStart ?? true;

  try {
    const redis = options.redis ?? (await createRedisClient());
    const repository =
      options.repository ??
      (options.pool ? new PostgresPlanRepository(options.pool) : new InMemoryPlanRepository());

    const planCache = new PlanCacheService(redis, repository);
    setPlanCacheService(planCache);

    if (warmOnStart) {
      await runPlanCacheWarming(planCache);
    }

    return { planCache, redis, repository };
  } catch (err) {
    console.warn('[PlanCache] Bootstrap failed — plan reads will use database directly:', err);
    setPlanCacheService(null);
    return null;
  }
}

/** Tear down the plan cache on shutdown. */
export async function shutdownPlanCache(bootstrap: PlanCacheBootstrap | null): Promise<void> {
  setPlanCacheService(null);
  if (bootstrap?.redis) {
    await bootstrap.redis.quit();
  }
}
