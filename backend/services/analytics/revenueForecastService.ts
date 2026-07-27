/**
 * Issue #774 – Subscription Analytics with Revenue Forecasting
 *
 * Provides:
 *   - Revenue forecasting models
 *   - Trend analysis
 *   - Forecast accuracy tracking
 *   - Forecast visualization data
 */

import { logger } from '../../shared/logging';

// ── Types ────────────────────────────────────────────────────────────────────

export type ForecastGranularity = 'hour' | 'day' | 'week' | 'month';

export type TrendDirection = 'up' | 'down' | 'stable';

export type ForecastModel = 'linear' | 'exponential' | 'moving_average' | 'seasonal';

export interface RevenueDataPoint {
  /** Period identifier (ISO timestamp or formatted period) */
  period: string;
  /** Revenue amount */
  revenue: number;
  /** Number of subscribers */
  subscriberCount: number;
  /** Average revenue per user */
  arpu: number;
  /** New subscribers */
  newSubscribers: number;
  /** Churned subscribers */
  churnedSubscribers: number;
  /** MRR (Monthly Recurring Revenue) */
  mrr: number;
  /** ARR (Annual Recurring Revenue) */
  arr: number;
}

export interface ForecastPoint {
  /** Period identifier */
  period: string;
  /** Predicted revenue */
  predictedRevenue: number;
  /** Lower confidence bound */
  lowerBound: number;
  /** Upper confidence bound */
  upperBound: number;
  /** Confidence level (0-1) */
  confidence: number;
  /** Model used */
  model: ForecastModel;
}

export interface TrendAnalysis {
  /** Overall trend direction */
  direction: TrendDirection;
  /** Trend strength (0-1) */
  strength: number;
  /** Growth rate (percentage) */
  growthRate: number;
  /** Seasonality detected */
  hasSeasonality: boolean;
  /** Seasonal period (if detected) */
  seasonalPeriod?: number;
  /** Moving average values */
  movingAverage: number[];
  /** Trend line values */
  trendLine: number[];
}

export interface ForecastAccuracy {
  /** Mean Absolute Error */
  mae: number;
  /** Mean Absolute Percentage Error */
  mape: number;
  /** Root Mean Squared Error */
  rmse: number;
  /** R-squared */
  rSquared: number;
  /** Forecast vs actual comparison */
  comparisons: Array<{
    period: string;
    predicted: number;
    actual: number;
    error: number;
    errorPercentage: number;
  }>;
}

export interface RevenueForecastResult {
  /** Forecast points */
  forecasts: ForecastPoint[];
  /** Trend analysis */
  trend: TrendAnalysis;
  /** Historical data used */
  historicalData: RevenueDataPoint[];
  /** Model used */
  model: ForecastModel;
  /** Forecast accuracy (if actuals available) */
  accuracy?: ForecastAccuracy;
  /** Period granularity */
  granularity: ForecastGranularity;
  /** Timestamp of forecast generation */
  generatedAt: string;
}

export interface ForecastVisualizationData {
  /** Combined historical and forecast data for charting */
  series: Array<{
    period: string;
    historical: number | null;
    forecast: number | null;
    lowerBound: number | null;
    upperBound: number | null;
    isForecast: boolean;
  }>;
  /** Summary statistics */
  summary: {
    currentMrr: number;
    projectedMrr: number;
    growthRate: number;
    confidenceLevel: number;
  };
}

// ── Forecasting Models ───────────────────────────────────────────────────────

/**
 * Simple linear regression forecast.
 */
function linearForecast(
  historical: number[],
  horizon: number,
  confidence: number = 0.95
): ForecastPoint[] {
  const n = historical.length;
  if (n < 2) return [];

  // Calculate slope and intercept
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += historical[i];
    sumXY += i * historical[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate standard error
  const residuals = historical.map((y, i) => y - (intercept + slope * i));
  const mse = residuals.reduce((sum, r) => sum + r * r, 0) / (n - 2);
  const se = Math.sqrt(mse);

  // Z-score for confidence level
  const zScore = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.645;

  const forecasts: ForecastPoint[] = [];
  for (let i = 0; i < horizon; i++) {
    const x = n + i;
    const predicted = intercept + slope * x;
    const margin = zScore * se * Math.sqrt(1 + 1/n + Math.pow(x - sumX/n, 2) / (sumX2 - sumX*sumX/n));

    forecasts.push({
      period: `period-${x}`,
      predictedRevenue: Math.max(0, predicted),
      lowerBound: Math.max(0, predicted - margin),
      upperBound: predicted + margin,
      confidence,
      model: 'linear',
    });
  }

  return forecasts;
}

/**
 * Exponential smoothing forecast.
 */
function exponentialForecast(
  historical: number[],
  horizon: number,
  alpha: number = 0.3,
  confidence: number = 0.95
): ForecastPoint[] {
  if (historical.length < 2) return [];

  // Simple exponential smoothing
  let smoothed = historical[0];
  const smoothedValues = [smoothed];

  for (let i = 1; i < historical.length; i++) {
    smoothed = alpha * historical[i] + (1 - alpha) * smoothed;
    smoothedValues.push(smoothed);
  }

  // Calculate error variance
  const errors = historical.map((y, i) => y - smoothedValues[i]);
  const mse = errors.reduce((sum, e) => sum + e * e, 0) / historical.length;
  const se = Math.sqrt(mse);

  const zScore = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.645;

  const forecasts: ForecastPoint[] = [];
  for (let i = 0; i < horizon; i++) {
    const predicted = smoothed;
    const margin = zScore * se * Math.sqrt(i + 1);

    forecasts.push({
      period: `period-${historical.length + i}`,
      predictedRevenue: Math.max(0, predicted),
      lowerBound: Math.max(0, predicted - margin),
      upperBound: predicted + margin,
      confidence,
      model: 'exponential',
    });
  }

  return forecasts;
}

/**
 * Moving average forecast.
 */
function movingAverageForecast(
  historical: number[],
  horizon: number,
  windowSize: number = 3,
  confidence: number = 0.95
): ForecastPoint[] {
  if (historical.length < windowSize) return [];

  // Calculate moving averages
  const movingAvgs: number[] = [];
  for (let i = windowSize - 1; i < historical.length; i++) {
    const window = historical.slice(i - windowSize + 1, i + 1);
    movingAvgs.push(window.reduce((a, b) => a + b, 0) / windowSize);
  }

  // Calculate error
  const errors = movingAvgs.map((ma, i) => historical[i + windowSize - 1] - ma);
  const mse = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
  const se = Math.sqrt(mse);

  const zScore = confidence === 0.95 ? 1.96 : confidence === 0.99 ? 2.576 : 1.645;

  const lastAvg = movingAvgs[movingAvgs.length - 1];

  const forecasts: ForecastPoint[] = [];
  for (let i = 0; i < horizon; i++) {
    const predicted = lastAvg;
    const margin = zScore * se * Math.sqrt(i + 1);

    forecasts.push({
      period: `period-${historical.length + i}`,
      predictedRevenue: Math.max(0, predicted),
      lowerBound: Math.max(0, predicted - margin),
      upperBound: predicted + margin,
      confidence,
      model: 'moving_average',
    });
  }

  return forecasts;
}

// ── Trend Analysis ───────────────────────────────────────────────────────────

/**
 * Analyze revenue trend from historical data.
 */
export function analyzeTrend(data: RevenueDataPoint[]): TrendAnalysis {
  if (data.length < 2) {
    return {
      direction: 'stable',
      strength: 0,
      growthRate: 0,
      hasSeasonality: false,
      movingAverage: [],
      trendLine: [],
    };
  }

  const revenues = data.map((d) => d.revenue);
  const n = revenues.length;

  // Simple linear trend
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += revenues[i];
    sumXY += i * revenues[i];
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate growth rate
  const firstRevenue = revenues[0];
  const lastRevenue = revenues[n - 1];
  const growthRate = firstRevenue > 0
    ? ((lastRevenue - firstRevenue) / firstRevenue) * 100
    : 0;

  // Determine direction
  const direction: TrendDirection = slope > 0.01 * firstRevenue
    ? 'up'
    : slope < -0.01 * firstRevenue
    ? 'down'
    : 'stable';

  // Calculate trend strength (R²)
  const mean = sumY / n;
  const ssTotal = revenues.reduce((sum, y) => sum + Math.pow(y - mean, 2), 0);
  const ssResidual = revenues.reduce((sum, y, i) => {
    const predicted = intercept + slope * i;
    return sum + Math.pow(y - predicted, 2);
  }, 0);
  const strength = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  // Simple seasonality detection (check for periodic patterns)
  const hasSeasonality = detectSeasonality(revenues);

  // Calculate moving average
  const windowSize = Math.min(3, n);
  const movingAverage: number[] = [];
  for (let i = windowSize - 1; i < n; i++) {
    const window = revenues.slice(i - windowSize + 1, i + 1);
    movingAverage.push(window.reduce((a, b) => a + b, 0) / windowSize);
  }

  // Calculate trend line
  const trendLine = revenues.map((_, i) => intercept + slope * i);

  return {
    direction,
    strength: Math.max(0, Math.min(1, strength)),
    growthRate,
    hasSeasonality,
    movingAverage,
    trendLine,
  };
}

/**
 * Simple seasonality detection.
 */
function detectSeasonality(data: number[]): boolean {
  if (data.length < 8) return false;

  // Check for 7-period (weekly) and 12-period (monthly) patterns
  const periods = [7, 12, 4];

  for (const period of periods) {
    if (data.length < period * 2) continue;

    const correlations: number[] = [];
    for (let lag = 1; lag <= period; lag++) {
      let sum = 0;
      let count = 0;
      for (let i = lag; i < data.length; i++) {
        sum += data[i] * data[i - lag];
        count++;
      }
      correlations.push(count > 0 ? sum / count : 0);
    }

    // Check if any lag shows strong correlation
    const maxCorr = Math.max(...correlations);
    const avgCorr = correlations.reduce((a, b) => a + b, 0) / correlations.length;

    if (maxCorr > avgCorr * 1.5 && maxCorr > 0) {
      return true;
    }
  }

  return false;
}

// ── Forecast Accuracy ────────────────────────────────────────────────────────

/**
 * Calculate forecast accuracy metrics.
 */
export function calculateAccuracy(
  forecasts: ForecastPoint[],
  actuals: RevenueDataPoint[]
): ForecastAccuracy {
  const comparisons: ForecastAccuracy['comparisons'] = [];
  let sumAbsError = 0;
  let sumAbsPercentError = 0;
  let sumSquaredError = 0;

  for (let i = 0; i < Math.min(forecasts.length, actuals.length); i++) {
    const predicted = forecasts[i].predictedRevenue;
    const actual = actuals[i].revenue;
    const error = predicted - actual;
    const errorPercentage = actual > 0 ? Math.abs(error / actual) * 100 : 0;

    comparisons.push({
      period: forecasts[i].period,
      predicted,
      actual,
      error,
      errorPercentage,
    });

    sumAbsError += Math.abs(error);
    sumAbsPercentError += errorPercentage;
    sumSquaredError += error * error;
  }

  const n = comparisons.length;
  const mae = n > 0 ? sumAbsError / n : 0;
  const mape = n > 0 ? sumAbsPercentError / n : 0;
  const rmse = n > 0 ? Math.sqrt(sumSquaredError / n) : 0;

  // R-squared
  const actualMean = actuals.slice(0, n).reduce((sum, a) => sum + a.revenue, 0) / n;
  const ssTotal = actuals.slice(0, n).reduce((sum, a) => sum + Math.pow(a.revenue - actualMean, 2), 0);
  const rSquared = ssTotal > 0 ? 1 - sumSquaredError / ssTotal : 0;

  return {
    mae,
    mape,
    rmse,
    rSquared: Math.max(0, Math.min(1, rSquared)),
    comparisons,
  };
}

// ── Visualization Data ───────────────────────────────────────────────────────

/**
 * Generate visualization data combining historical and forecast.
 */
export function generateVisualizationData(
  historical: RevenueDataPoint[],
  forecasts: ForecastPoint[],
  confidence: number = 0.95
): ForecastVisualizationData {
  const historicalSeries = historical.map((d) => ({
    period: d.period,
    historical: d.revenue,
    forecast: null,
    lowerBound: null,
    upperBound: null,
    isForecast: false,
  }));

  const forecastSeries = forecasts.map((f) => ({
    period: f.period,
    historical: null,
    forecast: f.predictedRevenue,
    lowerBound: f.lowerBound,
    upperBound: f.upperBound,
    isForecast: true,
  }));

  const currentMrr = historical.length > 0 ? historical[historical.length - 1].mrr : 0;
  const projectedMrr = forecasts.length > 0 ? forecasts[0].predictedRevenue : 0;

  const growthRate = currentMrr > 0
    ? ((projectedMrr - currentMrr) / currentMrr) * 100
    : 0;

  return {
    series: [...historicalSeries, ...forecastSeries],
    summary: {
      currentMrr,
      projectedMrr,
      growthRate,
      confidenceLevel: confidence,
    },
  };
}

// ── Main Forecast Function ───────────────────────────────────────────────────

/**
 * Generate revenue forecast from historical data.
 */
export function generateRevenueForecast(
  historicalData: RevenueDataPoint[],
  options: {
    horizon?: number;
    granularity?: ForecastGranularity;
    model?: ForecastModel;
    confidence?: number;
  } = {}
): RevenueForecastResult {
  const {
    horizon = 6,
    granularity = 'month',
    model = 'linear',
    confidence = 0.95,
  } = options;

  const revenues = historicalData.map((d) => d.revenue);

  // Select and run forecast model
  let forecasts: ForecastPoint[];
  switch (model) {
    case 'exponential':
      forecasts = exponentialForecast(revenues, horizon, 0.3, confidence);
      break;
    case 'moving_average':
      forecasts = movingAverageForecast(revenues, horizon, 3, confidence);
      break;
    case 'linear':
    default:
      forecasts = linearForecast(revenues, horizon, confidence);
      break;
  }

  // Generate period labels based on granularity
  const lastPeriod = historicalData.length > 0
    ? new Date(historicalData[historicalData.length - 1].period)
    : new Date();

  forecasts = forecasts.map((f, i) => {
    const periodDate = new Date(lastPeriod);
    switch (granularity) {
      case 'hour':
        periodDate.setHours(periodDate.getHours() + i + 1);
        break;
      case 'day':
        periodDate.setDate(periodDate.getDate() + i + 1);
        break;
      case 'week':
        periodDate.setDate(periodDate.getDate() + (i + 1) * 7);
        break;
      case 'month':
      default:
        periodDate.setMonth(periodDate.getMonth() + i + 1);
        break;
    }
    return { ...f, period: periodDate.toISOString() };
  });

  // Analyze trend
  const trend = analyzeTrend(historicalData);

  return {
    forecasts,
    trend,
    historicalData,
    model,
    granularity,
    generatedAt: new Date().toISOString(),
  };
}

// ── Alert Generation ─────────────────────────────────────────────────────────

export interface ForecastAlert {
  id: string;
  type: 'revenue_decline' | 'growth_spike' | 'forecast_deviation' | 'seasonal_pattern';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  threshold: number;
  actualValue: number;
  timestamp: string;
}

/**
 * Generate alerts based on forecast analysis.
 */
export function generateForecastAlerts(
  forecast: RevenueForecastResult,
  thresholds: {
    declinePercent?: number;
    growthPercent?: number;
    deviationPercent?: number;
  } = {}
): ForecastAlert[] {
  const {
    declinePercent = -10,
    growthPercent = 20,
    deviationPercent = 15,
  } = thresholds;

  const alerts: ForecastAlert[] = [];

  // Check for revenue decline trend
  if (forecast.trend.direction === 'down' && forecast.trend.growthRate < declinePercent) {
    alerts.push({
      id: `alert-${Date.now()}-decline`,
      type: 'revenue_decline',
      severity: 'critical',
      title: 'Revenue Decline Detected',
      message: `Revenue is declining at ${forecast.trend.growthRate.toFixed(1)}% per period`,
      threshold: declinePercent,
      actualValue: forecast.trend.growthRate,
      timestamp: new Date().toISOString(),
    });
  }

  // Check for growth spike
  if (forecast.trend.direction === 'up' && forecast.trend.growthRate > growthPercent) {
    alerts.push({
      id: `alert-${Date.now()}-growth`,
      type: 'growth_spike',
      severity: 'info',
      title: 'Strong Growth Detected',
      message: `Revenue is growing at ${forecast.trend.growthRate.toFixed(1)}% per period`,
      threshold: growthPercent,
      actualValue: forecast.trend.growthRate,
      timestamp: new Date().toISOString(),
    });
  }

  // Check forecast confidence
  if (forecast.forecasts.length > 0) {
    const avgWidth = forecast.forecasts.reduce(
      (sum, f) => sum + (f.upperBound - f.lowerBound),
      0
    ) / forecast.forecasts.length;
    const avgPrediction = forecast.forecasts.reduce(
      (sum, f) => sum + f.predictedRevenue,
      0
    ) / forecast.forecasts.length;

    const relativeWidth = avgPrediction > 0 ? (avgWidth / avgPrediction) * 100 : 0;

    if (relativeWidth > deviationPercent) {
      alerts.push({
        id: `alert-${Date.now()}-deviation`,
        type: 'forecast_deviation',
        severity: 'warning',
        title: 'High Forecast Uncertainty',
        message: `Confidence interval width is ${relativeWidth.toFixed(1)}% of predicted value`,
        threshold: deviationPercent,
        actualValue: relativeWidth,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Seasonality alert
  if (forecast.trend.hasSeasonality) {
    alerts.push({
      id: `alert-${Date.now()}-seasonal`,
      type: 'seasonal_pattern',
      severity: 'info',
      title: 'Seasonal Pattern Detected',
      message: 'Revenue shows seasonal patterns. Consider using seasonal forecasting model.',
      threshold: 0,
      actualValue: 0,
      timestamp: new Date().toISOString(),
    });
  }

  return alerts;
}
