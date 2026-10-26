/**
 * CohortService
 *
 * Builds the cohort tables, churn breakdowns, plan migration flows, and LTV
 * breakdowns required by issue #545 (advanced subscription analytics).
 * Operates on SubscriberRecord[] — see src/types/cohortAnalytics.ts.
 *
 * Deliberately free of Node-only imports (no 'path', 'crypto', Buffer) so it
 * can run both in the backend and inside the mobile app bundle. The
 * predictive-churn ML integration point lives separately in
 * cohortChurnRiskService.ts, which does pull in Node-only deps and is
 * backend-only — see that file for why.
 */

import type {
  AnomalyFlaggedPoint,
  ChurnBreakdown,
  CohortBucket,
  CohortGranularity,
  LtvSourceBreakdown,
  PlanMigrationFlow,
  SubscriberRecord,
} from '../../../src/types/cohortAnalytics';
import { RetentionCalculator } from './retentionCalculator';

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
const FALLBACK_LIFETIME_MONTHS = 24; // used when a segment has no observed churn yet

function startOfUtcDay(timestamp: number): number {
  const d = new Date(timestamp);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** ISO-8601 week number (1-53), Monday-start, matching most analytics tooling. */
function isoWeekKey(timestamp: number): string {
  const date = new Date(startOfUtcDay(timestamp));
  const dayNum = (date.getUTCDay() + 6) % 7; // 0 = Monday
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((date.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function cohortKeyFor(timestamp: number, granularity: CohortGranularity): string {
  return granularity === 'week' ? isoWeekKey(timestamp) : monthKey(timestamp);
}

function periodBoundsFor(timestamp: number, granularity: CohortGranularity): { start: number; end: number } {
  if (granularity === 'month') {
    const d = new Date(timestamp);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    return { start, end };
  }
  const start = startOfUtcDay(timestamp) - ((new Date(timestamp).getUTCDay() + 6) % 7) * DAY_MS;
  return { start, end: start + WEEK_MS };
}

const isActiveAt = (record: SubscriberRecord, at: number): boolean =>
  record.signupAt <= at && (record.churnedAt === undefined || record.churnedAt > at);

export class CohortService {
  /**
   * Groups subscribers into signup cohorts and reports size + retention %.
   * Buckets with no signups (new merchants, gaps in activity) come back with
   * isEmpty: true rather than NaN/divide-by-zero metrics.
   */
  static buildCohortTable(
    records: SubscriberRecord[],
    granularity: CohortGranularity,
    asOf: number = Date.now()
  ): CohortBucket[] {
    const buckets = new Map<string, SubscriberRecord[]>();
    for (const record of records) {
      const key = cohortKeyFor(record.signupAt, granularity);
      const bucket = buckets.get(key) ?? [];
      bucket.push(record);
      buckets.set(key, bucket);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cohortKey, cohortRecords]) => {
        const { start, end } = periodBoundsFor(cohortRecords[0].signupAt, granularity);
        const activeCount = cohortRecords.filter((record) => isActiveAt(record, asOf)).length;
        const startingMrr = cohortRecords.reduce((sum, record) => sum + record.mrr, 0);
        const currentMrr = cohortRecords
          .filter((record) => isActiveAt(record, asOf))
          .reduce((sum, record) => sum + record.mrr, 0);

        return {
          cohortKey,
          granularity,
          periodStart: start,
          periodEnd: end,
          size: cohortRecords.length,
          activeCount,
          retentionRate: cohortRecords.length ? activeCount / cohortRecords.length : 0,
          startingMrr,
          currentMrr,
          isEmpty: cohortRecords.length === 0,
        };
      });
  }

  static retentionCurve(records: SubscriberRecord[], asOf: number = Date.now()) {
    return RetentionCalculator.retentionCurve(records, asOf);
  }

  /** Logo churn (subscriber count) vs. revenue churn (MRR) for a period — these diverge when big accounts churn. */
  static revenueChurnVsLogoChurn(
    records: SubscriberRecord[],
    periodStart: number,
    periodEnd: number
  ): ChurnBreakdown {
    const startingCohort = records.filter((record) => isActiveAt(record, periodStart));
    const churned = startingCohort.filter(
      (record) => record.churnedAt !== undefined && record.churnedAt >= periodStart && record.churnedAt < periodEnd
    );
    const startingMrr = startingCohort.reduce((sum, record) => sum + record.mrr, 0);
    const churnedMrr = churned.reduce((sum, record) => sum + record.mrr, 0);

    return {
      periodStart,
      periodEnd,
      startingSubscribers: startingCohort.length,
      churnedSubscribers: churned.length,
      logoChurnRate: startingCohort.length ? churned.length / startingCohort.length : 0,
      startingMrr,
      churnedMrr,
      revenueChurnRate: startingMrr > 0 ? churnedMrr / startingMrr : 0,
      isEmpty: startingCohort.length === 0,
    };
  }

  /**
   * Upgrade/downgrade/lateral plan-change flows in a period, for a Sankey diagram.
   * `planPriceById` lets the caller classify direction by price; without it every
   * flow is reported as `lateral` (we still surface the from→to counts).
   */
  static planMigrationFlows(
    records: SubscriberRecord[],
    periodStart: number,
    periodEnd: number,
    planPriceById?: Record<string, number>
  ): PlanMigrationFlow[] {
    const counts = new Map<string, number>();
    for (const record of records) {
      for (const change of record.planHistory ?? []) {
        if (change.changedAt < periodStart || change.changedAt >= periodEnd) continue;
        const key = `${change.fromPlanId}->${change.toPlanId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries()).map(([key, count]) => {
      const [fromPlanId, toPlanId] = key.split('->');
      let direction: PlanMigrationFlow['direction'] = 'lateral';
      if (planPriceById && planPriceById[fromPlanId] !== undefined && planPriceById[toPlanId] !== undefined) {
        if (planPriceById[toPlanId] > planPriceById[fromPlanId]) direction = 'upgrade';
        else if (planPriceById[toPlanId] < planPriceById[fromPlanId]) direction = 'downgrade';
      }
      return { fromPlanId, toPlanId, count, direction };
    });
  }

  /** LTV broken down by acquisition channel, used for the LTV-by-source drill-down. */
  static ltvByAcquisitionSource(records: SubscriberRecord[], asOf: number = Date.now()): LtvSourceBreakdown[] {
    const groups = new Map<string, SubscriberRecord[]>();
    for (const record of records) {
      const channel = record.acquisitionChannel ?? 'unknown';
      const group = groups.get(channel) ?? [];
      group.push(record);
      groups.set(channel, group);
    }

    return Array.from(groups.entries()).map(([acquisitionChannel, group]) => {
      const churnedRecords = group.filter((record) => record.churnedAt !== undefined);
      const avgMonthlyRevenue = group.length
        ? group.reduce((sum, record) => sum + record.mrr, 0) / group.length
        : 0;

      const churnRate = group.length ? churnedRecords.length / group.length : 0;
      const lifetimeFromChurnRate = churnRate > 0 ? 1 / churnRate : FALLBACK_LIFETIME_MONTHS;

      const observedLifetimes = churnedRecords.map(
        (record) => Math.max(1, ((record.churnedAt as number) - record.signupAt) / (30 * DAY_MS))
      );
      const avgObservedLifetime = observedLifetimes.length
        ? observedLifetimes.reduce((sum, months) => sum + months, 0) / observedLifetimes.length
        : undefined;

      const avgLifetimeMonths = avgObservedLifetime ?? lifetimeFromChurnRate;

      return {
        acquisitionChannel,
        subscriberCount: group.length,
        avgLifetimeMonths,
        avgMonthlyRevenue,
        ltv: avgMonthlyRevenue * avgLifetimeMonths,
      };
    });
  }

  /**
   * Flags statistical outliers (IQR method) in a labeled series so the UI can
   * visually de-emphasize spikes instead of letting them distort chart scales.
   * Needs at least 4 points to compute a meaningful IQR; otherwise nothing is flagged.
   */
  static filterAnomalousSpikes(series: { label: string; value: number }[]): AnomalyFlaggedPoint[] {
    if (series.length < 4) {
      return series.map((point) => ({ ...point, isAnomaly: false }));
    }

    const sorted = [...series.map((point) => point.value)].sort((a, b) => a - b);
    const quantile = (q: number): number => {
      const pos = (sorted.length - 1) * q;
      const base = Math.floor(pos);
      const rest = pos - base;
      return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
    };
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return series.map((point) => ({
      ...point,
      isAnomaly: point.value < lowerBound || point.value > upperBound,
    }));
  }
}
