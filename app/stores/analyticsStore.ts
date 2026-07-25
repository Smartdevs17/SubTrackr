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

const computeCreditSnapshot = (): CreditMetricSnapshot => {
  const state = useCreditStore.getState();
  const accounts = Object.values(state.accounts);
  let issued = 0;
  let applied = 0;
  let expired = 0;
  let transferredIn = 0;
  let transferredOut = 0;
  let outstandingLots = 0;
  let outstandingBalance = 0;
  let expiring7d = 0;
  let expiring30d = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const acc of accounts) {
    outstandingBalance += acc.balance;
    for (const lot of acc.lots) {
      if (lot.remaining <= 0) continue;
      outstandingLots += 1;
      if (lot.expiresAt) {
        const daysLeft = Math.ceil((lot.expiresAt - nowSec) / 86_400);
        if (daysLeft <= 7) expiring7d += lot.remaining;
        else if (daysLeft <= 30) expiring30d += lot.remaining;
      }
    }
    for (const tx of acc.transactions) {
      if (tx.kind === 'issue') issued += tx.amount;
      else if (tx.kind === 'apply') applied += Math.abs(tx.amount);
      else if (tx.kind === 'expire') expired += Math.abs(tx.amount);
      else if (tx.kind === 'transfer_in') transferredIn += tx.amount;
      else if (tx.kind === 'transfer_out') transferredOut += Math.abs(tx.amount);
    }
  }
  const consumptionRate = issued > 0 ? Math.round((applied / issued) * 100) : 0;
  return {
    outstandingBalance,
    outstandingLots,
    lifetimeIssued: issued,
    lifetimeApplied: applied,
    lifetimeExpired: expired,
    lifetimeTransferredIn: transferredIn,
    lifetimeTransferredOut: transferredOut,
    consumptionRate,
    expiringWithin7d: expiring7d,
    expiringWithin30d: expiring30d,
  };
};

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
  cohortBuckets: CohortBucket[];
  retentionCurve: RetentionCurvePoint[];
  churnBreakdown: ChurnBreakdown | null;
  planMigrationFlows: PlanMigrationFlow[];
  ltvBySource: LtvSourceBreakdown[];
  revenueTrendWithAnomalies: AnomalyFlaggedPoint[];
  creditSnapshot: CreditMetricSnapshot | null;
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
  creditSnapshot: null,

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
      creditSnapshot: computeCreditSnapshot(),
    });
  },

  exportCSV: (subscriptions) => {
    return generateCSV(subscriptions);
  },

  exportCohortCsv: () => cohortTableToCsv(get().cohortBuckets),

  exportCohortPdf: () => cohortTableToPdfText(get().cohortBuckets, 'Cohort Retention Report'),
}));

export type { CreditMetricSnapshot };
