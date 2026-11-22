/**
 * Plan cache — in-process LRU-style store for plan templates.
 *
 * Re-exports the domain cache contract from the existing
 * `backend/subscription/domain/PlanCacheService.ts` through the new module
 * boundary, and provides a lightweight in-memory implementation for contexts
 * that do not need a Redis-backed store.
 *
 * Production code that needs the Redis-backed variant should inject
 * `PlanCacheService` from the bounded context directly; this module's
 * `inMemoryPlanCache` is the right choice for unit tests and local dev.
 */

import { createPiiSafeLogger } from '../../../utils/logger';
import type { IPlanCache, PlanTemplate } from './types';

const logger = createPiiSafeLogger('subscriptions.pricing.planCache');

const DEFAULT_MAX_SIZE = 500;

export class InMemoryPlanCache implements IPlanCache {
  private readonly store = new Map<string, PlanTemplate>();

  constructor(private readonly maxSize: number = DEFAULT_MAX_SIZE) {}

  get(planId: string): PlanTemplate | undefined {
    return this.store.get(planId);
  }

  set(planId: string, plan: PlanTemplate): void {
    if (this.store.size >= this.maxSize && !this.store.has(planId)) {
      // Evict the first (oldest) entry when capacity is reached.
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
        logger.info('pricing.planCache.evict', { evicted: firstKey });
      }
    }
    this.store.set(planId, plan);
    logger.info('pricing.planCache.set', { planId });
  }

  invalidate(planId: string): void {
    this.store.delete(planId);
    logger.info('pricing.planCache.invalidate', { planId });
  }

  invalidateAll(): void {
    this.store.clear();
    logger.info('pricing.planCache.invalidateAll');
  }

  size(): number {
    return this.store.size;
  }
}

export const inMemoryPlanCache: IPlanCache = new InMemoryPlanCache();
