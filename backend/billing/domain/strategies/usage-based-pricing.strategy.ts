/**
 * UsageBasedPricingStrategy
 *
 * Implements usage-based pricing where the subscriber is charged based on units consumed.
 * The total cost is calculated by multiplying the unit price by the number of units consumed.
 *
 * Configuration: { unitPrice: number, includedUnits?: number }
 * Performance: O(1), completes in <1ms
 *
 * Example:
 *   - $0.05 per unit × 1000 units consumed = $50
 *   - With 100 included units: $0.05 per unit × (1000 - 100) = $45
 */

import type { PricingStrategy, Usage, Plan, Subscriber, Amount } from './pricing-strategy.interface';

export class UsageBasedPricingStrategy implements PricingStrategy {
  getName(): string {
    return 'Usage-Based Pricing';
  }

  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount {
    // Validate inputs
    if (!plan || !plan.config) {
      throw new Error('Invalid plan: config is required for usage-based pricing');
    }

    if (typeof plan.config.unitPrice !== 'number' || plan.config.unitPrice < 0) {
      throw new Error('Invalid plan config: unitPrice must be a non-negative number');
    }

    if (!plan.currency) {
      throw new Error('Invalid plan: currency is required');
    }

    if (!usage || typeof usage.unitsConsumed !== 'number' || usage.unitsConsumed < 0) {
      throw new Error('Invalid usage: unitsConsumed must be a non-negative number');
    }

    const unitPrice = plan.config.unitPrice;
    const includedUnits = plan.config.includedUnits ?? 0;
    const unitsConsumed = Math.max(0, usage.unitsConsumed);
    const billableUnits = Math.max(0, unitsConsumed - includedUnits);

    const value = Math.round(billableUnits * unitPrice * 100) / 100; // Round to 2 decimals

    return {
      value,
      currency: plan.currency,
      breakdown: {
        unitPrice,
        unitsConsumed,
        includedUnits,
        billableUnits,
        total: value,
      },
    };
  }
}
