/**
 * FallbackPricingStrategy
 *
 * A safe fallback strategy that handles unknown or unsupported plan types gracefully.
 * It returns a safe default (the base price) instead of failing, allowing the system
 * to continue operating even when encountering unexpected pricing models.
 *
 * This strategy should only be used as a last resort via the strategy registry.
 * It should never be the primary strategy for a known plan type.
 *
 * Configuration: No additional config needed
 * Performance: O(1), completes in <1ms
 */

import type { PricingStrategy, Usage, Plan, Subscriber, Amount } from './pricing-strategy.interface';

export class FallbackPricingStrategy implements PricingStrategy {
  getName(): string {
    return 'Fallback Pricing (Base Price)';
  }

  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount {
    // Validate minimal inputs
    if (!plan) {
      throw new Error('Invalid plan: plan object is required');
    }

    if (!plan.currency) {
      throw new Error('Invalid plan: currency is required');
    }

    // Default to base price (or 0 if not specified)
    const basePrice = typeof plan.basePrice === 'number' && plan.basePrice >= 0 ? plan.basePrice : 0;
    const value = Math.round(basePrice * 100) / 100; // Round to 2 decimals

    return {
      value,
      currency: plan.currency,
      breakdown: {
        strategy: 'fallback',
        basePrice: value,
        note: 'Using fallback pricing for unknown plan type',
      },
    };
  }
}
