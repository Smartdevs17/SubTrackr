import { calculateSubscriptionAnalytics, toMonthlyRevenue } from '../analyticsService';
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
});
