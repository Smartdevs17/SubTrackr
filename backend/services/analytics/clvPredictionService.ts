/**
 * Customer Lifetime Value (CLV) Prediction Service
 *
 * Uses a hybrid approach combining:
 *  - Historical average revenue per user (ARPU)
 *  - Churn probability estimation
 *  - Discount rate for future cash flows
 *
 * Implements a simplified BG/NBD-style model for predicting
 * the expected number of future transactions and applies
 * a gamma-gamma model for monetary value.
 *
 * Closes #1147
 */

export interface CLVInput {
  userId: string;
  /** Number of transactions in the observation period */
  transactionCount: number;
  /** Total revenue from the user */
  totalRevenue: number;
  /** Days since first transaction */
  daysSinceFirstPurchase: number;
  /** Days since most recent transaction */
  daysSinceLastPurchase: number;
  /** Average order value */
  averageOrderValue: number;
  /** Recency-frequency score (optional) */
  frequencyScore?: number;
}

export interface CLVPredictionResult {
  userId: string;
  predictedCLV: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
  expectedTransactions12M: number;
  expectedMonthlyValue: number;
  predictedLifespanMonths: number;
  churnProbability: number;
  model: 'hybrid-bg-nbd';
  computedAt: Date;
}

export class CLVPredictionService {
  /** Default discount rate (annual) for future cash flows */
  private static readonly DEFAULT_DISCOUNT_RATE = 0.1;

  /** Maximum expected lifespan in months (cap to avoid infinite values) */
  private static readonly MAX_LIFESPAN_MONTHS = 120;

  /**
   * Predict the CLV for a single customer using a hybrid model.
   *
   * The model combines:
   *  1. BG/NBD-inspired transaction prediction (simplified)
   *  2. Gamma-Gamma-inspired monetary value estimation
   *  3. DCF (discounted cash flow) for present value
   */
  predictCLV(input: CLVInput): CLVPredictionResult {
    const {
      userId,
      transactionCount,
      totalRevenue,
      daysSinceFirstPurchase,
      daysSinceLastPurchase,
      averageOrderValue,
    } = input;

    // Guard against invalid input
    if (transactionCount <= 0 || totalRevenue <= 0) {
      return {
        userId,
        predictedCLV: 0,
        confidenceInterval: { lower: 0, upper: 0 },
        expectedTransactions12M: 0,
        expectedMonthlyValue: 0,
        predictedLifespanMonths: 0,
        churnProbability: 1,
        model: 'hybrid-bg-nbd',
        computedAt: new Date(),
      };
    }

    // --- BG/NBD-inspired transaction frequency prediction ---
    // Recency in days (time between first and last purchase)
    const recencyDays = daysSinceFirstPurchase - daysSinceLastPurchase;
    // Frequency (repeat purchases, i.e., count minus 1)
    const frequency = Math.max(transactionCount - 1, 0);
    // Time period in days (observation window)
    const T = daysSinceFirstPurchase > 0 ? daysSinceFirstPurchase : 1;

    // Simplified BG/NBD parameters (maximum likelihood estimates approximated)
    const r = 0.243; // shape parameter for Gamma distribution of lambda
    const alpha = 4.414; // scale parameter
    const a = 0.792; // shape parameter for Beta distribution of p
    const b = 2.426; // scale parameter

    // Expected number of transactions in next 365 days (simplified)
    // Using the BG/NBD conditional expectation formula
    const x = frequency;
    const t_x = recencyDays;

    // P(alive) - probability customer is still "alive" (active)
    const pAliveNumerator = Math.pow(a + x, -1) * Math.pow(b + x - 1, -1);
    const pAliveDenominator =
      Math.pow(a + x, -1) * Math.pow(b + x - 1, -1) +
      Math.pow(a + x + t_x / T, -1) * Math.pow(b + x, -1) * Math.exp(-r * alpha * t_x / T);

    const pAlive = pAliveNumerator / pAliveDenominator;

    // Expected transactions in next period (12 months)
    const expectedTransactions12M =
      pAlive *
      ((r + x) / (alpha + T)) *
      (1 - Math.pow((alpha + T) / (alpha + T + 365), r + x)) /
      (1 - Math.pow(alpha / (alpha + T), r));

    // --- Churn probability ---
    const churnProbability = 1 - pAlive;

    // --- Gamma-Gamma-inspired monetary value prediction ---
    // Expected average transaction value using gamma-gamma model
    // Simplified: use empirical Bayesian shrinkage
    const p = 6.0; // shape parameter
    const q = 3.0; // scale parameter
    const gamma = 1.0; // mixing parameter

    const empiricalMean = totalRevenue / transactionCount;
    const posteriorMean = ((gamma * p) / (gamma * p + transactionCount)) * (p * q / (gamma - 1)) +
      (transactionCount / (gamma * p + transactionCount)) * empiricalMean;

    const expectedMonetaryValue = Math.max(posteriorMean, 0);

    // --- Expected monthly value ---
    const expectedMonthlyValue = (expectedTransactions12M / 12) * expectedMonetaryValue;

    // --- Predicted lifespan ---
    const monthlyChurnRate = 1 - Math.pow(pAlive, 1 / 12);
    let predictedLifespanMonths: number;
    if (monthlyChurnRate <= 0 || monthlyChurnRate >= 1) {
      predictedLifespanMonths = monthlyChurnRate >= 1 ? 0 : CLVPredictionService.MAX_LIFESPAN_MONTHS;
    } else {
      predictedLifespanMonths = Math.min(
        -1 / Math.log(1 - monthlyChurnRate),
        CLVPredictionService.MAX_LIFESPAN_MONTHS,
      );
    }

    // --- CLV via DCF ---
    const monthlyDiscountRate = CLVPredictionService.DEFAULT_DISCOUNT_RATE / 12;
    const predictedCLV = CLVPredictionService.computeDCF(
      expectedMonthlyValue,
      predictedLifespanMonths,
      monthlyDiscountRate,
    );

    // --- Confidence interval ---
    // Use Poisson-like variance for transaction count and proportional variance for monetary value
    const transactionVariance = expectedTransactions12M; // Poisson assumption
    const monetaryVariance = Math.pow(expectedMonetaryValue * 0.3, 2); // 30% CV assumption
    const totalVariance = transactionVariance * monetaryVariance +
      (expectedTransactions12M * expectedMonetaryValue) ** 2 * 0.1;
    const stdError = Math.sqrt(totalVariance);
    const confidenceInterval = {
      lower: Math.max(predictedCLV - 1.96 * stdError, 0),
      upper: predictedCLV + 1.96 * stdError,
    };

    return {
      userId,
      predictedCLV: Math.round(predictedCLV * 100) / 100,
      confidenceInterval: {
        lower: Math.round(confidenceInterval.lower * 100) / 100,
        upper: Math.round(confidenceInterval.upper * 100) / 100,
      },
      expectedTransactions12M: Math.round(expectedTransactions12M * 100) / 100,
      expectedMonthlyValue: Math.round(expectedMonthlyValue * 100) / 100,
      predictedLifespanMonths: Math.round(predictedLifespanMonths * 10) / 10,
      churnProbability: Math.round(churnProbability * 10000) / 10000,
      model: 'hybrid-bg-nbd',
      computedAt: new Date(),
    };
  }

  /**
   * Predict CLV for multiple customers in batch.
   */
  predictCLVBatch(inputs: CLVInput[]): CLVPredictionResult[] {
    return inputs.map((input) => this.predictCLV(input));
  }

  /**
   * Compute discounted cash flow for a constant monthly revenue over N months.
   */
  private static computeDCF(
    monthlyValue: number,
    months: number,
    monthlyDiscountRate: number,
  ): number {
    if (monthlyDiscountRate === 0) {
      return monthlyValue * months;
    }
    // DCF formula: sum_{t=1}^{n} V / (1 + r)^t = V * [1 - (1+r)^{-n}] / r
    return (monthlyValue * (1 - Math.pow(1 + monthlyDiscountRate, -months))) / monthlyDiscountRate;
  }

  /**
   * Segment customers by predicted CLV into tiers.
   */
  segmentByCLV(
    results: CLVPredictionResult[],
  ): { tier: string; customers: CLVPredictionResult[]; totalCLV: number }[] {
    const sorted = [...results].sort((a, b) => b.predictedCLV - a.predictedCLV);
    const n = sorted.length;
    if (n === 0) return [];

    const top20End = Math.ceil(n * 0.2);
    const mid60End = Math.ceil(n * 0.8);

    const tiers = [
      { tier: 'VIP', customers: sorted.slice(0, top20End) },
      { tier: 'Growth', customers: sorted.slice(top20End, mid60End) },
      { tier: 'Standard', customers: sorted.slice(mid60End) },
    ];

    return tiers.map((t) => ({
      tier: t.tier,
      customers: t.customers,
      totalCLV: t.customers.reduce((sum, c) => sum + c.predictedCLV, 0),
    }));
  }
}

export const clvPredictionService = new CLVPredictionService();
