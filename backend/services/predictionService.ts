import path from 'path';

export interface RiskFactor {
  factor: string;
  impact: number;
}

export interface ChurnPrediction {
  subscriber: string;
  churnProbability: number;
  riskLevel: 'High' | 'Medium' | 'Low';
  riskFactors: RiskFactor[];
  recommendedAction: string;
}

export interface UserChurnData {
  recentPaymentFailures: number;
  baselineLoginsPerMonth: number;
  recentLogins: number;
  openSupportTickets: number;
  priceSensitivityIndex: number;
}

export interface RevenueObservation {
  period: string;
  revenue: number;
}

export interface ForecastPoint {
  period: string;
  expectedRevenue: number;
  lowerBound: number;
  upperBound: number;
}

export class PredictionService {
  // Path for future Python bridge integration
  private static readonly _PYTHON_PATH = path.join(__dirname, '../ml/churnModel.py');

  /**
   * Predicts the likelihood of a subscriber churning and assigns a risk score.
   */
  static async predictChurn(
    subscriberAddress: string,
    userData: UserChurnData
  ): Promise<ChurnPrediction> {
    try {
      // In production, invoke python shell here.

      let riskScore = 0;
      riskScore += Math.min(userData.recentPaymentFailures / 3.0, 1.0) * 0.4;

      const drop = Math.max(
        0,
        (userData.baselineLoginsPerMonth - userData.recentLogins) /
          Math.max(userData.baselineLoginsPerMonth, 1)
      );
      riskScore += drop * 0.25;

      riskScore += Math.min(userData.openSupportTickets / 2.0, 1.0) * 0.15;

      let riskLevel: 'High' | 'Medium' | 'Low' = 'Low';
      if (riskScore >= 0.7) riskLevel = 'High';
      else if (riskScore >= 0.4) riskLevel = 'Medium';

      return {
        subscriber: subscriberAddress,
        churnProbability: Number(riskScore.toFixed(4)),
        riskLevel,
        riskFactors: [
          { factor: 'payment_failures', impact: 0.25 },
          { factor: 'login_frequency_drop', impact: 0.15 },
        ],
        recommendedAction: 'Send payment method update reminder with a discount.',
      };
    } catch (error) {
      throw new Error('Failed to predict churn');
    }
  }

  /**
   * Helper to specifically get just the risk factors for explainability dashboard.
   */
  static async getChurnRiskFactors(_subscriberAddress: string): Promise<RiskFactor[]> {
    try {
      // Simulate fetching from DB or running model inference
      return [
        { factor: 'payment_failures', impact: 0.25 },
        { factor: 'login_frequency_drop', impact: 0.15 },
        { factor: 'support_tickets', impact: 0.05 },
      ];
    } catch (error) {
      throw new Error('Failed to fetch risk factors');
    }
  }

  static async forecastRevenue(
    observations: RevenueObservation[],
    horizon = 3
  ): Promise<ForecastPoint[]> {
    if (observations.length === 0) return [];

    const values = observations.map((entry) => entry.revenue);
    const latest = values[values.length - 1];
    const deltas = values.slice(1).map((value, index) => value - values[index]);
    const averageDelta = deltas.length
      ? deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length
      : 0;
    const variance = deltas.length
      ? deltas.reduce((sum, delta) => sum + Math.pow(delta - averageDelta, 2), 0) / deltas.length
      : Math.max(latest * 0.05, 1);
    const deviation = Math.sqrt(variance);

    return Array.from({ length: horizon }, (_, index) => {
      const step = index + 1;
      const expectedRevenue = Math.max(0, latest + averageDelta * step);
      const confidence = deviation * Math.sqrt(step) * 1.96;
      return {
        period: `forecast_${step}`,
        expectedRevenue: Number(expectedRevenue.toFixed(2)),
        lowerBound: Number(Math.max(0, expectedRevenue - confidence).toFixed(2)),
        upperBound: Number((expectedRevenue + confidence).toFixed(2)),
      };
    });
  }
}
