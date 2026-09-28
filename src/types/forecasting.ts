/**
 * Types for the subscription metrics forecasting feature (#1232).
 */

// ── Model selection ────────────────────────────────────────────────────────

export type ForecastModel = 'linear' | 'exponential' | 'moving_average';

export type ForecastGranularity = 'week' | 'month' | 'quarter';

export type ForecastHorizon = 3 | 6 | 12;

// ── Raw inputs ─────────────────────────────────────────────────────────────

export interface RevenueDataPoint {
  period: string; // ISO date string – start of the period
  revenue: number;
  subscriberCount: number;
  arpu: number;
  churnRate?: number;
}

// ── Core forecast outputs ──────────────────────────────────────────────────

export interface ForecastPoint {
  period: string;
  predictedRevenue: number;
  predictedSubscribers: number;
  lowerBound: number;
  upperBound: number;
  confidence: number;
  model: ForecastModel;
}

export interface TrendAnalysis {
  direction: 'up' | 'down' | 'stable';
  /** R² value for linear fit, 0–1 */
  strength: number;
  /** % change per period */
  growthRate: number;
  hasSeasonality: boolean;
  movingAverage: number[];
  trendLine: number[];
}

// ── Accuracy ───────────────────────────────────────────────────────────────

export interface ForecastAccuracyComparison {
  period: string;
  forecasted: number;
  actual: number;
  absoluteError: number;
  percentageError: number;
}

export interface ForecastAccuracy {
  mae: number;
  mape: number;
  rmse: number;
  rSquared: number;
  comparisons: ForecastAccuracyComparison[];
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export type ForecastAlertType =
  | 'revenue_decline'
  | 'growth_spike'
  | 'high_deviation'
  | 'seasonal_pattern'
  | 'subscriber_churn';

export type ForecastAlertSeverity = 'info' | 'warning' | 'critical';

export interface ForecastAlert {
  type: ForecastAlertType;
  severity: ForecastAlertSeverity;
  title: string;
  message: string;
}

// ── Alert thresholds (customisable) ───────────────────────────────────────

export interface AlertThresholds {
  declinePercent: number;
  growthPercent: number;
  deviationPercent: number;
}

// ── Visualisation ──────────────────────────────────────────────────────────

export interface VizSeriesPoint {
  period: string;
  historical: number | null;
  forecast: number | null;
  lowerBound: number | null;
  upperBound: number | null;
}

export interface ForecastVisualizationData {
  series: VizSeriesPoint[];
  summary: {
    currentMrr: number;
    projectedMrr: number;
    growthRate: number;
    confidenceLevel: number;
  };
}

// ── Full forecast result ───────────────────────────────────────────────────

export interface ForecastResult {
  id: string;
  model: ForecastModel;
  granularity: ForecastGranularity;
  horizon: ForecastHorizon;
  confidence: number;
  generatedAt: string;
  forecasts: ForecastPoint[];
  trend: TrendAnalysis;
  alerts: ForecastAlert[];
  visualization: ForecastVisualizationData;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface ForecastOptions {
  horizon?: ForecastHorizon;
  granularity?: ForecastGranularity;
  model?: ForecastModel;
  confidence?: number;
  alertThresholds?: Partial<AlertThresholds>;
}
