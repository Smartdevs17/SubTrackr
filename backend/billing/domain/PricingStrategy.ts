import type { Amount, BillingPlan, BillingSubscriber, BillingUsage, PricingStrategyCode } from './types';

export interface PricingStrategy {
  readonly code: PricingStrategyCode;
  calculate(usage: BillingUsage, plan: BillingPlan, subscriber: BillingSubscriber): Amount;
}
