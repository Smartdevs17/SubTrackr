import { createAmount, getUsageUnits, type BillingPlan, type BillingSubscriber, type BillingUsage, type PricingTier } from '../types';
import type { PricingStrategy } from '../PricingStrategy';

const normalizeTiers = (tiers: PricingTier[]): PricingTier[] =>
  [...tiers].sort((left, right) => {
    const leftLimit = left.upTo ?? Number.POSITIVE_INFINITY;
    const rightLimit = right.upTo ?? Number.POSITIVE_INFINITY;
    return leftLimit - rightLimit;
  });

export class TieredPricingStrategy implements PricingStrategy {
  readonly code = 'tiered';

  calculate(usage: BillingUsage, plan: BillingPlan, _subscriber: BillingSubscriber) {
    const units = getUsageUnits(usage);
    const tiers = plan.tiers ?? [];

    if (tiers.length === 0) {
      return createAmount(plan.price * units, plan.currency);
    }

    const orderedTiers = normalizeTiers(tiers);
    let remaining = units;
    let lowerBound = 0;
    let total = 0;

    for (const tier of orderedTiers) {
      if (remaining <= 0) break;

      const tierLimit = tier.upTo ?? Number.POSITIVE_INFINITY;
      const tierWidth = tierLimit === Number.POSITIVE_INFINITY ? remaining : Math.max(tierLimit - lowerBound, 0);
      const quantity = Math.min(remaining, tierWidth);

      total += quantity * tier.unitPrice;
      remaining -= quantity;
      lowerBound = tierLimit === Number.POSITIVE_INFINITY ? lowerBound + quantity : tierLimit;
    }

    if (remaining > 0) {
      const lastTier = orderedTiers[orderedTiers.length - 1];
      total += remaining * lastTier.unitPrice;
    }

    return createAmount(total, plan.currency);
  }
}
