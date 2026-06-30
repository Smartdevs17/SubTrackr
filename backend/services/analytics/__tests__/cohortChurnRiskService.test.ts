import { getChurnRiskForCohort } from '../cohortChurnRiskService';
import type { SubscriberRecord } from '../../../../src/types/cohortAnalytics';

const makeRecord = (overrides: Partial<SubscriberRecord> = {}): SubscriberRecord => ({
  subscriberId: 'sub_1',
  merchantId: 'merchant_1',
  planId: 'plan_basic',
  planName: 'Basic',
  signupAt: 1_700_000_000_000,
  mrr: 20,
  ...overrides,
});

describe('getChurnRiskForCohort', () => {
  it('returns a neutral zero-confidence summary when there are no active subscribers', async () => {
    const summary = await getChurnRiskForCohort('2026-01', []);
    expect(summary).toEqual({
      cohortKey: '2026-01',
      sampledSubscribers: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
      averageChurnProbability: 0,
    });
  });

  it('degrades gracefully instead of throwing when the ml-service is unreachable', async () => {
    const summary = await getChurnRiskForCohort('2026-01', [makeRecord()]);
    expect(summary.cohortKey).toBe('2026-01');
    expect(Number.isFinite(summary.averageChurnProbability)).toBe(true);
  });
});
