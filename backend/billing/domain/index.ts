/**
 * Billing Domain - Public API
 *
 * Exports the BillingEngine and strategy-related types for use throughout the application.
 */

export { BillingEngine, billingEngine } from './billing-engine';
export { StrategyRegistry, getStrategyRegistry, resetStrategyRegistry } from './strategy-registry';
export { type PricingStrategy, type Usage, type Plan, type Subscriber, type Amount } from './strategies';
export {
  FlatPricingStrategy,
  PerSeatPricingStrategy,
  UsageBasedPricingStrategy,
  TieredPricingStrategy,
  FallbackPricingStrategy,
  type PricingTier,
  type TierBreakdownLine,
} from './strategies';
