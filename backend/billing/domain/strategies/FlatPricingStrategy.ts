import { createAmount, type BillingPlan, type BillingSubscriber, type BillingUsage } from '../types';
import type { PricingStrategy } from '../PricingStrategy';

export class FlatPricingStrategy implements PricingStrategy {
  readonly code = 'flat';

  calculate(_usage: BillingUsage, plan: BillingPlan, _subscriber: BillingSubscriber) {
    return createAmount(plan.price, plan.currency);
  }
}
