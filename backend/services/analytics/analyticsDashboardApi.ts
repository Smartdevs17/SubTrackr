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
}

export const analyticsDashboardApi = new AnalyticsDashboardApi();
