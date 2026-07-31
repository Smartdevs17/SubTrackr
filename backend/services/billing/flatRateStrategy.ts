/**
 * Flat Rate Pricing Strategy
 *
 * Charges a fixed price per billing period with optional modifiers
 * for long-term commitments and loyalty.
 */

import {
  PricingStrategy,
  PricingContext,
  PricingResult,
  PricingBreakdown,
  ABTestVariant,
  PricingAnalytics,
} from './pricingStrategy';

export class FlatRateStrategy implements PricingStrategy {
  readonly name = 'flat_rate';
  readonly description = 'Fixed price per billing period with commitment discounts';

  private totalCalculations = 0;
  private totalProcessingTimeMs = 0;
  private lastExecutedAt: string | null = null;

  /** Discount percentages for annual commitments */
  private static readonly COMMITMENT_DISCOUNTS: Record<string, number> = {
    yearly: 0.15,
    quarterly: 0.05,
    monthly: 0.0,
    weekly: 0.0,
    daily: 0.0,
  };

  /** Loyalty discount thresholds (months subscribed -> discount) */
  private static readonly LOYALTY_TIERS: Array<{ months: number; discount: number }> = [
    { months: 12, discount: 0.05 },
    { months: 24, discount: 0.10 },
    { months: 36, discount: 0.15 },
  ];

  calculatePrice(context: PricingContext): PricingResult {
    const startTime = Date.now();
    const { currentPrice, usageData } = context;
    const billingCycle = usageData ? 'monthly' : 'monthly';

    const adjustments: PricingBreakdown['adjustments'] = [];
    let price = currentPrice;

    // Apply commitment discount
    const commitmentDiscount = FlatRateStrategy.COMMITMENT_DISCOUNTS[billingCycle] || 0;
    if (commitmentDiscount > 0) {
      const adjustment = price * commitmentDiscount;
      adjustments.push({
        name: 'commitment_discount',
        amount: -adjustment,
        reason: `${(commitmentDiscount * 100).toFixed(0)}% off for ${billingCycle} billing`,
      });
      price -= adjustment;
    }

    // Apply loyalty discount based on retention
    if (usageData?.retentionRate) {
      const loyaltyDiscount = this.getLoyaltyDiscount(usageData.retentionRate);
      if (loyaltyDiscount > 0) {
        const adjustment = price * loyaltyDiscount;
        adjustments.push({
          name: 'loyalty_discount',
          amount: -adjustment,
          reason: `Loyalty discount (${(loyaltyDiscount * 100).toFixed(0)}%)`,
        });
        price -= adjustment;
      }
    }

    const elapsed = Date.now() - startTime;
    this.totalCalculations++;
    this.totalProcessingTimeMs += elapsed;
    this.lastExecutedAt = new Date().toISOString();

    return {
      price: Math.round(price * 100) / 100,
      breakdown: {
        basePrice: currentPrice,
        adjustments,
        finalPrice: Math.round(price * 100) / 100,
      },
      strategyName: this.name,
      metadata: {
        billingCycle,
        commitmentDiscount,
      },
    };
  }

  getABTestVariants(basePrice: number): ABTestVariant[] {
    return [
      {
        name: 'control',
        price: basePrice,
        weight: 0.4,
        reasoning: 'Current flat rate pricing',
      },
      {
        name: 'discount_10',
        price: Math.round(basePrice * 0.9 * 100) / 100,
        weight: 0.3,
        reasoning: '10% discount to test price elasticity',
      },
      {
        name: 'premium_15',
        price: Math.round(basePrice * 1.15 * 100) / 100,
        weight: 0.3,
        reasoning: '15% premium to test willingness to pay',
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

  private getLoyaltyDiscount(retentionRate: number): number {
    // Map retention rate to loyalty months (0.5 = 12 months, 0.8 = 24 months, 1.0 = 36 months)
    const loyaltyMonths = Math.floor(retentionRate * 36);
    let discount = 0;
    for (const tier of FlatRateStrategy.LOYALTY_TIERS) {
      if (loyaltyMonths >= tier.months) {
        discount = tier.discount;
      }
    }
    return discount;
  }
}
