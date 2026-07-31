import { CohortService } from '../cohortService';
import type { SubscriberRecord } from '../../../../src/types/cohortAnalytics';

const DAY_MS = 24 * 60 * 60 * 1_000;
// 2026-01-15T00:00:00Z and 2026-02-10T00:00:00Z — fixed timestamps so cohort
// keys (ISO week / month) are deterministic across test runs.
const JAN_SIGNUP = Date.UTC(2026, 0, 15);
const FEB_SIGNUP = Date.UTC(2026, 1, 10);

const makeRecord = (overrides: Partial<SubscriberRecord> = {}): SubscriberRecord => ({
  subscriberId: 'sub_1',
  merchantId: 'merchant_1',
  planId: 'plan_basic',
  planName: 'Basic',
  signupAt: JAN_SIGNUP,
  mrr: 20,
  ...overrides,
});

describe('CohortService', () => {
  describe('buildCohortTable', () => {
    it('returns an empty array for zero-data periods instead of throwing', () => {
      expect(CohortService.buildCohortTable([], 'month')).toEqual([]);
    });

    it('groups subscribers by signup month and reports size/retention', () => {
      const asOf = Date.UTC(2026, 2, 1);
      const records = [
        makeRecord({ subscriberId: 'a', signupAt: JAN_SIGNUP }),
        makeRecord({ subscriberId: 'b', signupAt: JAN_SIGNUP, churnedAt: Date.UTC(2026, 1, 1) }),
        makeRecord({ subscriberId: 'c', signupAt: FEB_SIGNUP }),
      ];

      const buckets = CohortService.buildCohortTable(records, 'month', asOf);
      const jan = buckets.find((b) => b.cohortKey === '2026-01')!;
      const feb = buckets.find((b) => b.cohortKey === '2026-02')!;

      expect(jan.size).toBe(2);
      expect(jan.activeCount).toBe(1);
      expect(jan.retentionRate).toBe(0.5);
      expect(jan.isEmpty).toBe(false);
      expect(feb.size).toBe(1);
      expect(feb.activeCount).toBe(1);
    });

    it('buckets by ISO week when granularity is week', () => {
      const records = [makeRecord({ signupAt: JAN_SIGNUP })];
      const buckets = CohortService.buildCohortTable(records, 'week', JAN_SIGNUP + DAY_MS);
      expect(buckets).toHaveLength(1);
      expect(buckets[0].cohortKey).toMatch(/^2026-W\d{2}$/);
    });
  });

  describe('revenueChurnVsLogoChurn', () => {
    it('reports isEmpty when no one was active at the start of the period', () => {
      const breakdown = CohortService.revenueChurnVsLogoChurn([], JAN_SIGNUP, FEB_SIGNUP);
      expect(breakdown.isEmpty).toBe(true);
      expect(breakdown.logoChurnRate).toBe(0);
      expect(breakdown.revenueChurnRate).toBe(0);
    });

    it('diverges revenue churn from logo churn when a high-value account churns', () => {
      const periodStart = JAN_SIGNUP;
      const periodEnd = FEB_SIGNUP;
      const records = [
        makeRecord({ subscriberId: 'whale', signupAt: JAN_SIGNUP - DAY_MS, mrr: 1000, churnedAt: JAN_SIGNUP + 5 * DAY_MS }),
        makeRecord({ subscriberId: 'small1', signupAt: JAN_SIGNUP - DAY_MS, mrr: 10 }),
        makeRecord({ subscriberId: 'small2', signupAt: JAN_SIGNUP - DAY_MS, mrr: 10 }),
        makeRecord({ subscriberId: 'small3', signupAt: JAN_SIGNUP - DAY_MS, mrr: 10 }),
      ];

      const breakdown = CohortService.revenueChurnVsLogoChurn(records, periodStart, periodEnd);
      expect(breakdown.startingSubscribers).toBe(4);
      expect(breakdown.churnedSubscribers).toBe(1);
      expect(breakdown.logoChurnRate).toBe(0.25);
      // Revenue churn should be far higher than logo churn — the whale is most of the MRR.
      expect(breakdown.revenueChurnRate).toBeGreaterThan(breakdown.logoChurnRate);
      expect(breakdown.revenueChurnRate).toBeCloseTo(1000 / 1030, 4);
    });
  });

  describe('planMigrationFlows', () => {
    it('classifies upgrade/downgrade direction when plan prices are supplied', () => {
      const records = [
        makeRecord({
          subscriberId: 'a',
          planHistory: [{ fromPlanId: 'basic', toPlanId: 'pro', changedAt: JAN_SIGNUP + DAY_MS }],
        }),
        makeRecord({
          subscriberId: 'b',
          planHistory: [{ fromPlanId: 'pro', toPlanId: 'basic', changedAt: JAN_SIGNUP + 2 * DAY_MS }],
        }),
      ];

      const flows = CohortService.planMigrationFlows(records, JAN_SIGNUP, JAN_SIGNUP + 10 * DAY_MS, {
        basic: 10,
        pro: 30,
      });

      const upgrade = flows.find((f) => f.fromPlanId === 'basic' && f.toPlanId === 'pro');
      const downgrade = flows.find((f) => f.fromPlanId === 'pro' && f.toPlanId === 'basic');
      expect(upgrade?.direction).toBe('upgrade');
      expect(downgrade?.direction).toBe('downgrade');
    });

    it('ignores plan changes outside the requested period', () => {
      const records = [
        makeRecord({
          planHistory: [{ fromPlanId: 'basic', toPlanId: 'pro', changedAt: JAN_SIGNUP - 100 * DAY_MS }],
        }),
      ];
      const flows = CohortService.planMigrationFlows(records, JAN_SIGNUP, JAN_SIGNUP + 10 * DAY_MS);
      expect(flows).toHaveLength(0);
    });
  });

  describe('ltvByAcquisitionSource', () => {
    it('groups unattributed subscribers under "unknown"', () => {
      const breakdown = CohortService.ltvByAcquisitionSource([makeRecord({ acquisitionChannel: undefined })]);
      expect(breakdown[0].acquisitionChannel).toBe('unknown');
    });

    it('computes a higher LTV for lower-churn channels', () => {
      const records = [
        makeRecord({ subscriberId: 'p1', acquisitionChannel: 'paid_search', mrr: 50, churnedAt: JAN_SIGNUP + 30 * DAY_MS }),
        makeRecord({ subscriberId: 'p2', acquisitionChannel: 'paid_search', mrr: 50, churnedAt: JAN_SIGNUP + 30 * DAY_MS }),
        makeRecord({ subscriberId: 'r1', acquisitionChannel: 'referral', mrr: 50 }),
        makeRecord({ subscriberId: 'r2', acquisitionChannel: 'referral', mrr: 50 }),
      ];
      const breakdown = CohortService.ltvByAcquisitionSource(records);
      const paid = breakdown.find((b) => b.acquisitionChannel === 'paid_search')!;
      const referral = breakdown.find((b) => b.acquisitionChannel === 'referral')!;
      expect(referral.ltv).toBeGreaterThan(paid.ltv);
    });
  });

  describe('filterAnomalousSpikes', () => {
    it('does not flag anything when there are too few points to compute a meaningful IQR', () => {
      const flagged = CohortService.filterAnomalousSpikes([
        { label: 'a', value: 10 },
        { label: 'b', value: 1000 },
      ]);
      expect(flagged.every((point) => !point.isAnomaly)).toBe(true);
    });

    it('flags a clear outlier in an otherwise stable series', () => {
      const flagged = CohortService.filterAnomalousSpikes([
        { label: 'mon', value: 10 },
        { label: 'tue', value: 11 },
        { label: 'wed', value: 9 },
        { label: 'thu', value: 10 },
        { label: 'fri', value: 500 },
      ]);
      expect(flagged.find((p) => p.label === 'fri')?.isAnomaly).toBe(true);
      expect(flagged.filter((p) => p.label !== 'fri').every((p) => !p.isAnomaly)).toBe(true);
    });
  });

});
