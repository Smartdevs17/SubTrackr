/**
 * Dynamic Pricing Strategy
 *
 * ML-driven pricing that adjusts based on demand, competitor analysis,
 * willingness-to-pay estimation, and market conditions.
 */

import {
  PricingStrategy,
  PricingContext,
  PricingResult,
  PricingBreakdown,
  ABTestVariant,
  PricingAnalytics,
} from './pricingStrategy';

export class DynamicPricingStrategy implements PricingStrategy {
  readonly name = 'dynamic';
  readonly description = 'ML-driven dynamic pricing with demand and competitor analysis';

  private totalCalculations = 0;
  private totalProcessingTimeMs = 0;
  private lastExecutedAt: string | null = null;

  /** Competitor price benchmarks */
  private static readonly COMPETITOR_PRICES: Record<string, number[]> = {
    netflix: [10.99, 15.49, 22.99],
    spotify: [5.99, 10.99, 16.99],
    disney_plus: [7.99, 13.99],
    youtube_premium: [13.99],
  };

  calculatePrice(context: PricingContext): PricingResult {
    const startTime = Date.now();
    const { currentPrice, usageData } = context;

    // Estimate willingness to pay
    const wtp = this.estimateWillingnessToPay(usageData, currentPrice);

    // Get competitor average
    const competitorAvg = this.getCompetitorAverage();

    // Calculate demand multiplier
    const demandMultiplier = this.calculateDemandMultiplier(usageData);

    // Core formula: weighted blend of WTP, competitor, and demand-adjusted price
    const targetPrice =
      wtp * 0.4 + competitorAvg * 0.4 + currentPrice * demandMultiplier * 0.2;

    // Apply floor and ceiling
    const floor = currentPrice * 0.8;
    const ceiling = currentPrice * 1.5;
    const optimalPrice = Math.max(floor, Math.min(ceiling, targetPrice));

    const adjustments: PricingBreakdown['adjustments'] = [
      {
        name: 'wtp_estimate',
        amount: wtp - currentPrice,
        reason: `Willingness-to-pay: $${wtp.toFixed(2)}`,
      },
      {
        name: 'competitor_benchmark',
        amount: competitorAvg - currentPrice,
        reason: `Competitor average: $${competitorAvg.toFixed(2)}`,
      },
      {
        name: 'demand_adjustment',
        amount: currentPrice * (demandMultiplier - 1),
        reason: `Demand multiplier: ${demandMultiplier.toFixed(2)}x`,
      },
    ];

    const elapsed = Date.now() - startTime;
    this.totalCalculations++;
    this.totalProcessingTimeMs += elapsed;
    this.lastExecutedAt = new Date().toISOString();

    return {
      price: Math.round(optimalPrice * 100) / 100,
      breakdown: {
        basePrice: currentPrice,
        adjustments,
        finalPrice: Math.round(optimalPrice * 100) / 100,
      },
      strategyName: this.name,
      metadata: {
        wtp,
        competitorAvg,
        demandMultiplier,
        floor,
        ceiling,
        recommendation:
          optimalPrice > currentPrice
            ? 'Increase'
            : optimalPrice < currentPrice
            ? 'Decrease'
            : 'Maintain',
      },
    };
  }

  private estimateWillingnessToPay(
    usageData: PricingContext['usageData'],
    currentPrice: number
  ): number {
    if (!usageData) return currentPrice;

    const baseWtp = currentPrice;
    const retentionBoost = usageData.retentionRate * 0.2;
    const frequencyBoost = Math.min(usageData.sessionsPerWeek * 0.05, 0.5);

    return baseWtp * (1 + retentionBoost + frequencyBoost);
  }

  private getCompetitorAverage(): number {
    const allPrices = Object.values(DynamicPricingStrategy.COMPETITOR_PRICES).flat();
    return allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length;
  }

  private calculateDemandMultiplier(usageData: PricingContext['usageData']): number {
    if (!usageData) return 1.0;

    // High usage = higher demand = higher price
    const usageScore = Math.min(
      (usageData.sessionsPerWeek / 20) * 0.5 + usageData.retentionRate * 0.5,
      1.0
    );

    return 0.8 + usageScore * 0.6; // Range: 0.8x to 1.4x
  }

  getABTestVariants(basePrice: number): ABTestVariant[] {
    return [
      {
        name: 'conservative_dynamic',
        price: Math.round(basePrice * 0.95 * 100) / 100,
        weight: 0.25,
        reasoning: 'Conservative dynamic pricing with 5% reduction',
      },
      {
        name: 'moderate_dynamic',
        price: basePrice,
        weight: 0.5,
        reasoning: 'Moderate dynamic pricing at market rate',
      },
      {
        name: 'aggressive_dynamic',
        price: Math.round(basePrice * 1.15 * 100) / 100,
        weight: 0.25,
        reasoning: 'Aggressive dynamic pricing with 15% premium',
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
