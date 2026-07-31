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
import { useCreditStore } from './creditStore';

const DAY_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_WIDGETS = [
  'overview',
  'revenueTrend',
  'cohortHeatmap',
  'churnBreakdown',
  'forecast',
  'planMigrations',
];

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

interface CreditMetricSnapshot {
  outstandingBalance: number;
  outstandingLots: number;
  lifetimeIssued: number;
  lifetimeApplied: number;
  lifetimeExpired: number;
  lifetimeTransferredIn: number;
  lifetimeTransferredOut: number;
  /** 0-100 integer; issuance-to-application conversion. */
  consumptionRate: number;
  /** Lots expiring within 7 / 30 days. */
  expiringWithin7d: number;
  expiringWithin30d: number;
}

interface AnalyticsStoreState {
  report: SubscriptionAnalyticsReport | null;
  granularity: CohortGranularity;
  forecastModel: 'linear' | 'exponential';
  enabledWidgets: string[];
  widgetOrder: string[];
  cohortBuckets: CohortBucket[];
  retentionCurve: RetentionCurvePoint[];
  churnBreakdown: ChurnBreakdown | null;
  planMigrationFlows: PlanMigrationFlow[];
  ltvBySource: LtvSourceBreakdown[];
  revenueTrendWithAnomalies: AnomalyFlaggedPoint[];
  creditSnapshot: CreditMetricSnapshot | null;
  setGranularity: (granularity: CohortGranularity) => void;
  setForecastModel: (model: 'linear' | 'exponential') => void;
  toggleWidget: (widgetId: string) => void;
  reorderWidgets: (newOrder: string[]) => void;
  resetWidgetConfig: () => void;
  compute: (subscriptions: Subscription[]) => void;
  exportCSV: (subscriptions: Subscription[]) => string;
  exportCohortCsv: () => string;
  exportCohortPdf: () => string;
  exportSummaryCsv: () => string;
  exportSummaryText: () => string;
}

export const useAnalyticsStore = create<AnalyticsStoreState>()((set, get) => ({
  report: null,
  granularity: 'month',
  forecastModel: 'exponential',
  enabledWidgets: [...DEFAULT_WIDGETS],
  widgetOrder: [...DEFAULT_WIDGETS],
  cohortBuckets: [],
  retentionCurve: [],
  churnBreakdown: null,
  planMigrationFlows: [],
  ltvBySource: [],
  revenueTrendWithAnomalies: [],
  creditSnapshot: null,

  setGranularity: (granularity) => {
    set({ granularity });
  },

  setForecastModel: (forecastModel) => {
    set({ forecastModel });
  },

  toggleWidget: (widgetId) => {
    const { enabledWidgets } = get();
    const isEnabled = enabledWidgets.includes(widgetId);
    if (isEnabled && enabledWidgets.length <= 1) return; // Prevent disabling all widgets
    const updated = isEnabled
      ? enabledWidgets.filter((id) => id !== widgetId)
      : [...enabledWidgets, widgetId];
    set({ enabledWidgets: updated });
  },

  reorderWidgets: (newOrder) => {
    set({ widgetOrder: newOrder });
  },

  resetWidgetConfig: () => {
    set({ enabledWidgets: [...DEFAULT_WIDGETS], widgetOrder: [...DEFAULT_WIDGETS] });
  },

  compute: (subscriptions) => {
    const { granularity, forecastModel } = get();
    const report = calculateSubscriptionAnalytics(subscriptions, new Date(), forecastModel, 3);
    const records = toSubscriberRecords(subscriptions);
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
      creditSnapshot: computeCreditSnapshot(),
    });
  },

  exportCSV: (subscriptions) => {
    return generateCSV(subscriptions);
  },

  exportCohortCsv: () => cohortTableToCsv(get().cohortBuckets),

  exportCohortPdf: () => cohortTableToPdfText(get().cohortBuckets, 'Cohort Retention Report'),

  exportSummaryCsv: () => {
    const { report, forecastModel } = get();
    if (!report) return '';
    const headers = ['Metric', 'Value'];
    const rows = [
      ['MRR', report.mrr.toFixed(2)],
      ['ARR', report.arr.toFixed(2)],
      ['MRR Growth Rate (%)', report.mrrGrowthRate.toFixed(2)],
      ['ARR Growth Rate (%)', report.arrGrowthRate.toFixed(2)],
      ['ARPU', report.arpu.toFixed(2)],
      ['LTV', report.ltv.toFixed(2)],
      ['Active Subscribers', report.subscriberCount.toString()],
      ['Gross Churn Rate (%)', (report.churn.grossChurnRate * 100).toFixed(2)],
      ['Net Churn Rate (%)', (report.churn.netChurnRate * 100).toFixed(2)],
      ['Forecast Model', forecastModel],
    ];
    report.forecast.forEach((f) => {
      rows.push([`Forecast ${f.label} (Expected Revenue)`, f.expectedRevenue.toFixed(2)]);
    });
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  },

  exportSummaryText: () => {
    const { report, forecastModel } = get();
    if (!report) return 'No analytics computed yet.';
    return [
      '========================================',
      '     SUBTRACKR ANALYTICS SUMMARY        ',
      '========================================',
      `Active MRR:           $${report.mrr.toFixed(2)} (${report.mrrGrowthRate >= 0 ? '+' : ''}${report.mrrGrowthRate.toFixed(1)}% MoM)`,
      `Active ARR:           $${report.arr.toFixed(2)} (${report.arrGrowthRate >= 0 ? '+' : ''}${report.arrGrowthRate.toFixed(1)}% YoY)`,
      `ARPU:                 $${report.arpu.toFixed(2)}`,
      `Customer LTV:         $${report.ltv.toFixed(2)}`,
      `Active Subscribers:   ${report.subscriberCount}`,
      `Gross Churn Rate:     ${(report.churn.grossChurnRate * 100).toFixed(1)}%`,
      `Net Churn Rate:       ${(report.churn.netChurnRate * 100).toFixed(1)}%`,
      '----------------------------------------',
      `Revenue Forecast (${forecastModel.toUpperCase()} MODEL):`,
      ...report.forecast.map(
        (f) =>
          `  - ${f.label}: $${f.expectedRevenue.toFixed(2)} (Range: $${f.lowerBound.toFixed(2)} - $${f.upperBound.toFixed(2)})`
      ),
      '========================================',
    ].join('\n');
  },
}));

export type { CreditMetricSnapshot };
