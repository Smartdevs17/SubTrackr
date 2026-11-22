/**
 * Pricing module — public API barrel.
 *
 * Everything a consumer needs is re-exported from this single entry point.
 * Internal module files are not part of the public API.
 */

// Types
export type {
  BillingInterval,
  PlanFeature,
  PlanTemplate,
  PublicPricingTier,
  PriceInput,
  PriceResult,
  IPricingStrategy,
  ProrationInput,
  ProrationResult,
  PlanCacheEntry,
  IPlanCache,
  PricingContext,
  PriceRecommendation,
  ABTestScenario,
} from './types';

// Errors
export { PricingError, PricingErrorCode } from './errors';

// Strategies
export {
  FlatRateStrategy,
  PerSeatStrategy,
  UsageBasedStrategy,
  TieredStrategy,
  StrategyRegistry,
  strategyRegistry,
} from './pricingStrategies';
export type { PricingTier } from './pricingStrategies';

// Proration
export { ProrationService, prorationService } from './prorationService';

// Plan cache
export { InMemoryPlanCache, inMemoryPlanCache } from './planCacheService';
