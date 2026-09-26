/**
 * Usage-Based Pricing Strategy
 *
 * Charges based on actual resource consumption (API calls, storage, seats).
 * Includes tiered pricing within each usage metric.
 */

import {
  PricingStrategy,
  PricingContext,
  PricingResult,
  PricingBreakdown,
  ABTestVariant,
  PricingAnalytics,
} from './pricingStrategy';

interface UsageTier {
  name: string;
  upTo: number; // -1 for unlimited
  perUnit: number;
}

interface UsageMetricConfig {
  name: string;
  unit: string;
  tiers: UsageTier[];
  included: number; // Free units included in base price
}

export class UsageBasedStrategy implements PricingStrategy {
  readonly name = 'usage_based';
  readonly description = 'Pay-per-use pricing based on actual resource consumption';

  private totalCalculations = 0;
  private totalProcessingTimeMs = 0;
  private lastExecutedAt: string | null = null;

  /** Default usage metric configurations */
  private static readonly DEFAULT_METRICS: UsageMetricConfig[] = [
    {
      name: 'api_calls',
      unit: 'calls',
      included: 1000,
      tiers: [
        { name: 'included', upTo: 1000, perUnit: 0 },
        { name: 'standard', upTo: 10000, perUnit: 0.001 },
        { name: 'high_volume', upTo: 100000, perUnit: 0.0005 },
        { name: 'enterprise', upTo: -1, perUnit: 0.0002 },
      ],
    },
    {
      name: 'storage',
      unit: 'MB',
      included: 100,
      tiers: [
        { name: 'included', upTo: 100, perUnit: 0 },
        { name: 'standard', upTo: 1000, perUnit: 0.01 },
        { name: 'high_volume', upTo: 10000, perUnit: 0.005 },
        { name: 'enterprise', upTo: -1, perUnit: 0.002 },
      ],
    },
    {
      name: 'seats',
      unit: 'seats',
      included: 1,
      tiers: [
        { name: 'included', upTo: 1, perUnit: 0 },
        { name: 'team', upTo: 10, perUnit: 5.0 },
        { name: 'business', upTo: 50, perUnit: 4.0 },
        { name: 'enterprise', upTo: -1, perUnit: 3.0 },
      ],
    },
  ];

  calculatePrice(context: PricingContext): PricingResult {
    const startTime = Date.now();
    const { currentPrice, usageData } = context;

    if (!usageData) {
      return this.fallbackToFlatRate(context, startTime);
    }

    const adjustments: PricingBreakdown['adjustments'] = [];
    let usageCost = 0;

    // Calculate API call costs
    const apiCost = this.calculateMetricCost('api_calls', usageData.apiCallsThisPeriod, UsageBasedStrategy.DEFAULT_METRICS[0]);
    if (apiCost > 0) {
      usageCost += apiCost;
      adjustments.push({
        name: 'api_calls',
        amount: apiCost,
        reason: `${usageData.apiCallsThisPeriod} API calls (${apiCost > 0 ? 'overage' : 'included'})`,
      });
    }

    // Calculate storage costs
    const storageCost = this.calculateMetricCost('storage', usageData.storageUsedMB, UsageBasedStrategy.DEFAULT_METRICS[1]);
    if (storageCost > 0) {
      usageCost += storageCost;
      adjustments.push({
        name: 'storage',
        amount: storageCost,
        reason: `${usageData.storageUsedMB}MB storage usage`,
      });
    }

    // Calculate seat costs
    const seatCost = this.calculateMetricCost('seats', usageData.seatsActive, UsageBasedStrategy.DEFAULT_METRICS[2]);
    if (seatCost > 0) {
      usageCost += seatCost;
      adjustments.push({
        name: 'seats',
        amount: seatCost,
        reason: `${usageData.seatsActive} active seats`,
      });
    }

    const finalPrice = currentPrice + usageCost;

    const elapsed = Date.now() - startTime;
    this.totalCalculations++;
    this.totalProcessingTimeMs += elapsed;
    this.lastExecutedAt = new Date().toISOString();

    return {
      price: Math.round(finalPrice * 100) / 100,
      breakdown: {
        basePrice: currentPrice,
        adjustments,
        finalPrice: Math.round(finalPrice * 100) / 100,
      },
      strategyName: this.name,
      metadata: {
        apiCost,
        storageCost,
        seatCost,
        totalUsageCost: usageCost,
      },
    };
  }

  private calculateMetricCost(
    _metricName: string,
    usage: number,
    config: UsageMetricConfig
  ): number {
    let cost = 0;
    let remaining = Math.max(0, usage - config.included);

    for (const tier of config.tiers) {
      if (tier.name === 'included') continue;
      if (remaining <= 0) break;

      const tierCapacity = tier.upTo === -1 ? remaining : Math.min(remaining, tier.upTo);
      cost += tierCapacity * tier.perUnit;
      remaining -= tierCapacity;
    }

    return cost;
  }

  private fallbackToFlatRate(context: PricingContext, startTime: number): PricingResult {
    const elapsed = Date.now() - startTime;
    this.totalCalculations++;
    this.totalProcessingTimeMs += elapsed;
    this.lastExecutedAt = new Date().toISOString();

    return {
      price: context.currentPrice,
      breakdown: {
        basePrice: context.currentPrice,
        adjustments: [],
        finalPrice: context.currentPrice,
      },
      strategyName: this.name,
      metadata: { fallback: true, reason: 'No usage data provided' },
    };
  }

  getABTestVariants(basePrice: number): ABTestVariant[] {
    return [
      {
        name: 'pay_as_you_go',
        price: basePrice,
        weight: 0.3,
        reasoning: 'Pure usage-based pricing',
      },
      {
        name: 'base_plus_usage',
        price: basePrice * 0.7,
        weight: 0.4,
        reasoning: 'Lower base with usage overage charges',
      },
      {
        name: 'included_usage',
        price: basePrice * 1.2,
        weight: 0.3,
        reasoning: 'Higher base with generous included usage',
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
