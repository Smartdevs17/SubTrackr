import { createAmount, getUsageUnits, type BillingPlan, type BillingSubscriber, type BillingUsage } from '../types';
import type { PricingStrategy } from '../PricingStrategy';

export class UsageBasedPricingStrategy implements PricingStrategy {
  readonly code = 'usage_based';

  calculate(usage: BillingUsage, plan: BillingPlan, _subscriber: BillingSubscriber) {
    const rate = plan.usageUnitPrice ?? plan.price;
    const units = getUsageUnits(usage);
    return createAmount(rate * units, plan.currency);
  }
}
