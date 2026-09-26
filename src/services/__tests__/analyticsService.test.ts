import { calculateSubscriptionAnalytics, toMonthlyRevenue, calculateRetentionCurve, calculateDetailedMrrBreakdown, calculateCohortRetentionMatrix, calculateCustomerUnitEconomics } from '../analyticsService';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: '1',
  name: 'Test',
  category: SubscriptionCategory.SOFTWARE,
  price: 10,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-07-01'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

describe('toMonthlyRevenue', () => {
  it('returns price directly for monthly', () => {
    expect(toMonthlyRevenue({ price: 10, billingCycle: BillingCycle.MONTHLY })).toBe(10);
  });
  it('divides by 12 for yearly', () => {
    expect(toMonthlyRevenue({ price: 120, billingCycle: BillingCycle.YEARLY })).toBeCloseTo(10);
  });
  it('multiplies by 4.345 for weekly', () => {
    expect(toMonthlyRevenue({ price: 10, billingCycle: BillingCycle.WEEKLY })).toBeCloseTo(43.45);
  });
});

describe('calculateSubscriptionAnalytics', () => {
  it('returns all zeros for empty subscriptions', () => {
    const result = calculateSubscriptionAnalytics([]);
    expect(result.mrr).toBe(0);
    expect(result.arr).toBe(0);
    expect(result.ltv).toBe(0);
    expect(result.arpu).toBe(0);
    expect(result.subscriberCount).toBe(0);
    expect(result.churn.grossChurnRate).toBe(0);
  });

  it('calculates MRR and ARR for a single active monthly subscription', () => {
    const result = calculateSubscriptionAnalytics([makeSubscription({ price: 20 })]);
    expect(result.mrr).toBe(20);
    expect(result.arr).toBe(240);
  });

  it('calculates ARPU correctly', () => {
    const subs = [
      makeSubscription({ id: '1', price: 10 }),
      makeSubscription({ id: '2', price: 30 }),
    ];
    const result = calculateSubscriptionAnalytics(subs);
    expect(result.arpu).toBe(20);
    expect(result.subscriberCount).toBe(2);
  });

  it('calculates gross churn rate', () => {
    const active = makeSubscription({ id: '1', isActive: true });
    const inactive = makeSubscription({ id: '2', isActive: false });
    const result = calculateSubscriptionAnalytics([active, inactive]);
    expect(result.churn.grossChurnRate).toBe(0.5);
    expect(result.churn.churnedSubscriptions).toBe(1);
    expect(result.churn.activeSubscriptions).toBe(1);
  });

  it('calculates LTV when churn > 0', () => {
    const active = makeSubscription({ id: '1', price: 10 });
    const inactive = makeSubscription({ id: '2', isActive: false, price: 10 });
    const result = calculateSubscriptionAnalytics([active, inactive]);
    // grossChurnRate = 0.5, averageMonthly = 10, ltv = 10 / 0.5 = 20
    expect(result.ltv).toBeCloseTo(20);
  });

  it('groups subscriptions into cohorts by creation month', () => {
    const sub1 = makeSubscription({ id: '1', createdAt: new Date('2026-01-15') });
    const sub2 = makeSubscription({ id: '2', createdAt: new Date('2026-01-20') });
    const sub3 = makeSubscription({ id: '3', createdAt: new Date('2026-02-10') });
    const result = calculateSubscriptionAnalytics([sub1, sub2, sub3]);
    expect(result.cohorts).toHaveLength(2);
    expect(result.cohorts[0].cohort).toBe('2026-01');
    expect(result.cohorts[0].subscriptionsStarted).toBe(2);
  });

  it('produces 3 forecast points with correct labels', () => {
    const result = calculateSubscriptionAnalytics([makeSubscription()]);
    expect(result.forecast).toHaveLength(3);
    expect(result.forecast[0].label).toBe('M+1');
    expect(result.forecast[1].label).toBe('M+2');
    expect(result.forecast[2].label).toBe('M+3');
  });

  it('ARPU equals MRR divided by active count', () => {
    const subs = [
      makeSubscription({ id: '1', price: 15 }),
      makeSubscription({ id: '2', price: 25 }),
      makeSubscription({ id: '3', price: 35 }),
    ];
    const result = calculateSubscriptionAnalytics(subs);
    expect(result.arpu).toBeCloseTo((15 + 25 + 35) / 3);
  });

  it('calculates linear regression vs exponential forecasting models', () => {
    const sub1 = makeSubscription({ id: '1', price: 50, createdAt: new Date('2026-01-01') });
    const sub2 = makeSubscription({ id: '2', price: 100, createdAt: new Date('2026-02-01') });
    const linearResult = calculateSubscriptionAnalytics([sub1, sub2], new Date('2026-03-01'), 'linear', 3);
    const expResult = calculateSubscriptionAnalytics([sub1, sub2], new Date('2026-03-01'), 'exponential', 3);
    expect(linearResult.forecast).toHaveLength(3);
    expect(expResult.forecast).toHaveLength(3);
    // In linear model with upward trend, M+1 expected revenue will differ from exponential decay
    expect(linearResult.forecast[0].expectedRevenue).toBeGreaterThan(0);
    expect(expResult.forecast[0].expectedRevenue).toBeGreaterThan(0);
  });

  it('calculates MoM MRR growth rate when multiple months of trend data exist', () => {
    const sub1 = makeSubscription({ id: '1', price: 100, createdAt: new Date('2026-01-01') });
    const sub2 = makeSubscription({ id: '2', price: 50, createdAt: new Date('2026-02-01') });
    const result = calculateSubscriptionAnalytics([sub1, sub2]);
    // In Jan revenue was 100, in Feb revenue is 150 (since both active), growth rate should be > 0
    expect(result.mrrGrowthRate).toBeDefined();
    expect(result.arrGrowthRate).toEqual(result.mrrGrowthRate);
  });
});

describe('calculateRetentionCurve', () => {
  it('returns standard intervals with 0 retention for empty list', () => {
    const curve = calculateRetentionCurve([]);
    expect(curve).toHaveLength(5);
    expect(curve[0].day).toBe(1);
    expect(curve[0].retentionRate).toBe(0);
  });

  it('calculates retention rates across day milestones', () => {
    const sub = makeSubscription({ id: '1', isActive: true, createdAt: new Date('2026-01-01') });
    const curve = calculateRetentionCurve([sub], new Date('2026-06-01'));
    expect(curve).toHaveLength(5);
    expect(curve[0].retentionRate).toBe(1);
  });
});

describe('calculateDetailedMrrBreakdown (Issue #952)', () => {
  it('calculates starting, new, expansion, churned and ending MRR correctly', () => {
    const prevSub1 = makeSubscription({ id: 's1', price: 50, isActive: true });
    const prevSub2 = makeSubscription({ id: 's2', price: 100, isActive: true });

    // In current period: s1 upgraded to 80 (expansion +30), s2 cancelled (churn 100), s3 newly created (new +70)
    const currSub1 = makeSubscription({ id: 's1', price: 80, isActive: true });
    const currSub2 = makeSubscription({ id: 's2', price: 100, isActive: false });
    const currSub3 = makeSubscription({ id: 's3', price: 70, isActive: true });

    const breakdown = calculateDetailedMrrBreakdown(
      [currSub1, currSub2, currSub3],
      [prevSub1, prevSub2]
    );

    expect(breakdown.startingMrr).toBe(150);
    expect(breakdown.expansionMrr).toBe(30);
    expect(breakdown.churnedMrr).toBe(100);
    expect(breakdown.newMrr).toBe(70);
    expect(breakdown.netNewMrr).toBe(0); // (70 + 30) - 100 = 0
    expect(breakdown.endingMrr).toBe(150);
    expect(breakdown.endingArr).toBe(1800);
  });
});

describe('calculateCohortRetentionMatrix (Issue #952)', () => {
  it('generates multi-period cohort matrix and calculates average retention', () => {
    const jan1 = makeSubscription({ id: 'j1', createdAt: new Date('2026-01-10'), isActive: true });
    const jan2 = makeSubscription({ id: 'j2', createdAt: new Date('2026-01-15'), isActive: false });
    const feb1 = makeSubscription({ id: 'f1', createdAt: new Date('2026-02-05'), isActive: true });

    const result = calculateCohortRetentionMatrix([jan1, jan2, feb1], new Date('2026-03-15'), 3);

    expect(result.cohortRows.length).toBe(2);
    expect(result.cohortRows[0].cohort).toBe('2026-01');
    expect(result.cohortRows[0].cohortSize).toBe(2);
    expect(result.cohortRows[0].periods[0]).toBe(100);
    expect(result.averagePeriodRetention.length).toBeGreaterThan(0);
  });
});

describe('calculateCustomerUnitEconomics (Issue #952)', () => {
  it('computes ARPU, LTV, and CAC payback period', () => {
    const subs = [
      makeSubscription({ id: '1', price: 40, isActive: true }),
      makeSubscription({ id: '2', price: 60, isActive: true }),
      makeSubscription({ id: '3', price: 50, isActive: false }),
    ];

    const economics = calculateCustomerUnitEconomics(subs, 100);

    expect(economics.arpu).toBe(50); // (40 + 60) / 2
    expect(economics.cac).toBe(100);
    expect(economics.cacPaybackMonths).toBe(2.0); // 100 / 50 = 2 months
    expect(economics.ltv).toBeGreaterThan(0);
    expect(economics.ltvToCacRatio).toBeGreaterThan(0);
  });
});
