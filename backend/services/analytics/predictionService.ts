import path from 'path';
const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

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
  modelVersion?: string;
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
  private static readonly _PYTHON_PATH = path.join(__dirname, '../../ml/churnModel.py');

  /**
   * Predicts the likelihood of a subscriber churning and assigns a risk score.
   */
  static async predictChurn(
    subscriberAddress: string,
    userData: UserChurnData
  ): Promise<ChurnPrediction> {
    const res = await fetch(`${ML_SERVICE_URL}/v1/churn/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscriber: subscriberAddress,
        user_data: {
          recent_payment_failures: userData.recentPaymentFailures,
          baseline_logins_per_month: userData.baselineLoginsPerMonth,
          recent_logins: userData.recentLogins,
          open_support_tickets: userData.openSupportTickets,
          price_sensitivity_index: userData.priceSensitivityIndex,
        },
      }),
    });

    if (!res.ok) throw new Error(`ML service error: ${res.status}`);

    const data = await res.json();
    return {
      subscriber: data.subscriber,
      churnProbability: data.churn_probability,
      riskLevel: data.risk_level,
      riskFactors: data.risk_factors ?? [],
      recommendedAction: data.recommended_action,
      modelVersion: data.model_version,
    };
  }

  static async predictChurnBatch(
    items: Array<{ subscriberAddress: string; userData: UserChurnData }>
  ): Promise<ChurnPrediction[]> {
    const res = await fetch(`${ML_SERVICE_URL}/v1/churn/predict/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items.map((i) => ({
          subscriber: i.subscriberAddress,
          user_data: {
            recent_payment_failures: i.userData.recentPaymentFailures,
            baseline_logins_per_month: i.userData.baselineLoginsPerMonth,
            recent_logins: i.userData.recentLogins,
            open_support_tickets: i.userData.openSupportTickets,
            price_sensitivity_index: i.userData.priceSensitivityIndex,
          },
        })),
      }),
    });

    if (!res.ok) throw new Error(`ML service error: ${res.status}`);

    const data = await res.json();
    return data.results
      .filter((r: any) => r.ok)
      .map((r: any) => ({
        subscriber: r.subscriber,
        churnProbability: r.churn_probability,
        riskLevel: r.risk_level,
        riskFactors: r.risk_factors ?? [],
        recommendedAction: r.recommended_action,
        modelVersion: data.model_version,
      }));
  }

  static async forecastRevenue(
    observations: RevenueObservation[],
    horizon = 3
  ): Promise<ForecastPoint[]> {
    const res = await fetch(`${ML_SERVICE_URL}/v1/churn/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observations, horizon }),
    });

    if (!res.ok) throw new Error(`ML service error: ${res.status}`);

    const data = await res.json();
    return data.map((p: any) => ({
      period: p.period,
      expectedRevenue: p.expected_revenue,
      lowerBound: p.lower_bound,
      upperBound: p.upper_bound,
    }));
  }
}
