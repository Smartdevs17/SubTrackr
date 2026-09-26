/**
 * FlatPricingStrategy
 *
 * Implements a fixed price model where the subscriber pays the same amount
 * regardless of usage. This is the simplest pricing model.
 *
 * Configuration: No additional config needed
 * Performance: O(1), completes in <1ms
 */

import type { PricingStrategy, Usage, Plan, Subscriber, Amount } from './pricing-strategy.interface';

export class FlatPricingStrategy implements PricingStrategy {
  getName(): string {
    return 'Flat Pricing';
  }

  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount {
    // Validate inputs
    if (!plan || typeof plan.basePrice !== 'number' || plan.basePrice < 0) {
      throw new Error('Invalid plan: basePrice must be a non-negative number');
    }

    if (!plan.currency) {
      throw new Error('Invalid plan: currency is required');
    }

    const value = Math.round(plan.basePrice * 100) / 100; // Round to 2 decimals

    return {
      value,
      currency: plan.currency,
      breakdown: {
        basePrice: value,
      },
    };
  }
}
