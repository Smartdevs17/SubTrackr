import {
  creditAmountFor,
  creditPercentFor,
  emptyRequestStats,
  estimatePercentile,
  evaluatePeriod,
  normalizeIntervals,
  observeRequest,
  overlapLength,
  periodBounds,
  totalLength,
  type EvaluationInput,
} from '../calculator';
import { DEFAULT_SLA_TIERS, buildTierMap, validateTierPolicy } from '../tiers';
import { SlaError } from '../errors';
import type { SlaTierPolicy } from '../types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const tiers = buildTierMap(DEFAULT_SLA_TIERS);
const enterprise = tiers.get('enterprise') as SlaTierPolicy;
const premium = tiers.get('premium') as SlaTierPolicy;

// June 2026: 30 days = 43 200 minutes.
const JUNE = Date.UTC(2026, 5, 1);
const JULY = Date.UTC(2026, 6, 1);

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    subscriptionId: 'sub_1',
    policy: enterprise,
    periodStart: JUNE,
    periodEnd: JULY,
    registeredAt: JUNE,
    evaluatedUntil: JULY,
    outages: [],
    maintenance: [],
    requests: emptyRequestStats(),
    minRequests: 100,
    ...overrides,
  };
}

describe('periodBounds', () => {
  it('returns the UTC calendar month', () => {
    expect(periodBounds(Date.UTC(2026, 5, 17, 13))).toEqual({ start: JUNE, end: JULY });
    expect(periodBounds(JULY - 1)).toEqual({ start: JUNE, end: JULY });
    expect(periodBounds(JULY).start).toBe(JULY);
  });

  it('handles December and leap February', () => {
    expect(periodBounds(Date.UTC(2026, 11, 31)).end).toBe(Date.UTC(2027, 0, 1));
    const feb = periodBounds(Date.UTC(2028, 1, 10));
    expect((feb.end - feb.start) / (24 * HOUR)).toBe(29);
  });
});

describe('interval maths', () => {
  it('clips, sorts and merges overlapping intervals', () => {
    const merged = normalizeIntervals(
      [
        { start: 50, end: 70 },
        { start: 0, end: 20 },
        { start: 10, end: 30 },
        { start: -10, end: 5 },
        { start: 90, end: 200 },
      ],
      0,
      100
    );
    expect(merged).toEqual([
      { start: 0, end: 30 },
      { start: 50, end: 70 },
      { start: 90, end: 100 },
    ]);
    expect(totalLength(merged)).toBe(60);
  });

  it('measures overlap between interval lists', () => {
    const a = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];
    const b = [{ start: 5, end: 25 }];
    expect(overlapLength(a, b)).toBe(10);
    expect(overlapLength(a, [])).toBe(0);
  });
});

describe('latency histogram', () => {
  it('returns null with no samples', () => {
    expect(estimatePercentile(emptyRequestStats(), 0.95)).toBeNull();
  });

  it('estimates p95 conservatively from bucket bounds', () => {
    const stats = emptyRequestStats();
    for (let i = 0; i < 95; i++) observeRequest(stats, 80, true);
    for (let i = 0; i < 5; i++) observeRequest(stats, 2_500, true);
    expect(estimatePercentile(stats, 0.95)).toBe(100);
    observeRequest(stats, 2_500, true);
    expect(estimatePercentile(stats, 0.95)).toBe(2_500);
  });

  it('never reports more than the observed maximum', () => {
    const stats = emptyRequestStats();
    observeRequest(stats, 120, true);
    expect(estimatePercentile(stats, 0.95)).toBe(120);
    observeRequest(stats, 60_000, false);
    expect(estimatePercentile(stats, 0.99)).toBe(60_000);
    expect(stats.errors).toBe(1);
  });
});

describe('evaluatePeriod', () => {
  it('reports a clean month as compliant', () => {
    const report = evaluatePeriod(input());
    expect(report.uptimePercent).toBe(100);
    expect(report.downtimeMs).toBe(0);
    expect(report.compliant).toBe(true);
    // 0.1% of 30 days = 43.2 minutes.
    expect(report.downtimeBudgetMs).toBe(43.2 * MIN);
  });

  it('breaches uptime once downtime exceeds the budget', () => {
    const within = evaluatePeriod(
      input({ outages: [{ start: JUNE + HOUR, end: JUNE + HOUR + 43 * MIN }] })
    );
    expect(within.breaches).not.toContain('uptime');
    expect(within.budgetConsumedPercent).toBeCloseTo(99.54, 1);

    const over = evaluatePeriod(
      input({ outages: [{ start: JUNE + HOUR, end: JUNE + HOUR + 44 * MIN }] })
    );
    expect(over.breaches).toEqual(['uptime']);
    expect(over.uptimePercent).toBeLessThan(99.9);
  });

  it('excludes maintenance from downtime and measured time', () => {
    const maintenance = [{ start: JUNE + HOUR, end: JUNE + 3 * HOUR }];
    const report = evaluatePeriod(
      input({ maintenance, outages: [{ start: JUNE + HOUR, end: JUNE + 2 * HOUR }] })
    );
    expect(report.downtimeMs).toBe(0);
    expect(report.measuredMs).toBe(JULY - JUNE - 2 * HOUR);
    expect(report.compliant).toBe(true);
  });

  it('counts only the part of an outage outside maintenance', () => {
    const report = evaluatePeriod(
      input({
        maintenance: [{ start: JUNE + HOUR, end: JUNE + 2 * HOUR }],
        outages: [{ start: JUNE + 90 * MIN, end: JUNE + 3 * HOUR }],
      })
    );
    expect(report.downtimeMs).toBe(HOUR);
  });

  it('measures from enrolment in the first period', () => {
    const registeredAt = JUNE + 15 * 24 * HOUR;
    const report = evaluatePeriod(
      input({ registeredAt, outages: [{ start: JUNE, end: JUNE + 24 * HOUR }] })
    );
    expect(report.measuredMs).toBe(JULY - registeredAt);
    expect(report.downtimeMs).toBe(0);
  });

  it('judges a live window against the full-period budget', () => {
    // 30 minutes down in the first day: 97.9% uptime so far, but within the month's budget.
    const report = evaluatePeriod(
      input({ evaluatedUntil: JUNE + 24 * HOUR, outages: [{ start: JUNE, end: JUNE + 30 * MIN }] })
    );
    expect(report.uptimePercent).toBeLessThan(99);
    expect(report.breaches).toEqual([]);
    expect(report.budgetConsumedPercent).toBeCloseTo(69.44, 1);
  });

  it('withholds latency and error judgements below the request minimum', () => {
    const requests = emptyRequestStats();
    for (let i = 0; i < 10; i++) observeRequest(requests, 9_000, false);
    const report = evaluatePeriod(input({ requests }));
    expect(report.errorRatePercent).toBeNull();
    expect(report.p95LatencyMs).toBeNull();
    expect(report.compliant).toBe(true);
  });

  it('breaches latency and error rate with enough traffic', () => {
    const requests = emptyRequestStats();
    for (let i = 0; i < 90; i++) observeRequest(requests, 400, true);
    for (let i = 0; i < 10; i++) observeRequest(requests, 4_000, false);
    const report = evaluatePeriod(input({ requests }));
    expect(report.errorRatePercent).toBe(10);
    expect(report.p95LatencyMs).toBe(4_000);
    expect(report.breaches).toEqual(['latency', 'error_rate']);
  });

  it('treats a fully maintained window as 100% up', () => {
    const report = evaluatePeriod(input({ maintenance: [{ start: JUNE, end: JULY }] }));
    expect(report.measuredMs).toBe(0);
    expect(report.uptimePercent).toBe(100);
  });
});

describe('credits', () => {
  const breachedUptime = (uptimePercent: number) => ({
    ...evaluatePeriod(input()),
    uptimePercent,
    breaches: ['uptime' as const],
    compliant: false,
  });

  it('applies the most severe matching uptime step', () => {
    expect(creditPercentFor(enterprise, breachedUptime(99.85))).toBe(10);
    expect(creditPercentFor(enterprise, breachedUptime(98.5))).toBe(25);
    expect(creditPercentFor(enterprise, breachedUptime(90))).toBe(100);
  });

  it('adds latency and error remedies and caps the total', () => {
    const report = {
      ...breachedUptime(98.5),
      breaches: ['uptime', 'latency', 'error_rate'] as const,
    };
    expect(creditPercentFor(premium, { ...report, breaches: [...report.breaches] })).toBe(35);
    const severe = {
      ...breachedUptime(90),
      breaches: ['uptime', 'latency'] as ('uptime' | 'latency')[],
    };
    expect(creditPercentFor(premium, severe)).toBe(50);
  });

  it('owes nothing for compliant periods or tiers without credits', () => {
    expect(creditPercentFor(enterprise, evaluatePeriod(input()))).toBe(0);
    expect(creditPercentFor(tiers.get('free') as SlaTierPolicy, breachedUptime(50))).toBe(0);
  });

  it('rounds amounts to cents', () => {
    expect(creditAmountFor(499, 10)).toBe(49.9);
    expect(creditAmountFor(33.33, 25)).toBe(8.33);
    expect(creditAmountFor(100, 0)).toBe(0);
  });
});

describe('tier policies', () => {
  it('accepts the defaults', () => {
    expect(() => buildTierMap(DEFAULT_SLA_TIERS)).not.toThrow();
  });

  it('rejects invalid percentages and inverted credit schedules', () => {
    expect(() => validateTierPolicy({ ...enterprise, uptimeTargetPercent: 101 })).toThrow(SlaError);
    expect(() =>
      validateTierPolicy({
        ...enterprise,
        creditSchedule: [
          { belowUptimePercent: 99.9, creditPercent: 25 },
          { belowUptimePercent: 99, creditPercent: 10 },
        ],
      })
    ).toThrow(/must not credit less/);
  });

  it('rejects duplicate tiers', () => {
    expect(() => buildTierMap([enterprise, enterprise])).toThrow(/defined twice/);
  });
});
