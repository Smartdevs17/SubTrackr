/**
 * Analytics Dashboard REST API
 *
 * Request/response handlers for the cohort retention analytics suite
 * (issue #545), following the ApiResponse<T> convention used elsewhere in
 * the backend (see sandbox/api/sandboxApi.ts and
 * backend/services/notification/webhookManagementApi.ts).
 */

import { CohortService } from './cohortService';
import { getChurnRiskForCohort } from './cohortChurnRiskService';
import { cohortTableToCsv, cohortTableToPdf, ltvBreakdownToCsv } from './cohortReportExport';
import { SubscriberRecordRepository, subscriberRecordRepository } from './subscriberRecordRepository';
import { cohortAggregationJob, CohortAggregationJob } from '../../analytics/jobs/cohortAggregationJob';
import type {
  AnalyticsExportFormat,
  ChurnBreakdown,
  CohortBucket,
  CohortGranularity,
  ChurnRiskSummary,
  LtvSourceBreakdown,
  PlanMigrationFlow,
  RetentionCurvePoint,
} from '../../../src/types/cohortAnalytics';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

const ok = <T>(data: T, message?: string): ApiResponse<T> => ({ success: true, data, message });
const fail = (error: unknown, fallback: string): ApiResponse<never> => ({
  success: false,
  error: error instanceof Error ? error.message : fallback,
});

export class AnalyticsDashboardApi {
  constructor(
    private readonly repository: SubscriberRecordRepository = subscriberRecordRepository,
    private readonly aggregationJob: CohortAggregationJob = cohortAggregationJob
  ) {}

  /** Serves the pre-aggregated nightly cohort table when available, falling back to a live computation. */
  getCohortTable(merchantId: string, granularity: CohortGranularity): ApiResponse<CohortBucket[]> {
    const cached = this.aggregationJob.getCachedCohorts(merchantId, granularity);
    if (cached) return ok(cached, 'Served from nightly cohort_aggregation cache');
    const records = this.repository.getByMerchant(merchantId);
    return ok(CohortService.buildCohortTable(records, granularity), 'Computed live (no cached aggregation yet)');
  }

  getRetentionCurve(merchantId: string): ApiResponse<RetentionCurvePoint[]> {
    const records = this.repository.getByMerchant(merchantId);
    return ok(CohortService.retentionCurve(records));
  }

  getChurnBreakdown(merchantId: string, periodStart: number, periodEnd: number): ApiResponse<ChurnBreakdown> {
    const records = this.repository.getByMerchant(merchantId);
    return ok(CohortService.revenueChurnVsLogoChurn(records, periodStart, periodEnd));
  }

  getPlanMigrationFlows(
    merchantId: string,
    periodStart: number,
    periodEnd: number,
    planPriceById?: Record<string, number>
  ): ApiResponse<PlanMigrationFlow[]> {
    const records = this.repository.getByMerchant(merchantId);
    return ok(CohortService.planMigrationFlows(records, periodStart, periodEnd, planPriceById));
  }

  getLtvByAcquisitionSource(merchantId: string): ApiResponse<LtvSourceBreakdown[]> {
    const records = this.repository.getByMerchant(merchantId);
    return ok(CohortService.ltvByAcquisitionSource(records));
  }

  async getChurnRisk(merchantId: string, cohortKey: string): Promise<ApiResponse<ChurnRiskSummary>> {
    try {
      const records = this.repository.getByMerchant(merchantId);
      return ok(await getChurnRiskForCohort(cohortKey, records));
    } catch (error) {
      return fail(error, 'Failed to compute churn risk');
    }
  }

  exportCohortReport(
    merchantId: string,
    granularity: CohortGranularity,
    format: AnalyticsExportFormat
  ): ApiResponse<{ filename: string; contentType: string; body: string | Buffer }> {
    const records = this.repository.getByMerchant(merchantId);
    const buckets = CohortService.buildCohortTable(records, granularity);

    if (format === 'csv') {
      return ok({
        filename: `cohort-report-${merchantId}-${granularity}.csv`,
        contentType: 'text/csv',
        body: cohortTableToCsv(buckets),
      });
    }

    return ok({
      filename: `cohort-report-${merchantId}-${granularity}.pdf`,
      contentType: 'application/pdf',
      body: cohortTableToPdf(buckets),
    });
  }

  exportLtvReport(merchantId: string): ApiResponse<{ filename: string; contentType: string; body: string }> {
    const records = this.repository.getByMerchant(merchantId);
    return ok({
      filename: `ltv-by-source-${merchantId}.csv`,
      contentType: 'text/csv',
      body: ltvBreakdownToCsv(CohortService.ltvByAcquisitionSource(records)),
    });
  }

  getMrrArrReport(merchantId: string): ApiResponse<{
    mrr: number;
    arr: number;
    arpu: number;
    ltv: number;
    subscriberCount: number;
    activeCount: number;
  }> {
    const records = this.repository.getByMerchant(merchantId);
    const active = records.filter((r) => r.churnedAt === undefined);
    const churned = records.filter((r) => r.churnedAt !== undefined);
    const mrr = active.reduce((sum, r) => sum + r.mrr, 0);
    const arr = mrr * 12;
    const arpu = active.length > 0 ? mrr / active.length : 0;
    const grossChurnRate = records.length > 0 ? churned.length / records.length : 0;
    const ltv = grossChurnRate > 0 ? arpu / grossChurnRate : arpu * 24;
    return ok({
      mrr,
      arr,
      arpu,
      ltv,
      subscriberCount: records.length,
      activeCount: active.length,
    });
  }

  getRevenueForecast(
    merchantId: string,
    model: 'linear' | 'exponential' = 'exponential',
    monthsAhead: number = 3
  ): ApiResponse<{ label: string; expectedRevenue: number; lowerBound: number; upperBound: number }[]> {
    const records = this.repository.getByMerchant(merchantId);
    const active = records.filter((r) => r.churnedAt === undefined);
    const mrr = active.reduce((sum, r) => sum + r.mrr, 0);

    const buckets = CohortService.buildCohortTable(records, 'month');
    const retention = buckets.length
      ? buckets.reduce((sum, b) => sum + b.retentionRate, 0) / buckets.length
      : 0.95;
    const confidenceBand = Math.max(0.1, 1 - Math.min(records.length / 50, 0.8));

    let linearSlope = 0;
    if (model === 'linear' && buckets.length >= 2) {
      const n = buckets.length;
      const sumX = buckets.reduce((sum, _, i) => sum + i, 0);
      const sumY = buckets.reduce((sum, b) => sum + b.currentMrr, 0);
      const sumXY = buckets.reduce((sum, b, i) => sum + i * b.currentMrr, 0);
      const sumXX = buckets.reduce((sum, _, i) => sum + i * i, 0);
      const denominator = n * sumXX - sumX * sumX;
      if (denominator !== 0) {
        linearSlope = (n * sumXY - sumX * sumY) / denominator;
      }
    }

    const forecast = Array.from({ length: monthsAhead }, (_, index) => {
      const monthAhead = index + 1;
      let expectedRevenue = 0;
      if (model === 'linear') {
        expectedRevenue = Math.max(0, mrr + linearSlope * monthAhead);
      } else {
        expectedRevenue = mrr * Math.pow(retention || 0.95, monthAhead);
      }
      return {
        label: `M+${monthAhead}`,
        expectedRevenue,
        lowerBound: expectedRevenue * (1 - confidenceBand),
        upperBound: expectedRevenue * (1 + confidenceBand),
      };
    });

    return ok(forecast);
  }
}

export const analyticsDashboardApi = new AnalyticsDashboardApi();
