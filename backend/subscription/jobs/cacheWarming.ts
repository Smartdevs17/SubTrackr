/**
 * Cache warming job — pre-loads active plan metadata into Redis on deploy.
 *
 * Invoke from application bootstrap or a deploy hook:
 *   await runPlanCacheWarming(planCacheService);
 */

import type { PlanCacheService } from '../domain/PlanCacheService';

export interface CacheWarmingResult {
  warmed: number;
  errors: number;
  durationMs: number;
  skipped: boolean;
  reason?: string;
}

export interface CacheWarmingOptions {
  /** Skip warming when Redis is unreachable (default: true). */
  skipWhenUnhealthy?: boolean;
  onComplete?: (result: CacheWarmingResult) => void;
}

/**
 * Warms the plan metadata cache from the database.
 * Designed to run once on service deploy / process startup.
 */
export async function runPlanCacheWarming(
  planCache: PlanCacheService,
  options: CacheWarmingOptions = {},
): Promise<CacheWarmingResult> {
  const skipWhenUnhealthy = options.skipWhenUnhealthy ?? true;
  const start = Date.now();

  if (skipWhenUnhealthy) {
    const healthy = await planCache.isHealthy();
    if (!healthy) {
      const result: CacheWarmingResult = {
        warmed: 0,
        errors: 0,
        durationMs: Date.now() - start,
        skipped: true,
        reason: 'Redis unavailable',
      };
      options.onComplete?.(result);
      return result;
    }
  }

  const { warmed, errors } = await planCache.warmActivePlans();
  const result: CacheWarmingResult = {
    warmed,
    errors,
    durationMs: Date.now() - start,
    skipped: false,
  };

  options.onComplete?.(result);
  return result;
}

/** Cron-friendly alias matching technical scope naming. */
export const cacheWarmingJob = runPlanCacheWarming;
