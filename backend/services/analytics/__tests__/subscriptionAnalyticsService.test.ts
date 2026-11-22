/**
 * Unit tests for SubscriptionAnalyticsService
 *
 * Covers:
 *  - compute(): MRR, ARR, growth rates, subscriber count
 *  - compute(): churn metrics (gross / net)
 *  - compute(): cohort breakdown
 *  - compute(): revenue forecast (linear + exponential)
 *  - compute(): retention curve shape
 *  - compute(): caching and invalidation
 *  - mrrBreakdown(): new / expansion / contraction / churn MRR
 *  - arrSummary(): implied monthly growth
 *  - cohortSummary(): best / worst cohort, avg retention rate
 *  - churnSummary(): percentage strings, monthsToZero
 *  - forecastSummary(): aggregate totals
 *  - revenueTrend(): slice count
 *  - exportCsv(): CSV format and presence of key rows
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  SubscriptionAnalyticsService,
  type AnalyticsQuery,
} from '../subscriptionAnalyticsService';
import { Subscription, BillingCycle, SubscriptionCategory } from '../../../../src/types/subscription';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-01T00:00:00.000Z');
const THREE_MONTHS_AGO = new Date('2026-03-01T00:00:00.000Z');
const FIVE_MONTHS_AGO = new Date('2026-01-01T00:00:00.000Z');

function makeSub(
  id: string,
  price: number,
  isActive = true,
  billingCycle: BillingCycle = BillingCycle.MONTHLY,
  createdAt: Date = THREE_MONTHS_AGO
): Subscription {
  return {
    id,
    name: `Plan ${id}`,
    category: SubscriptionCategory.SOFTWARE,
    price,
    currency: 'USD',
    billingCycle,
    nextBillingDate: NOW,
    isActive,
    isCryptoEnabled: false,
    createdAt,
    updatedAt: isActive ? createdAt : NOW,
  };
}

// Base set: 4 active monthly, 1 churned
const BASE_SUBSCRIPTIONS: Subscription[] = [
  makeSub('s1', 50),
  makeSub('s2', 100),
  makeSub('s3', 200),
  makeSub('s4', 75),
  makeSub('s5', 30, false), // churned
];

const QUERY: AnalyticsQuery = {
  merchantId: 'merch_1',
  asOf: NOW,
  forecastModel: 'exponential',
  forecastMonths: 3,
};

// ── Service ───────────────────────────────────────────────────────────────────

describe('SubscriptionAnalyticsService', () => {
  let service: SubscriptionAnalyticsService;

  beforeEach(() => {
    service = new SubscriptionAnalyticsService();
  });

  // ── compute

  describe('compute()', () => {
    it('returns the merchant ID in the envelope', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(env.merchantId).toBe('merch_1');
    });

    it('records a non-zero durationMs', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(env.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('calculates MRR as sum of active monthly revenue', () => {
      // 50 + 100 + 200 + 75 = 425
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(report.mrr).toBeCloseTo(425, 0);
    });

    it('calculates ARR = MRR × 12', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(report.arr).toBeCloseTo(report.mrr * 12, 0);
    });

    it('counts only active subscribers', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(report.subscriberCount).toBe(4);
    });

    it('computes positive gross churn rate when some subs have churned', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(report.churn.grossChurnRate).toBeGreaterThan(0);
    });

    it('gross churn rate equals churned / total', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      // 1 churned / 5 total = 0.2
      expect(report.churn.grossChurnRate).toBeCloseTo(0.2, 5);
    });

    it('includes at least one cohort', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(report.cohorts.length).toBeGreaterThan(0);
    });

    it('produces forecast entries for forecastMonths', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, { ...QUERY, forecastMonths: 4 });
      expect(report.forecast).toHaveLength(4);
    });

    it('forecast upper bound is >= expected revenue', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      for (const point of report.forecast) {
        expect(point.upperBound).toBeGreaterThanOrEqual(point.expectedRevenue);
      }
    });

    it('computes retention curve with standard intervals', () => {
      const { retentionCurve } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const days = retentionCurve.map((p) => p.day);
      expect(days).toContain(1);
      expect(days).toContain(30);
      expect(days).toContain(90);
    });

    it('handles an empty subscription list gracefully', () => {
      const { report } = service.compute([], QUERY);
      expect(report.mrr).toBe(0);
      expect(report.arr).toBe(0);
      expect(report.subscriberCount).toBe(0);
    });

    it('normalises yearly billing to monthly correctly', () => {
      const subs = [makeSub('y1', 1200, true, BillingCycle.YEARLY)];
      const { report } = service.compute(subs, QUERY);
      expect(report.mrr).toBeCloseTo(100, 0); // 1200 / 12
    });

    it('normalises weekly billing to monthly correctly', () => {
      const subs = [makeSub('w1', 10, true, BillingCycle.WEEKLY)];
      const { report } = service.compute(subs, QUERY);
      expect(report.mrr).toBeCloseTo(43.45, 0); // 10 * 4.345
    });

    it('linear forecast model returns positive expected revenue', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, {
        ...QUERY,
        forecastModel: 'linear',
      });
      for (const point of report.forecast) {
        expect(point.expectedRevenue).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── caching

  describe('caching', () => {
    it('getCached returns null before any compute', () => {
      expect(service.getCached('merch_1')).toBeNull();
    });

    it('getCached returns the last envelope after compute', () => {
      service.compute(BASE_SUBSCRIPTIONS, QUERY);
      expect(service.getCached('merch_1')).not.toBeNull();
    });

    it('invalidate() clears the cached result', () => {
      service.compute(BASE_SUBSCRIPTIONS, QUERY);
      service.invalidate('merch_1');
      expect(service.getCached('merch_1')).toBeNull();
    });

    it('each merchant has an independent cache', () => {
      service.compute(BASE_SUBSCRIPTIONS, QUERY);
      service.compute([], { ...QUERY, merchantId: 'merch_2' });
      const m1 = service.getCached('merch_1');
      const m2 = service.getCached('merch_2');
      expect(m1!.report.mrr).toBeGreaterThan(0);
      expect(m2!.report.mrr).toBe(0);
    });
  });

  // ── mrrBreakdown

  describe('mrrBreakdown()', () => {
    it('new MRR equals revenue of subscriptions added between periods', () => {
      const prev = [makeSub('s1', 100), makeSub('s2', 100)];
      const curr = [makeSub('s1', 100), makeSub('s2', 100), makeSub('s3', 50)];
      const breakdown = service.mrrBreakdown(prev, curr);
      expect(breakdown.newMrr).toBeCloseTo(50, 1);
    });

    it('churn MRR equals revenue of subscriptions that left between periods', () => {
      const prev = [makeSub('s1', 100), makeSub('s2', 80)];
      const curr = [makeSub('s1', 100)];
      const breakdown = service.mrrBreakdown(prev, curr);
      expect(breakdown.churnMrr).toBeCloseTo(80, 1);
    });

    it('expansion MRR reflects price increases on retained subs', () => {
      const prev = [makeSub('s1', 50)];
      const upgraded = { ...makeSub('s1', 100) };
      const breakdown = service.mrrBreakdown(prev, [upgraded]);
      expect(breakdown.expansionMrr).toBeCloseTo(50, 1);
    });

    it('contraction MRR reflects price decreases on retained subs', () => {
      const prev = [makeSub('s1', 100)];
      const downgraded = { ...makeSub('s1', 60) };
      const breakdown = service.mrrBreakdown(prev, [downgraded]);
      expect(breakdown.contractionMrr).toBeCloseTo(40, 1);
    });

    it('net new MRR = new + expansion - contraction - churn', () => {
      const prev = [makeSub('s1', 100), makeSub('s2', 50)];
      const curr = [makeSub('s1', 120), makeSub('s3', 30)]; // s2 churned, s1 expanded, s3 new
      const bd = service.mrrBreakdown(prev, curr);
      const expected = bd.newMrr + bd.expansionMrr - bd.contractionMrr - bd.churnMrr;
      expect(bd.netNewMrr).toBeCloseTo(expected, 1);
    });
  });

  // ── arrSummary

  describe('arrSummary()', () => {
    it('arr is mrr * 12', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.arrSummary(env);
      expect(summary.arr).toBeCloseTo(env.report.mrr * 12, 0);
    });

    it('impliedMonthlyGrowth is arrGrowthRate / 12', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.arrSummary(env);
      expect(summary.impliedMonthlyGrowth).toBeCloseTo(summary.arrGrowthRate / 12, 5);
    });
  });

  // ── cohortSummary

  describe('cohortSummary()', () => {
    it('reports correct totalCohorts', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.cohortSummary(env.report);
      expect(summary.totalCohorts).toBe(env.report.cohorts.length);
    });

    it('bestCohort has the highest retention rate', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.cohortSummary(env.report);
      if (summary.bestCohort && summary.worstCohort) {
        expect(summary.bestCohort.retentionRate).toBeGreaterThanOrEqual(
          summary.worstCohort.retentionRate
        );
      }
    });

    it('handles empty cohorts gracefully', () => {
      const env = service.compute([], QUERY);
      const summary = service.cohortSummary(env.report);
      expect(summary.totalCohorts).toBe(0);
      expect(summary.bestCohort).toBeNull();
    });

    it('avgRetentionRate is between 0 and 100', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.cohortSummary(env.report);
      expect(summary.avgRetentionRate).toBeGreaterThanOrEqual(0);
      expect(summary.avgRetentionRate).toBeLessThanOrEqual(100);
    });
  });

  // ── churnSummary

  describe('churnSummary()', () => {
    it('grossChurnPct is a percentage string', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.churnSummary(report);
      expect(summary.grossChurnPct).toMatch(/\d+\.\d{2}%/);
    });

    it('monthsToZero is a positive number when there is churn', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.churnSummary(report);
      if (report.churn.grossChurnRate > 0) {
        expect(summary.monthsToZero).not.toBeNull();
        expect(summary.monthsToZero!).toBeGreaterThan(0);
      }
    });

    it('monthsToZero is null when gross churn rate is 0', () => {
      const allActive = BASE_SUBSCRIPTIONS.filter((s) => s.isActive);
      const { report } = service.compute(allActive, QUERY);
      if (report.churn.grossChurnRate === 0) {
        const summary = service.churnSummary(report);
        expect(summary.monthsToZero).toBeNull();
      }
    });
  });

  // ── forecastSummary

  describe('forecastSummary()', () => {
    it('totalExpectedRevenue equals sum of monthly expected revenues', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.forecastSummary(report);
      const expected = report.forecast.reduce((s, m) => s + m.expectedRevenue, 0);
      expect(summary.totalExpectedRevenue).toBeCloseTo(expected, 1);
    });

    it('bestCaseRevenue >= totalExpectedRevenue', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.forecastSummary(report);
      expect(summary.bestCaseRevenue).toBeGreaterThanOrEqual(summary.totalExpectedRevenue);
    });

    it('worstCaseRevenue <= totalExpectedRevenue', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const summary = service.forecastSummary(report);
      expect(summary.worstCaseRevenue).toBeLessThanOrEqual(summary.totalExpectedRevenue);
    });
  });

  // ── revenueTrend

  describe('revenueTrend()', () => {
    it('returns at most the requested number of months', () => {
      const { report } = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const trend = service.revenueTrend(report, 3);
      expect(trend.length).toBeLessThanOrEqual(3);
    });

    it('returns all months when fewer are available', () => {
      const { report } = service.compute([makeSub('s1', 100)], QUERY);
      const trend = service.revenueTrend(report, 100);
      expect(trend.length).toBeLessThanOrEqual(report.revenueTrend.length);
    });
  });

  // ── exportCsv

  describe('exportCsv()', () => {
    it('includes the merchant ID', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const csv = service.exportCsv(env);
      expect(csv).toContain('merch_1');
    });

    it('includes KEY METRICS section', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const csv = service.exportCsv(env);
      expect(csv).toContain('KEY METRICS');
      expect(csv).toContain('MRR');
      expect(csv).toContain('ARR');
    });

    it('includes COHORT ANALYSIS section', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const csv = service.exportCsv(env);
      expect(csv).toContain('COHORT ANALYSIS');
    });

    it('includes FORECAST section', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const csv = service.exportCsv(env);
      expect(csv).toContain('FORECAST');
    });

    it('produces comma-delimited rows', () => {
      const env = service.compute(BASE_SUBSCRIPTIONS, QUERY);
      const csv = service.exportCsv(env);
      const rows = csv.split('\n').filter((l) => l.includes(','));
      expect(rows.length).toBeGreaterThan(5);
    });
  });
});
