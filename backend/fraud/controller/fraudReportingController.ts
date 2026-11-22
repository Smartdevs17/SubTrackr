/**
 * Fraud Reporting REST API (framework-agnostic handler functions)
 *
 * Endpoints:
 *   POST /fraud/report              – generate a full fraud report for a merchant
 *   GET  /fraud/report/:merchantId  – retrieve pre-generated fraud report
 *   GET  /fraud/reports/export      – export fraud report data as CSV
 */

import { fraudAnalyticsService } from '../../services/analytics/fraudAnalyticsService';
import { FraudReport } from '../../../src/types/fraud';

// ── Response helpers ──────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true, data };
}

function err(message: string, status = 400) {
  return { success: false, error: { message }, status };
}

// ── Report formatting ─────────────────────────────────────────────────────────

function reportToCsv(report: FraudReport): string {
  const lines: string[] = [
    '# SubTrackr Fraud Report',
    `# Merchant: ${report.merchantName} (${report.merchantId})`,
    `# Generated: ${new Date().toISOString()}`,
    '',
    'Metric,Value',
    `Total Subscriptions,${report.totalSubscriptions}`,
    `Flagged Subscriptions,${report.flaggedSubscriptions}`,
    `Blocked Subscriptions,${report.blockedSubscriptions}`,
    `Manual Reviews,${report.manualReviewCount}`,
    `Average Risk Score,${report.averageRisk}`,
    `Velocity Alerts,${report.velocityAlerts}`,
    `Anomaly Alerts,${report.anomalyAlerts}`,
    `Chargeback Predictions,${report.chargebackPredictions}`,
    `Geolocation Alerts,${report.geolocationAlerts}`,
    `High Risk Subscribers,${report.highRiskSubscribers}`,
    `Pending Evidence Items,${report.pendingEvidenceCount}`,
    `False Positive Feedback,${report.falsePositiveFeedbackCount}`,
  ];

  if (report.recentCases.length > 0) {
    lines.push('');
    lines.push('# Recent Cases');
    lines.push('CaseId,SubscriptionId,SubscriberId,RiskScore,Action,Status,Reason,CreatedAt');
    for (const c of report.recentCases) {
      const row = [
        c.caseId,
        c.subscriptionId,
        c.subscriberId,
        c.riskScore.toString(),
        c.action,
        c.status,
        `"${c.reason.replace(/"/g, '""')}"`,
        c.createdAt,
      ].join(',');
      lines.push(row);
    }
  }

  return lines.join('\n');
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * POST /fraud/report  – body: { merchantId: string }
 * Generates and returns a full fraud report for the given merchant.
 */
export function generateReport(body: { merchantId?: string }) {
  if (!body.merchantId || body.merchantId.trim() === '') {
    return err('merchantId is required');
  }
  const report = fraudAnalyticsService.generateFraudReport(body.merchantId);
  return ok(report);
}

/**
 * GET /fraud/report/:merchantId
 * Retrieve a pre-generated (or freshly computed) fraud report.
 */
export function getReport(merchantId: string) {
  if (!merchantId || merchantId.trim() === '') {
    return err('merchantId path parameter is required', 400);
  }
  const report = fraudAnalyticsService.generateFraudReport(merchantId);
  return ok(report);
}

/**
 * GET /fraud/reports/export?merchantId=...&format=csv|json
 * Export fraud report in a chosen format (default: csv).
 */
export function exportReport(params: { merchantId?: string; format?: string }) {
  if (!params.merchantId || params.merchantId.trim() === '') {
    return err('merchantId query parameter is required');
  }

  const report = fraudAnalyticsService.generateFraudReport(params.merchantId);
  const format = params.format ?? 'csv';

  if (format === 'csv') {
    return {
      success: true,
      contentType: 'text/csv',
      filename: `fraud-report-${params.merchantId}-${new Date().toISOString().slice(0, 10)}.csv`,
      data: reportToCsv(report),
    };
  }

  if (format === 'json') {
    return {
      success: true,
      contentType: 'application/json',
      filename: `fraud-report-${params.merchantId}-${new Date().toISOString().slice(0, 10)}.json`,
      data: JSON.stringify(report, null, 2),
    };
  }

  return err(`Unsupported format "${format}". Use "csv" or "json".`);
}

/**
 * GET /fraud/reports/summary
 * Multi-merchant fraud dashboard summary.
 */
export function getMultiMerchantSummary() {
  const merchants = fraudAnalyticsService.getTopRiskMerchants(50);
  const summary = merchants.map((m) => ({
    merchantId: m.id,
    merchantName: m.name,
    status: m.status,
    averageRisk: m.averageRisk,
    activeSubscriptions: m.activeSubscriptions,
    blockedSubscriptions: m.blockedSubscriptions,
    monthlyVolume: m.monthlyVolume,
    falsePositiveRate: m.falsePositiveRate,
  }));
  return ok({
    generatedAt: new Date().toISOString(),
    totalMerchants: merchants.length,
    merchants: summary,
  });
}
