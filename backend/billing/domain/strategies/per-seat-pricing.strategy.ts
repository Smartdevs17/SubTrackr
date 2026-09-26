/**
 * PerSeatPricingStrategy
 *
 * Implements a per-seat (per-user) pricing model where the total cost is calculated
 * by multiplying the base price per seat by the number of seats/users.
 *
 * Configuration: { pricePerSeat: number }
 * Performance: O(1), completes in <1ms
 *
 * Example: $10 per seat × 5 seats = $50
 */

import type { PricingStrategy, Usage, Plan, Subscriber, Amount } from './pricing-strategy.interface';

export class PerSeatPricingStrategy implements PricingStrategy {
  getName(): string {
    return 'Per-Seat Pricing';
  }

  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount {
    // Validate inputs
    if (!plan || typeof plan.basePrice !== 'number' || plan.basePrice < 0) {
      throw new Error('Invalid plan: basePrice must be a non-negative number');
    }

    if (!plan.currency) {
      throw new Error('Invalid plan: currency is required');
    }

    if (!usage || typeof usage.seatCount !== 'number' || usage.seatCount < 0) {
      throw new Error('Invalid usage: seatCount must be a non-negative number');
    }

    const seatCount = Math.floor(Math.max(0, usage.seatCount));
    const pricePerSeat = plan.basePrice;
    const value = Math.round(seatCount * pricePerSeat * 100) / 100; // Round to 2 decimals

    return {
      value,
      currency: plan.currency,
      breakdown: {
        pricePerSeat,
        seatCount,
        total: value,
      },
    };
  }
}
