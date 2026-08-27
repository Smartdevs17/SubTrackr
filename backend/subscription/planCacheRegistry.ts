/**
 * Registry for the shared PlanCacheService instance.
 * GraphQL loaders and resolvers use this when the cache has been bootstrapped.
 */

import type { PlanCacheService } from './domain/PlanCacheService';

let planCacheInstance: PlanCacheService | null = null;

export function setPlanCacheService(service: PlanCacheService | null): void {
  planCacheInstance = service;
}

export function getPlanCacheService(): PlanCacheService | null {
  return planCacheInstance;
}
