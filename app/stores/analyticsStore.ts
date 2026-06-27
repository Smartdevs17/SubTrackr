import { create } from 'zustand';
import {
  calculateSubscriptionAnalytics,
  SubscriptionAnalyticsReport,
} from '../../src/services/analyticsService';
import { BillingCycle, Subscription } from '../../src/types/subscription';
import { generateCSV } from '../../src/utils/importExport';
import { CohortService } from '../../backend/services/analytics/cohortService';
import { cohortTableToCsv } from '../../backend/services/analytics/cohortReportExport';
import { cohortTableToPdfText } from '../../src/services/cohortPdfExport';
import type {
  ChurnBreakdown,
  CohortBucket,
  CohortGranularity,
  LtvSourceBreakdown,
  PlanMigrationFlow,
  RetentionCurvePoint,
  SubscriberRecord,
  AnomalyFlaggedPoint,
} from '../../src/types/cohortAnalytics';

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Adapts the app's personal Subscription model into merchant-style
 * SubscriberRecords so CohortService (built for the merchant analytics
 * platform) can compute cohort/retention/churn/LTV metrics on it. Each
 * tracked subscription stands in for a "subscriber" of this account.
 */
const toSubscriberRecords = (subscriptions: Subscription[]): SubscriberRecord[] =>
  subscriptions.map((subscription) => ({
    subscriberId: subscription.id,
    merchantId: 'self',
    planId: subscription.category,
    planName: subscription.name,
    region: subscription.timezone,
    acquisitionChannel: subscription.isCryptoEnabled ? 'crypto' : 'card',
    signupAt: new Date(subscription.createdAt).getTime(),
    churnedAt: subscription.isActive ? undefined : new Date(subscription.updatedAt).getTime(),
    lastActiveAt: new Date(subscription.updatedAt).getTime(),
    mrr:
      subscription.billingCycle === BillingCycle.YEARLY
        ? subscription.price / 12
        : subscription.billingCycle === BillingCycle.WEEKLY
          ? subscription.price * 4.345
          : subscription.price,
  }));

interface AnalyticsStoreState {
  report: SubscriptionAnalyticsReport | null;
  granularity: CohortGranularity;
  cohortBuckets: CohortBucket[];
  retentionCurve: RetentionCurvePoint[];
  churnBreakdown: ChurnBreakdown | null;
  planMigrationFlows: PlanMigrationFlow[];
  ltvBySource: LtvSourceBreakdown[];
  revenueTrendWithAnomalies: AnomalyFlaggedPoint[];
  setGranularity: (granularity: CohortGranularity) => void;
  compute: (subscriptions: Subscription[]) => void;
  exportCSV: (subscriptions: Subscription[]) => string;
  exportCohortCsv: () => string;
  exportCohortPdf: () => string;
}

export const useAnalyticsStore = create<AnalyticsStoreState>()((set, get) => ({
  report: null,
  granularity: 'month',
  cohortBuckets: [],
  retentionCurve: [],
  churnBreakdown: null,
  planMigrationFlows: [],
  ltvBySource: [],
  revenueTrendWithAnomalies: [],

  setGranularity: (granularity) => {
    set({ granularity });
    // Recompute is cheap (in-memory, no I/O) — callers re-run `compute` with
    // the latest subscriptions list whenever granularity changes.
  },

  compute: (subscriptions) => {
    const report = calculateSubscriptionAnalytics(subscriptions);
    const records = toSubscriberRecords(subscriptions);
    const granularity = get().granularity;
    const now = Date.now();
    const periodStart = now - 30 * DAY_MS;

    set({
      report,
      cohortBuckets: CohortService.buildCohortTable(records, granularity),
      retentionCurve: CohortService.retentionCurve(records),
      churnBreakdown: CohortService.revenueChurnVsLogoChurn(records, periodStart, now),
      planMigrationFlows: CohortService.planMigrationFlows(records, periodStart, now),
      ltvBySource: CohortService.ltvByAcquisitionSource(records),
      revenueTrendWithAnomalies: CohortService.filterAnomalousSpikes(
        report.revenueTrend.map((point) => ({ label: point.label, value: point.mrr }))
      ),
    });
  },

  exportCSV: (subscriptions) => {
    return generateCSV(subscriptions);
  },

  exportCohortCsv: () => cohortTableToCsv(get().cohortBuckets),

  exportCohortPdf: () => cohortTableToPdfText(get().cohortBuckets, 'Cohort Retention Report'),
}));
