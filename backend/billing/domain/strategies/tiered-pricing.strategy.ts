/**
 * TieredPricingStrategy
 *
 * Implements tiered (graduated) pricing where different rates apply to different
 * usage levels. For example, the first 100 units are free, the next 900 units cost
 * $0.01 each, and units beyond 1000 cost $0.005 each.
 *
 * Configuration: { tiers: Array<{ upToUnits: number | null, unitPrice: number }> }
 * Performance: O(n) where n = number of tiers, typically <2ms for standard configs
 *
 * Example tiers:
 *   [
 *     { upToUnits: 100, unitPrice: 0 },      // First 100 units free
 *     { upToUnits: 1000, unitPrice: 0.01 },  // Next 900 units at $0.01
 *     { upToUnits: null, unitPrice: 0.005 }  // Unlimited beyond 1000 at $0.005
 *   ]
 */

import type { PricingStrategy, Usage, Plan, Subscriber, Amount } from './pricing-strategy.interface';

export interface PricingTier {
  /** Upper limit for this tier (null means unbounded) */
  upToUnits: number | null;
  /** Price per unit within this tier */
  unitPrice: number;
}

export interface TierBreakdownLine {
  tier: PricingTier;
  unitsInTier: number;
  amount: number;
}

export class TieredPricingStrategy implements PricingStrategy {
  getName(): string {
    return 'Tiered Pricing';
  }

  calculate(usage: Usage, plan: Plan, subscriber: Subscriber): Amount {
    // Validate inputs
    if (!plan || !plan.config || !Array.isArray(plan.config.tiers)) {
      throw new Error('Invalid plan: tiers array is required in config for tiered pricing');
    }

    if (plan.config.tiers.length === 0) {
      throw new Error('Invalid plan: tiers array must not be empty');
    }

    if (!plan.currency) {
      throw new Error('Invalid plan: currency is required');
    }

    if (!usage || typeof usage.unitsConsumed !== 'number' || usage.unitsConsumed < 0) {
      throw new Error('Invalid usage: unitsConsumed must be a non-negative number');
    }

    const tiers: PricingTier[] = plan.config.tiers;

    // Validate and sort tiers
    for (const tier of tiers) {
      if (typeof tier.unitPrice !== 'number' || tier.unitPrice < 0) {
        throw new Error('Invalid tier: unitPrice must be a non-negative number');
      }
      if (tier.upToUnits !== null && (typeof tier.upToUnits !== 'number' || tier.upToUnits < 0)) {
        throw new Error('Invalid tier: upToUnits must be null or a non-negative number');
      }
    }

    const sortedTiers = [...tiers].sort((a, b) => {
      if (a.upToUnits === null) return 1;
      if (b.upToUnits === null) return -1;
      return a.upToUnits - b.upToUnits;
    });

    const unitsConsumed = Math.max(0, usage.unitsConsumed);
    const lines: TierBreakdownLine[] = [];
    let remaining = unitsConsumed;
    let lowerBound = 0;
    let totalAmount = 0;

    for (const tier of sortedTiers) {
      if (remaining <= 0) break;

      const tierCapacity = tier.upToUnits === null ? Infinity : tier.upToUnits - lowerBound;
      const unitsInTier = Math.min(remaining, tierCapacity);
      const amount = unitsInTier * tier.unitPrice;

      lines.push({ tier, unitsInTier, amount });
      totalAmount += amount;
      remaining -= unitsInTier;
      lowerBound = tier.upToUnits === null ? lowerBound : tier.upToUnits;
    }

    const value = Math.round(totalAmount * 100) / 100; // Round to 2 decimals

    return {
      value,
      currency: plan.currency,
      breakdown: {
        unitsConsumed,
        totalAmount: value,
        tiers: lines.map((line) => ({
          upToUnits: line.tier.upToUnits,
          unitPrice: line.tier.unitPrice,
          unitsInTier: line.unitsInTier,
          amount: line.amount,
        })),
      },
    };
  }
}
