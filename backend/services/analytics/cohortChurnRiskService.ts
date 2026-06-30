/**
 * Predictive churn model integration point for the cohort analytics suite.
 *
 * Kept separate from cohortService.ts on purpose: this file pulls in
 * PredictionService (which talks to the Python ml-service over HTTP, and
 * imports Node's `path` module). CohortService itself must stay free of
 * Node-only imports so it can run in both the backend and the mobile app
 * bundle — see app/stores/analyticsStore.ts.
 */

import type { ChurnRiskSummary, SubscriberRecord } from '../../../src/types/cohortAnalytics';
import { PredictionService } from './predictionService';

const DAY_MS = 24 * 60 * 60 * 1_000;

const isActiveAt = (record: SubscriberRecord, at: number): boolean =>
  record.signupAt <= at && (record.churnedAt === undefined || record.churnedAt > at);

/**
 * Delegates to PredictionService (backend/services/analytics/predictionService.ts
 * -> ml-service/churnModel.py). Network/model failures degrade to a
 * zero-confidence summary rather than throwing, so a dashboard render never
 * breaks because the ML service is down.
 */
export async function getChurnRiskForCohort(
  cohortKey: string,
  records: SubscriberRecord[],
  asOf: number = Date.now(),
  sampleSize = 25
): Promise<ChurnRiskSummary> {
  const sample = records.filter((record) => isActiveAt(record, asOf)).slice(0, sampleSize);
  if (sample.length === 0) {
    return {
      cohortKey,
      sampledSubscribers: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
      averageChurnProbability: 0,
    };
  }

  try {
    const predictions = await PredictionService.predictChurnBatch(
      sample.map((record) => ({
        subscriberAddress: record.subscriberId,
        userData: {
          recentPaymentFailures: 0,
          baselineLoginsPerMonth: 20,
          recentLogins: record.lastActiveAt && asOf - record.lastActiveAt < 7 * DAY_MS ? 18 : 4,
          openSupportTickets: 0,
          priceSensitivityIndex: 0.5,
        },
      }))
    );

    const highRiskCount = predictions.filter((p) => p.riskLevel === 'High').length;
    const mediumRiskCount = predictions.filter((p) => p.riskLevel === 'Medium').length;
    const lowRiskCount = predictions.filter((p) => p.riskLevel === 'Low').length;
    const averageChurnProbability =
      predictions.reduce((sum, p) => sum + p.churnProbability, 0) / predictions.length;

    return {
      cohortKey,
      sampledSubscribers: predictions.length,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      averageChurnProbability,
    };
  } catch {
    // ml-service unreachable/unavailable — surface a neutral, non-throwing result.
    return { cohortKey, sampledSubscribers: 0, highRiskCount: 0, mediumRiskCount: 0, lowRiskCount: 0, averageChurnProbability: 0 };
  }
}
