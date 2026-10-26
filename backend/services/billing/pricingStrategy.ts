/**
 * Pricing Strategy Interface (Strategy Pattern)
 *
 * Defines the contract for all pricing strategy implementations.
 * Each strategy encapsulates a different pricing model that can be
 * swapped at runtime based on plan type or configuration.
 */

export interface PricingContext {
  planId: string;
  subscriberAddress: string;
  currentPrice: number;
  currency: string;
  usageData?: UsageData;
  historicalData?: HistoricalPricingData;
}

export interface UsageData {
  sessionsPerWeek: number;
  retentionRate: number;
  apiCallsThisPeriod: number;
  storageUsedMB: number;
  seatsActive: number;
}

export interface HistoricalPricingData {
  previousPrices: number[];
  conversionRates: number[];
  churnRates: number[];
  revenuePerPeriod: number[];
}

export interface PricingResult {
  price: number;
  breakdown: PricingBreakdown;
  strategyName: string;
  metadata: Record<string, unknown>;
}

export interface PricingBreakdown {
  basePrice: number;
  adjustments: PriceAdjustment[];
  finalPrice: number;
}

export interface PriceAdjustment {
  name: string;
  amount: number;
  reason: string;
}

export interface ABTestVariant {
  name: string;
  price: number;
  weight: number;
  reasoning: string;
}

export interface PricingAnalytics {
  strategyName: string;
  totalCalculations: number;
  avgProcessingTimeMs: number;
  lastExecutedAt: string;
  priceDistribution: {
    min: number;
    max: number;
    mean: number;
    median: number;
  };
}

/**
 * Abstract Pricing Strategy interface.
 * All pricing strategies must implement this interface.
 */
export interface PricingStrategy {
  /** Unique name for the strategy */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Calculate the price for a subscription */
  calculatePrice(context: PricingContext): PricingResult;

  /** Generate A/B test variants based on calculated price */
  getABTestVariants(basePrice: number): ABTestVariant[];

  /** Get analytics for this strategy's usage */
  getAnalytics(): PricingAnalytics;
}
