import { createAmount, type BillingPlan, type BillingSubscriber, type BillingUsage } from '../types';
import type { PricingStrategy } from '../PricingStrategy';

export class FallbackPricingStrategy implements PricingStrategy {
  readonly code = 'fallback';

  calculate(_usage: BillingUsage, plan: BillingPlan, _subscriber: BillingSubscriber) {
    return createAmount(plan.price, plan.currency);
  }
}
