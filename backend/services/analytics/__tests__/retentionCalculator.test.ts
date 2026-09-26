import { RetentionCalculator, RETENTION_CURVE_DAYS } from '../retentionCalculator';
import type { SubscriberRecord } from '../../../../src/types/cohortAnalytics';

const DAY_MS = 24 * 60 * 60 * 1_000;
const SIGNUP = 1_700_000_000_000;

const makeRecord = (overrides: Partial<SubscriberRecord> = {}): SubscriberRecord => ({
  subscriberId: 'sub_1',
  merchantId: 'merchant_1',
  planId: 'plan_basic',
  planName: 'Basic',
  signupAt: SIGNUP,
  mrr: 10,
  ...overrides,
});

describe('RetentionCalculator', () => {
  describe('isRetainedAtDay', () => {
    it('returns false before the cohort has reached the checkpoint', () => {
      const record = makeRecord();
      expect(RetentionCalculator.isRetainedAtDay(record, 30, SIGNUP + 10 * DAY_MS)).toBe(false);
    });

    it('treats an active subscriber as retained at every checkpoint reached so far', () => {
      const record = makeRecord();
      expect(RetentionCalculator.isRetainedAtDay(record, 30, SIGNUP + 90 * DAY_MS)).toBe(true);
    });

    it('returns false once the subscriber has churned before the checkpoint', () => {
      const record = makeRecord({ churnedAt: SIGNUP + 5 * DAY_MS });
      expect(RetentionCalculator.isRetainedAtDay(record, 30, SIGNUP + 90 * DAY_MS)).toBe(false);
    });

    it('treats a subscriber who churned after the checkpoint as retained at that checkpoint', () => {
      const record = makeRecord({ churnedAt: SIGNUP + 45 * DAY_MS });
      expect(RetentionCalculator.isRetainedAtDay(record, 30, SIGNUP + 90 * DAY_MS)).toBe(true);
      expect(RetentionCalculator.isRetainedAtDay(record, 60, SIGNUP + 90 * DAY_MS)).toBe(false);
    });
  });

  describe('retentionCurve', () => {
    it('reports the standard Day 1/7/30/60/90 checkpoints', () => {
      const curve = RetentionCalculator.retentionCurve([makeRecord()], SIGNUP + 100 * DAY_MS);
      expect(curve.map((point) => point.day)).toEqual(RETENTION_CURVE_DAYS);
    });

    it('excludes cohorts too young to have reached a checkpoint instead of reporting 0%', () => {
      const youngCohort = [makeRecord({ signupAt: SIGNUP })];
      // asOf is only 10 days after signup — Day 30/60/90 haven't happened yet.
      const curve = RetentionCalculator.retentionCurve(youngCohort, SIGNUP + 10 * DAY_MS);
      const day30 = curve.find((point) => point.day === 30);
      expect(day30?.cohortSize).toBe(0);
      expect(day30?.retentionRate).toBe(0);
    });

    it('computes retention rate across a mixed cohort', () => {
      const asOf = SIGNUP + 100 * DAY_MS;
      const records = [
        makeRecord({ subscriberId: 'a' }), // still active
        makeRecord({ subscriberId: 'b', churnedAt: SIGNUP + 3 * DAY_MS }), // churned before Day 7
        makeRecord({ subscriberId: 'c', churnedAt: SIGNUP + 45 * DAY_MS }), // churned between Day 30 and 60
      ];
      const curve = RetentionCalculator.retentionCurve(records, asOf);
      const day1 = curve.find((point) => point.day === 1)!;
      const day30 = curve.find((point) => point.day === 30)!;
      const day60 = curve.find((point) => point.day === 60)!;

      expect(day1.retainedCount).toBe(3); // all three were still subscribed past Day 1
      expect(day30.retainedCount).toBe(2); // a, c — b churned on day 3, before Day 30
      expect(day60.retainedCount).toBe(1); // only a — c churned on day 45, before Day 60
    });
  });
});
