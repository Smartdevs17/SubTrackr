/**
 * Fraud Analytics REST API (framework-agnostic handler functions)
 *
 * Endpoints:
 *   GET  /fraud/analytics/summary         – overall fraud summary
 *   GET  /fraud/analytics/trend           – time-series trend
 *   GET  /fraud/analytics/top-risk        – top risk merchants
 *   GET  /fraud/analytics/signals         – fraud signal breakdown
 *   GET  /fraud/analytics/report/:id      – per-merchant fraud report
 *   GET  /fraud/analytics/recommendations – prevention recommendations
 */

import { fraudAnalyticsService } from '../../services/analytics/fraudAnalyticsService';

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true, data };
}

function err(message: string, status = 400) {
  return { success: false, error: { message }, status };
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /fraud/analytics/summary
 * Query params: merchantId (optional)
 */
export function getFraudSummary(params: { merchantId?: string }) {
  const summary = fraudAnalyticsService.getFraudSummary(params.merchantId);
  return ok(summary);
}

/**
 * GET /fraud/analytics/trend
 * Query params: days (optional, default 30, max 90)
 */
export function getFraudTrend(params: { days?: string }) {
  const days = params.days !== undefined ? parseInt(params.days, 10) : 30;
  if (Number.isNaN(days) || days < 1 || days > 90) {
    return err('days must be a number between 1 and 90');
  }
  return ok(fraudAnalyticsService.getFraudTrend(days));
}

/**
 * GET /fraud/analytics/top-risk
 * Query params: limit (optional, default 10)
 */
export function getTopRiskMerchants(params: { limit?: string }) {
  const limit = params.limit !== undefined ? parseInt(params.limit, 10) : 10;
  if (Number.isNaN(limit) || limit < 1 || limit > 100) {
    return err('limit must be a number between 1 and 100');
  }
  return ok(fraudAnalyticsService.getTopRiskMerchants(limit));
}

/**
 * GET /fraud/analytics/signals
 */
export function getSignalBreakdown() {
  return ok(fraudAnalyticsService.getSignalBreakdown());
}

/**
 * GET /fraud/analytics/report/:merchantId
 */
export function getFraudReport(merchantId: string) {
  if (!merchantId || merchantId.trim() === '') {
    return err('merchantId is required', 400);
  }
  const report = fraudAnalyticsService.generateFraudReport(merchantId);
  return ok(report);
}

/**
 * GET /fraud/analytics/recommendations
 * Query params: merchantId (optional)
 */
export function getPreventionRecommendations(params: { merchantId?: string }) {
  const recs = fraudAnalyticsService.getPreventionRecommendations(params.merchantId);
  return ok(recs);
}
