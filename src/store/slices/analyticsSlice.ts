/**
 * analyticsSlice.ts — Subscription & cohort analytics dashboard slice (slices).
 *
 * Migrated from app/stores/analyticsStore.ts (Issue #944). Computes the
 * subscription analytics report plus cohort retention, churn, migration and
 * LTV views, and a credit-usage snapshot derived from the credit slice living
 * on the same combined store (previously read from the standalone
 * useCreditStore).
 */

import { SliceCreator } from './types';
import type { AppState } from './state';
import {
  calculateSubscriptionAnalytics,
  SubscriptionAnalyticsReport,
} from '../../services/analyticsService';
import { BillingCycle, Subscription } from '../../types/subscription';
import { generateCSV } from '../../utils/importExport';
import { CohortService } from '../../../backend/services/analytics/cohortService';
import { cohortTableToCsv } from '../../../backend/services/analytics/cohortReportExport';
import { cohortTableToPdfText } from '../../services/cohortPdfExport';
import type {
  ChurnBreakdown,
  CohortBucket,
  CohortGranularity,
  LtvSourceBreakdown,
  PlanMigrationFlow,
  RetentionCurvePoint,
  SubscriberRecord,
  AnomalyFlaggedPoint,
} from '../../types/cohortAnalytics';

const DAY_MS = 24 * 60 * 60 * 1_000;
const DAY_S = 24 * 60 * 60;

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

export interface CreditMetricSnapshot {
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

export interface AnalyticsSlice {
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

export type AnalyticsStoreState = AppState;

/** Credit usage snapshot computed from the live credit slice state. */
export const computeCreditSnapshot = (state: AppState): CreditMetricSnapshot | null => {
  const accounts = Object.values(state.accounts);
  const now = state.now();

  let outstandingBalance = 0;
  let outstandingLots = 0;
  let lifetimeIssued = 0;
  let lifetimeApplied = 0;
  let lifetimeExpired = 0;
  let lifetimeTransferredIn = 0;
  let lifetimeTransferredOut = 0;
  let expiringWithin7d = 0;
  let expiringWithin30d = 0;

  for (const account of accounts) {
    outstandingBalance += account.balance;

    for (const lot of account.lots) {
      const expired = lot.expiresAt !== undefined && lot.expiresAt <= now;
      if (lot.remaining > 0 && !expired) {
        outstandingLots += 1;
        if (lot.expiresAt !== undefined) {
          const daysLeft = (lot.expiresAt - now) / DAY_S;
          if (daysLeft <= 30) expiringWithin30d += 1;
          if (daysLeft <= 7) expiringWithin7d += 1;
        }
      }
    }

    for (const tx of account.transactions) {
      switch (tx.kind) {
        case 'issue':
          lifetimeIssued += Math.abs(tx.amount);
          break;
        case 'apply':
          lifetimeApplied += Math.abs(tx.amount);
          break;
        case 'expire':
          lifetimeExpired += Math.abs(tx.amount);
          break;
        case 'transfer_in':
          lifetimeTransferredIn += Math.abs(tx.amount);
          break;
        case 'transfer_out':
          lifetimeTransferredOut += Math.abs(tx.amount);
          break;
      }
    }
  }

  return {
    outstandingBalance,
    outstandingLots,
    lifetimeIssued,
    lifetimeApplied,
    lifetimeExpired,
    lifetimeTransferredIn,
    lifetimeTransferredOut,
    consumptionRate:
      lifetimeIssued === 0 ? 0 : Math.round((lifetimeApplied / lifetimeIssued) * 100),
    expiringWithin7d,
    expiringWithin30d,
  };
};

export const createAnalyticsSlice: SliceCreator<AnalyticsSlice> = (set, get) => ({
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
      creditSnapshot: computeCreditSnapshot(get()),
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
});
