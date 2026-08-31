/**
 * SubscriptionAnalyticsService
 *
 * Production-ready MRR / ARR / cohort analytics service for the backend layer.
 *
 * This module wraps the pure calculation functions from
 * `src/services/analyticsService.ts` inside a stateful service that:
 *   - Caches the last computed report per merchant
 *   - Exposes a structured HTTP-friendly API surface
 *   - Adds benchmark timing metadata
 *   - Provides a streaming export interface for large datasets
 *
 * All heavy computation stays in the pure functions; this class is a
 * thin orchestration layer so callers don't need to know about implementation
 * details.
 */

import {
  calculateSubscriptionAnalytics,
  calculateRetentionCurve,
  SubscriptionAnalyticsReport,
  CohortMetric,
  ChurnMetrics,
  RevenuePoint,
  RevenueForecastPoint,
  RetentionPoint,
} from '../../../src/services/analyticsService';
import { Subscription, BillingCycle } from '../../../src/types/subscription';

// ── Supporting types ──────────────────────────────────────────────────────────

export interface AnalyticsQuery {
  merchantId: string;
  /** Override the "current" timestamp (useful for back-dating reports). */
  asOf?: Date;
  forecastModel?: 'linear' | 'exponential';
  /** Number of months to project forward. Default 3. */
  forecastMonths?: number;
}

export interface AnalyticsReportEnvelope {
  merchantId: string;
  computedAt: string;
  durationMs: number;
  report: SubscriptionAnalyticsReport;
  retentionCurve: RetentionPoint[];
}

export interface MRRBreakdown {
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnMrr: number;
  netNewMrr: number;
  totalMrr: number;
}

export interface ARRSummary {
  arr: number;
  arrGrowthRate: number;
  impliedMonthlyGrowth: number;
}

export interface CohortSummary {
  totalCohorts: number;
  avgRetentionRate: number;
  bestCohort: CohortMetric | null;
  worstCohort: CohortMetric | null;
  cohorts: CohortMetric[];
}

export interface ChurnSummary extends ChurnMetrics {
  /** Monthly churn rate as a percentage string, e.g. "2.5%" */
  grossChurnPct: string;
  netChurnPct: string;
  /** Estimated months until fully churned at current rate. */
  monthsToZero: number | null;
}

export interface ForecastSummary {
  model: 'linear' | 'exponential';
  months: RevenueForecastPoint[];
  totalExpectedRevenue: number;
  bestCaseRevenue: number;
  worstCaseRevenue: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SubscriptionAnalyticsService {
  /** In-memory cache: merchantId → last computed envelope */
  private cache = new Map<string, AnalyticsReportEnvelope>();

  /**
   * Compute a full analytics report for a merchant's subscription list.
   * Result is cached; call `invalidate(merchantId)` to force recompute.
   */
  compute(
    subscriptions: Subscription[],
    query: AnalyticsQuery
  ): AnalyticsReportEnvelope {
    const start = Date.now();
    const asOf = query.asOf ?? new Date();
    const forecastModel = query.forecastModel ?? 'exponential';
    const forecastMonths = query.forecastMonths ?? 3;

    const report = calculateSubscriptionAnalytics(
      subscriptions,
      asOf,
      forecastModel,
      forecastMonths
    );
    const retentionCurve = calculateRetentionCurve(subscriptions, asOf);

    const envelope: AnalyticsReportEnvelope = {
      merchantId: query.merchantId,
      computedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      report,
      retentionCurve,
    };

    this.cache.set(query.merchantId, envelope);
    return envelope;
  }

  /** Return the cached report, or null when none has been computed yet. */
  getCached(merchantId: string): AnalyticsReportEnvelope | null {
    return this.cache.get(merchantId) ?? null;
  }

  /** Force removal of a cached report so the next call to compute() recalculates. */
  invalidate(merchantId: string): void {
    this.cache.delete(merchantId);
  }

  // ── Derived metrics ─────────────────────────────────────────────────────────

  /**
   * Compute an MRR movement breakdown (new, expansion, contraction, churn).
   * Requires two consecutive snapshots of the subscription list.
   */
  mrrBreakdown(
    prevSubscriptions: Subscription[],
    currSubscriptions: Subscription[],
    asOf = new Date()
  ): MRRBreakdown {
    const prevReport = calculateSubscriptionAnalytics(prevSubscriptions, asOf);
    const currReport = calculateSubscriptionAnalytics(currSubscriptions, asOf);

    const prevIds = new Set(prevSubscriptions.filter((s) => s.isActive).map((s) => s.id));
    const currIds = new Set(currSubscriptions.filter((s) => s.isActive).map((s) => s.id));

    // New MRR: subscriptions in current that were not in previous
    const newMrr = currSubscriptions
      .filter((s) => s.isActive && !prevIds.has(s.id))
      .reduce((sum, s) => sum + this._monthlyRevenue(s), 0);

    // Churn MRR: subscriptions in previous that are no longer active
    const churnMrr = prevSubscriptions
      .filter((s) => s.isActive && !currIds.has(s.id))
      .reduce((sum, s) => sum + this._monthlyRevenue(s), 0);

    // Expansion / contraction: same subscription, price changed
    let expansionMrr = 0;
    let contractionMrr = 0;
    const prevMap = new Map(prevSubscriptions.map((s) => [s.id, s]));
    for (const curr of currSubscriptions.filter((s) => s.isActive)) {
      const prev = prevMap.get(curr.id);
      if (!prev || !prev.isActive) continue;
      const delta = this._monthlyRevenue(curr) - this._monthlyRevenue(prev);
      if (delta > 0) expansionMrr += delta;
      else if (delta < 0) contractionMrr += Math.abs(delta);
    }

    return {
      newMrr: Math.round(newMrr * 100) / 100,
      expansionMrr: Math.round(expansionMrr * 100) / 100,
      contractionMrr: Math.round(contractionMrr * 100) / 100,
      churnMrr: Math.round(churnMrr * 100) / 100,
      netNewMrr: Math.round((newMrr + expansionMrr - contractionMrr - churnMrr) * 100) / 100,
      totalMrr: Math.round(currReport.mrr * 100) / 100,
    };
  }

  /**
   * Produce a concise ARR summary from a full report envelope.
   */
  arrSummary(envelope: AnalyticsReportEnvelope): ARRSummary {
    const { report } = envelope;
    return {
      arr: Math.round(report.arr * 100) / 100,
      arrGrowthRate: Math.round(report.arrGrowthRate * 100) / 100,
      impliedMonthlyGrowth: Math.round((report.arrGrowthRate / 12) * 100) / 100,
    };
  }

  /**
   * Summarize cohort data with best/worst cohort identification.
   */
  cohortSummary(report: SubscriptionAnalyticsReport): CohortSummary {
    const cohorts = report.cohorts;
    if (cohorts.length === 0) {
      return { totalCohorts: 0, avgRetentionRate: 0, bestCohort: null, worstCohort: null, cohorts: [] };
    }

    const avgRetentionRate =
      cohorts.reduce((sum, c) => sum + c.retentionRate, 0) / cohorts.length;

    const sorted = [...cohorts].sort((a, b) => b.retentionRate - a.retentionRate);
    return {
      totalCohorts: cohorts.length,
      avgRetentionRate: Math.round(avgRetentionRate * 10000) / 100, // as percentage
      bestCohort: sorted[0],
      worstCohort: sorted[sorted.length - 1],
      cohorts,
    };
  }

  /**
   * Build a human-readable churn summary with percentage strings.
   */
  churnSummary(report: SubscriptionAnalyticsReport): ChurnSummary {
    const { churn } = report;
    const grossChurnPct = `${(churn.grossChurnRate * 100).toFixed(2)}%`;
    const netChurnPct = `${(churn.netChurnRate * 100).toFixed(2)}%`;
    const monthsToZero =
      churn.grossChurnRate > 0
        ? Math.round(churn.activeSubscriptions / (churn.activeSubscriptions * churn.grossChurnRate))
        : null;

    return {
      ...churn,
      grossChurnPct,
      netChurnPct,
      monthsToZero,
    };
  }

  /**
   * Summarize forecast data with aggregate totals.
   */
  forecastSummary(
    report: SubscriptionAnalyticsReport,
    model: 'linear' | 'exponential' = 'exponential'
  ): ForecastSummary {
    const months = report.forecast;
    const totalExpectedRevenue = months.reduce((sum, m) => sum + m.expectedRevenue, 0);
    const bestCaseRevenue = months.reduce((sum, m) => sum + m.upperBound, 0);
    const worstCaseRevenue = months.reduce((sum, m) => sum + m.lowerBound, 0);

    return {
      model,
      months,
      totalExpectedRevenue: Math.round(totalExpectedRevenue * 100) / 100,
      bestCaseRevenue: Math.round(bestCaseRevenue * 100) / 100,
      worstCaseRevenue: Math.round(worstCaseRevenue * 100) / 100,
    };
  }

  /**
   * Revenue trend for the last N months as [{ label, mrr, arr }].
   * Convenience accessor over `report.revenueTrend`.
   */
  revenueTrend(report: SubscriptionAnalyticsReport, months = 6): RevenuePoint[] {
    return report.revenueTrend.slice(-months);
  }

  // ── CSV export ──────────────────────────────────────────────────────────────

  /**
   * Export a full analytics report as a CSV string.
   * Suitable for streaming to an HTTP response or saving to S3.
   */
  exportCsv(envelope: AnalyticsReportEnvelope): string {
    const { report, merchantId, computedAt } = envelope;
    const lines: string[] = [];
    lines.push(`SubTrackr Analytics Report`);
    lines.push(`Merchant ID,${merchantId}`);
    lines.push(`Generated At,${computedAt}`);
    lines.push('');
    lines.push('KEY METRICS');
    lines.push(`MRR,${report.mrr.toFixed(2)}`);
    lines.push(`ARR,${report.arr.toFixed(2)}`);
    lines.push(`MRR Growth Rate (%),${report.mrrGrowthRate.toFixed(2)}`);
    lines.push(`ARR Growth Rate (%),${report.arrGrowthRate.toFixed(2)}`);
    lines.push(`ARPU,${report.arpu.toFixed(2)}`);
    lines.push(`LTV,${report.ltv.toFixed(2)}`);
    lines.push(`Active Subscribers,${report.subscriberCount}`);
    lines.push(`Gross Churn Rate (%),${(report.churn.grossChurnRate * 100).toFixed(2)}`);
    lines.push(`Net Churn Rate (%),${(report.churn.netChurnRate * 100).toFixed(2)}`);
    lines.push('');
    lines.push('REVENUE TREND');
    lines.push('Month,MRR,ARR');
    for (const point of report.revenueTrend) {
      lines.push(`${point.label},${point.mrr.toFixed(2)},${point.arr.toFixed(2)}`);
    }
    lines.push('');
    lines.push('COHORT ANALYSIS');
    lines.push('Cohort,Subscriptions Started,Active,Retention Rate (%),Revenue');
    for (const c of report.cohorts) {
      lines.push(
        `${c.cohort},${c.subscriptionsStarted},${c.activeSubscriptions},${(c.retentionRate * 100).toFixed(1)},${c.revenue.toFixed(2)}`
      );
    }
    lines.push('');
    lines.push('FORECAST');
    lines.push('Period,Expected Revenue,Lower Bound,Upper Bound');
    for (const f of report.forecast) {
      lines.push(
        `${f.label},${f.expectedRevenue.toFixed(2)},${f.lowerBound.toFixed(2)},${f.upperBound.toFixed(2)}`
      );
    }
    return lines.join('\n');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _monthlyRevenue(sub: Subscription): number {
    // Normalise any billing cycle to monthly revenue
    if (sub.billingCycle === BillingCycle.YEARLY) return sub.price / 12;
    if (sub.billingCycle === BillingCycle.WEEKLY) return sub.price * 4.345;
    return sub.price;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const subscriptionAnalyticsService = new SubscriptionAnalyticsService();
