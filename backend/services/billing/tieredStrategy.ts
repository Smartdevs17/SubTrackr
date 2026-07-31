/**
 * Tiered Pricing Strategy
 *
 * Implements volume-based pricing tiers where the per-unit price
 * changes based on usage volume. Common in SaaS and API pricing.
 */

import {
  PricingStrategy,
  PricingContext,
  PricingResult,
  PricingBreakdown,
  ABTestVariant,
  PricingAnalytics,
} from './pricingStrategy';

interface PricingTier {
  name: string;
  upTo: number; // -1 for unlimited
  flatFee: number;
  perUnit: number;
}

export class TieredPricingStrategy implements PricingStrategy {
  readonly name = 'tiered';
  readonly description = 'Volume-based pricing with progressive tiers';

  private totalCalculations = 0;
  private totalProcessingTimeMs = 0;
  private lastExecutedAt: string | null = null;

  /** Default tier definitions */
  private static readonly DEFAULT_TIERS: PricingTier[] = [
    { name: 'starter', upTo: 100, flatFee: 0, perUnit: 0.10 },
    { name: 'growth', upTo: 1000, flatFee: 0, perUnit: 0.07 },
    { name: 'scale', upTo: 10000, flatFee: 0, perUnit: 0.04 },
    { name: 'enterprise', upTo: -1, flatFee: 0, perUnit: 0.02 },
  ];

  calculatePrice(context: PricingContext): PricingResult {
    const startTime = Date.now();
    const { currentPrice, usageData } = context;

    const units = usageData?.apiCallsThisPeriod || 0;
    const tiers = TieredPricingStrategy.DEFAULT_TIERS;

    const adjustments: PricingBreakdown['adjustments'] = [];
    let tieredPrice = 0;
    let remaining = units;

    for (const tier of tiers) {
      if (remaining <= 0) break;

      const tierCapacity = tier.upTo === -1 ? remaining : Math.min(remaining, tier.upTo);
      const tierCost = tierCapacity * tier.perUnit;

      if (tierCost > 0) {
        tieredPrice += tierCost;
        adjustments.push({
          name: `tier_${tier.name}`,
          amount: tierCost,
          reason: `${tierCapacity} units @ $${tier.perUnit}/unit (${tier.name} tier)`,
        });
      }

      remaining -= tierCapacity;
    }

    // Blend tiered price with base price (weighted average)
    const blendedPrice = currentPrice * 0.3 + tieredPrice * 0.7;

    const elapsed = Date.now() - startTime;
    this.totalCalculations++;
    this.totalProcessingTimeMs += elapsed;
    this.lastExecutedAt = new Date().toISOString();

    return {
      price: Math.round(blendedPrice * 100) / 100,
      breakdown: {
        basePrice: currentPrice,
        adjustments,
        finalPrice: Math.round(blendedPrice * 100) / 100,
      },
      strategyName: this.name,
      metadata: {
        units,
        tieredPrice,
        blendedPrice,
        tiers: tiers.map((t) => t.name),
      },
    };
  }

  getABTestVariants(basePrice: number): ABTestVariant[] {
    return [
      {
        name: 'conservative_tiers',
        price: basePrice * 0.9,
        weight: 0.3,
        reasoning: 'Lower tier thresholds to attract more users',
      },
      {
        name: 'standard_tiers',
        price: basePrice,
        weight: 0.4,
        reasoning: 'Standard tiered pricing',
      },
      {
        name: 'aggressive_tiers',
        price: basePrice * 1.1,
        weight: 0.3,
        reasoning: 'Higher tier thresholds for premium positioning',
      },
    ];
  }

  getAnalytics(): PricingAnalytics {
    return {
      strategyName: this.name,
      totalCalculations: this.totalCalculations,
      avgProcessingTimeMs: this.totalCalculations > 0
        ? this.totalProcessingTimeMs / this.totalCalculations
        : 0,
      lastExecutedAt: this.lastExecutedAt || new Date().toISOString(),
      priceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
    };
  }
}
