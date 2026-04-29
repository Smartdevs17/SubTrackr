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
}
