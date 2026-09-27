/**
 * Subscription Metrics Forecasting Service (#1232)
 *
 * Pure, stateless forecasting utilities. Supports three models:
 *   - linear          – ordinary least-squares regression
 *   - exponential     – simple exponential smoothing (α = 0.3)
 *   - moving_average  – trailing N-period average
 */

import { Subscription } from '../types/subscription';
import { toMonthlyRevenue } from './analyticsService';
import type {
  AlertThresholds,
  ForecastAccuracy,
  ForecastAlert,
  ForecastGranularity,
  ForecastHorizon,
  ForecastModel,
  ForecastOptions,
  ForecastPoint,
  ForecastResult,
  ForecastVisualizationData,
  RevenueDataPoint,
  TrendAnalysis,
} from '../types/forecasting';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_HORIZON: ForecastHorizon = 6;
const DEFAULT_GRANULARITY: ForecastGranularity = 'month';
const DEFAULT_MODEL: ForecastModel = 'linear';
const DEFAULT_CONFIDENCE = 0.95;
const EXP_ALPHA = 0.3; // exponential smoothing factor
const MA_WINDOW = 3; // moving-average window
const DEFAULT_THRESHOLDS: AlertThresholds = {
  declinePercent: -10,
  growthPercent: 20,
  deviationPercent: 15,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function uuid(): string {
  return `forecast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** ISO period label offset by `n` months from a given YYYY-MM string */
function addMonths(period: string, n: number): string {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Linear regression over [0..n-1] → [y0..yn-1]. Returns { slope, intercept }. */
function linearRegression(values: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, rSquared: 0 };

  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((sum, x, i) => sum + x * values[i], 0);
  const sumXX = xs.reduce((sum, x) => sum + x * x, 0);
  const meanY = sumY / n;

  const denom = n * sumXX - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const ssRes = values.reduce((sum, y, i) => sum + Math.pow(y - (intercept + slope * i), 2), 0);
  const ssTot = values.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  return { slope, intercept, rSquared };
}

/** Simple exponential smoothing. Returns smoothed series. */
function exponentialSmoothing(values: number[], alpha: number = EXP_ALPHA): number[] {
  if (values.length === 0) return [];
  const smoothed: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    smoothed.push(alpha * values[i] + (1 - alpha) * smoothed[i - 1]);
  }
  return smoothed;
}

/** Trailing moving average. Returns the last-window average for forecasting. */
function movingAverageValue(values: number[], window: number = MA_WINDOW): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-Math.min(window, values.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Confidence interval half-width based on std deviation of residuals. */
function confidenceHalfWidth(
  values: number[],
  predicted: number,
  confidence: number
): number {
  if (values.length < 2) return predicted * 0.2;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  // z-score for common confidence levels
  const z = confidence >= 0.99 ? 2.576 : confidence >= 0.95 ? 1.96 : 1.645;
  return z * std;
}

// ── Build historical data from subscriptions ───────────────────────────────

export function buildRevenueDataPoints(subscriptions: Subscription[]): RevenueDataPoint[] {
  const monthMap = new Map<string, { revenue: number; count: number }>();

  for (const sub of subscriptions) {
    const d = new Date(sub.createdAt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthly = toMonthlyRevenue(sub);
    const existing = monthMap.get(key) ?? { revenue: 0, count: 0 };
    monthMap.set(key, {
      revenue: existing.revenue + (sub.isActive ? monthly : 0),
      count: existing.count + (sub.isActive ? 1 : 0),
    });
  }

  return Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, { revenue, count }]) => ({
      period,
      revenue,
      subscriberCount: count,
      arpu: count > 0 ? revenue / count : 0,
    }));
}

// ── Trend analysis ─────────────────────────────────────────────────────────

export function analyzeTrend(data: RevenueDataPoint[]): TrendAnalysis {
  const revenues = data.map((d) => d.revenue);
  const { slope, rSquared } = linearRegression(revenues);
  const ma = exponentialSmoothing(revenues);
  const trendLine = revenues.map((_, i) => {
    const { intercept } = linearRegression(revenues);
    return intercept + slope * i;
  });

  const growthRate =
    revenues.length >= 2 && revenues[0] > 0
      ? ((revenues[revenues.length - 1] - revenues[0]) / revenues[0]) * 100
      : 0;

  // Basic seasonality detection: compare variance within alternating periods
  const hasSeasonality = revenues.length >= 4 && Math.abs(growthRate) < 5 && rSquared < 0.5;

  const direction: TrendAnalysis['direction'] =
    Math.abs(slope) < 1 || rSquared < 0.1
      ? 'stable'
      : slope > 0
      ? 'up'
      : 'down';

  return {
    direction,
    strength: Math.max(0, Math.min(1, rSquared)),
    growthRate: Number(growthRate.toFixed(2)),
    hasSeasonality,
    movingAverage: ma.map((v) => Number(v.toFixed(2))),
    trendLine: trendLine.map((v) => Number(v.toFixed(2))),
  };
}

// ── Forecast generation ────────────────────────────────────────────────────

export function generateRevenueForecast(
  data: RevenueDataPoint[],
  options: ForecastOptions = {}
): ForecastResult {
  const horizon = options.horizon ?? DEFAULT_HORIZON;
  const granularity = options.granularity ?? DEFAULT_GRANULARITY;
  const model = options.model ?? DEFAULT_MODEL;
  const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
  const thresholds: AlertThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.alertThresholds,
  };

  const revenues = data.map((d) => d.revenue);
  const subscribers = data.map((d) => d.subscriberCount);
  const lastPeriod = data.length > 0 ? data[data.length - 1].period : new Date().toISOString().slice(0, 7);
  const halfWidth = confidenceHalfWidth(revenues, revenues[revenues.length - 1] ?? 0, confidence);

  // ── per-model forecasting logic ──────────────────────────────────────────
  let predictRevenue: (step: number) => number;
  let predictSubs: (step: number) => number;

  if (model === 'linear') {
    const rev = linearRegression(revenues);
    const sub = linearRegression(subscribers);
    const nRev = revenues.length;
    const nSub = subscribers.length;
    predictRevenue = (step) => Math.max(0, rev.intercept + rev.slope * (nRev - 1 + step));
    predictSubs = (step) => Math.max(0, sub.intercept + sub.slope * (nSub - 1 + step));
  } else if (model === 'exponential') {
    const smoothedRev = exponentialSmoothing(revenues);
    const smoothedSub = exponentialSmoothing(subscribers);
    const lastSmRev = smoothedRev[smoothedRev.length - 1] ?? 0;
    const lastSmSub = smoothedSub[smoothedSub.length - 1] ?? 0;
    const revGrowth = revenues.length >= 2 && revenues[revenues.length - 2] > 0
      ? (revenues[revenues.length - 1] - revenues[revenues.length - 2]) / revenues[revenues.length - 2]
      : 0;
    const subGrowth = subscribers.length >= 2 && subscribers[subscribers.length - 2] > 0
      ? (subscribers[subscribers.length - 1] - subscribers[subscribers.length - 2]) / subscribers[subscribers.length - 2]
      : 0;
    predictRevenue = (step) => Math.max(0, lastSmRev * Math.pow(1 + revGrowth, step));
    predictSubs = (step) => Math.max(0, lastSmSub * Math.pow(1 + subGrowth, step));
  } else {
    // moving_average
    const maRev = movingAverageValue(revenues);
    const maSub = movingAverageValue(subscribers);
    predictRevenue = () => maRev;
    predictSubs = () => maSub;
  }

  const forecasts: ForecastPoint[] = Array.from({ length: horizon }, (_, i) => {
    const step = i + 1;
    const period = addMonths(lastPeriod, step);
    const predictedRevenue = Number(predictRevenue(step).toFixed(2));
    const predictedSubscribers = Math.round(predictSubs(step));
    return {
      period,
      predictedRevenue,
      predictedSubscribers,
      lowerBound: Number(Math.max(0, predictedRevenue - halfWidth).toFixed(2)),
      upperBound: Number((predictedRevenue + halfWidth).toFixed(2)),
      confidence,
      model,
    };
  });

  const trend = analyzeTrend(data);
  const alerts = generateForecastAlerts({ forecasts, trend } as any, thresholds);
  const visualization = generateVisualizationData(data, forecasts, confidence);

  return {
    id: uuid(),
    model,
    granularity,
    horizon,
    confidence,
    generatedAt: new Date().toISOString(),
    forecasts,
    trend,
    alerts,
    visualization,
  };
}

// ── Accuracy calculation ───────────────────────────────────────────────────

export function calculateAccuracy(
  forecasts: Pick<ForecastPoint, 'period' | 'predictedRevenue'>[],
  actuals: RevenueDataPoint[]
): ForecastAccuracy {
  const actualMap = new Map(actuals.map((a) => [a.period, a.revenue]));

  const comparisons = forecasts
    .filter((f) => actualMap.has(f.period))
    .map((f) => {
      const actual = actualMap.get(f.period)!;
      const absoluteError = Math.abs(f.predictedRevenue - actual);
      const percentageError = actual > 0 ? (absoluteError / actual) * 100 : 0;
      return {
        period: f.period,
        forecasted: f.predictedRevenue,
        actual,
        absoluteError,
        percentageError,
      };
    });

  if (comparisons.length === 0) {
    return { mae: 0, mape: 0, rmse: 0, rSquared: 0, comparisons: [] };
  }

  const mae =
    comparisons.reduce((sum, c) => sum + c.absoluteError, 0) / comparisons.length;
  const mape =
    comparisons.reduce((sum, c) => sum + c.percentageError, 0) / comparisons.length;
  const rmse = Math.sqrt(
    comparisons.reduce((sum, c) => sum + Math.pow(c.absoluteError, 2), 0) /
      comparisons.length
  );

  const actualMean =
    comparisons.reduce((sum, c) => sum + c.actual, 0) / comparisons.length;
  const ssTot = comparisons.reduce((sum, c) => sum + Math.pow(c.actual - actualMean, 2), 0);
  const ssRes = comparisons.reduce((sum, c) => sum + Math.pow(c.actual - c.forecasted, 2), 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 1;

  return {
    mae: Number(mae.toFixed(2)),
    mape: Number(mape.toFixed(2)),
    rmse: Number(rmse.toFixed(2)),
    rSquared: Number(Math.max(0, rSquared).toFixed(4)),
    comparisons,
  };
}

// ── Visualization data ─────────────────────────────────────────────────────

export function generateVisualizationData(
  historical: RevenueDataPoint[],
  forecasts: ForecastPoint[],
  confidence: number = DEFAULT_CONFIDENCE
): ForecastVisualizationData {
  const historicalSeries = historical.map((h) => ({
    period: h.period,
    historical: h.revenue,
    forecast: null,
    lowerBound: null,
    upperBound: null,
  }));

  const forecastSeries = forecasts.map((f) => ({
    period: f.period,
    historical: null,
    forecast: f.predictedRevenue,
    lowerBound: f.lowerBound,
    upperBound: f.upperBound,
  }));

  const currentMrr =
    historical.length > 0 ? historical[historical.length - 1].revenue : 0;
  const projectedMrr =
    forecasts.length > 0 ? forecasts[forecasts.length - 1].predictedRevenue : currentMrr;
  const growthRate =
    currentMrr > 0 ? ((projectedMrr - currentMrr) / currentMrr) * 100 : 0;

  return {
    series: [...historicalSeries, ...forecastSeries],
    summary: {
      currentMrr: Number(currentMrr.toFixed(2)),
      projectedMrr: Number(projectedMrr.toFixed(2)),
      growthRate: Number(growthRate.toFixed(2)),
      confidenceLevel: confidence,
    },
  };
}

// ── Alerts ─────────────────────────────────────────────────────────────────

export function generateForecastAlerts(
  result: Pick<ForecastResult, 'forecasts' | 'trend'>,
  thresholds: Partial<AlertThresholds> = {}
): ForecastAlert[] {
  const merged: AlertThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const alerts: ForecastAlert[] = [];
  const { forecasts, trend } = result;

  // Decline alert
  if (trend.growthRate <= merged.declinePercent) {
    alerts.push({
      type: 'revenue_decline',
      severity: 'critical',
      title: 'Revenue Decline Detected',
      message: `Revenue is declining at ${trend.growthRate.toFixed(1)}% per period.`,
    });
  }

  // Growth spike alert
  if (trend.growthRate >= merged.growthPercent) {
    alerts.push({
      type: 'growth_spike',
      severity: 'info',
      title: 'Significant Growth Detected',
      message: `Revenue is growing at ${trend.growthRate.toFixed(1)}% per period.`,
    });
  }

  // High deviation alert
  if (forecasts.length > 0) {
    const avgDeviation =
      forecasts.reduce((sum, f) => {
        const width = ((f.upperBound - f.lowerBound) / (f.predictedRevenue || 1)) * 100;
        return sum + width;
      }, 0) / forecasts.length;

    if (avgDeviation > merged.deviationPercent) {
      alerts.push({
        type: 'high_deviation',
        severity: 'warning',
        title: 'High Forecast Uncertainty',
        message: `Average confidence interval width is ${avgDeviation.toFixed(1)}%. More historical data improves accuracy.`,
      });
    }
  }

  // Seasonality info
  if (trend.hasSeasonality) {
    alerts.push({
      type: 'seasonal_pattern',
      severity: 'info',
      title: 'Seasonal Pattern Detected',
      message: 'Revenue data shows seasonal patterns that may affect forecast accuracy.',
    });
  }

  return alerts;
}

// ── Auto-select best model (by lowest MAPE if enough data) ─────────────────

export function selectBestModel(data: RevenueDataPoint[]): ForecastModel {
  if (data.length < 6) return 'moving_average';
  if (data.length < 12) return 'exponential';

  const holdout = data.slice(-3);
  const training = data.slice(0, -3);

  const models: ForecastModel[] = ['linear', 'exponential', 'moving_average'];
  let bestModel: ForecastModel = 'linear';
  let bestMape = Infinity;

  for (const model of models) {
    const result = generateRevenueForecast(training, { horizon: 3, model });
    const accuracy = calculateAccuracy(result.forecasts, holdout);
    if (accuracy.mape < bestMape) {
      bestMape = accuracy.mape;
      bestModel = model;
    }
  }

  return bestModel;
}
