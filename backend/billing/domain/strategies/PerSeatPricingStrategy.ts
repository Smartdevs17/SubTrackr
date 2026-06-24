import { createAmount, getBillingQuantity, type BillingPlan, type BillingSubscriber, type BillingUsage } from '../types';
import type { PricingStrategy } from '../PricingStrategy';

export class PerSeatPricingStrategy implements PricingStrategy {
  readonly code = 'per_seat';

  calculate(usage: BillingUsage, plan: BillingPlan, subscriber: BillingSubscriber) {
    const seats = getBillingQuantity(usage, plan, subscriber);
    return createAmount(plan.price * seats, plan.currency);
  }
}
