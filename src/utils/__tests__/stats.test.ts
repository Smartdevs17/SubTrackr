import { calculateSubscriptionStats, toMonthlyPrice, toYearlyPrice } from '../stats';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../types/subscription';
import { BILLING_CONVERSIONS } from '../constants/values';

const makeSubscription = (overrides: Partial<Subscription>): Subscription => ({
  id: '1',
  name: 'Test',
  category: SubscriptionCategory.SOFTWARE,
  price: 10,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date(),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('toMonthlyPrice', () => {
  it('returns price as-is for monthly', () => {
    expect(toMonthlyPrice(12, BillingCycle.MONTHLY)).toBe(12);
  });

  it('divides by 12 for yearly', () => {
    expect(toMonthlyPrice(120, BillingCycle.YEARLY)).toBe(10);
  });

  it('multiplies by weeks-per-month for weekly', () => {
    expect(toMonthlyPrice(10, BillingCycle.WEEKLY)).toBeCloseTo(
      10 * BILLING_CONVERSIONS.WEEKS_PER_MONTH
    );
  });

  it('returns price as-is for custom', () => {
    expect(toMonthlyPrice(10, BillingCycle.CUSTOM)).toBe(10);
  });
});

describe('toYearlyPrice', () => {
  it('returns price as-is for yearly', () => {
    expect(toYearlyPrice(120, BillingCycle.YEARLY)).toBe(120);
  });

  it('multiplies by 12 for monthly', () => {
    expect(toYearlyPrice(10, BillingCycle.MONTHLY)).toBe(120);
  });

  it('multiplies by 52 for weekly', () => {
    expect(toYearlyPrice(10, BillingCycle.WEEKLY)).toBe(10 * BILLING_CONVERSIONS.WEEKS_PER_YEAR);
  });

  it('multiplies by 12 for custom', () => {
    expect(toYearlyPrice(10, BillingCycle.CUSTOM)).toBe(120);
  });
});

describe('calculateSubscriptionStats', () => {
  it('returns zeros for empty array', () => {
    const stats = calculateSubscriptionStats([]);
    expect(stats.totalActive).toBe(0);
    expect(stats.totalMonthlySpend).toBe(0);
    expect(stats.totalYearlySpend).toBe(0);
    expect(stats.categoryBreakdown).toEqual({});
  });

  it('returns zeros for null/undefined input', () => {
    // @ts-expect-error testing invalid input
    expect(calculateSubscriptionStats(null).totalActive).toBe(0);
    // @ts-expect-error testing invalid input
    expect(calculateSubscriptionStats(undefined).totalActive).toBe(0);
  });

  it('excludes inactive subscriptions', () => {
    const subs = [
      makeSubscription({ id: '1', isActive: true, price: 10 }),
      makeSubscription({ id: '2', isActive: false, price: 20 }),
    ];
    const stats = calculateSubscriptionStats(subs);
    expect(stats.totalActive).toBe(1);
    expect(stats.totalMonthlySpend).toBe(10);
  });

  it('calculates monthly spend correctly for mixed billing cycles', () => {
    const subs = [
      makeSubscription({ id: '1', price: 10, billingCycle: BillingCycle.MONTHLY }),
      makeSubscription({ id: '2', price: 120, billingCycle: BillingCycle.YEARLY }),
    ];
    const stats = calculateSubscriptionStats(subs);
    // 10 + 120/12 = 10 + 10 = 20
    expect(stats.totalMonthlySpend).toBeCloseTo(20);
  });

  it('calculates yearly spend correctly for mixed billing cycles', () => {
    const subs = [
      makeSubscription({ id: '1', price: 10, billingCycle: BillingCycle.MONTHLY }),
      makeSubscription({ id: '2', price: 120, billingCycle: BillingCycle.YEARLY }),
    ];
    const stats = calculateSubscriptionStats(subs);
    // 10*12 + 120 = 120 + 120 = 240
    expect(stats.totalYearlySpend).toBeCloseTo(240);
  });

  it('applies price converter when provided', () => {
    const subs = [makeSubscription({ price: 10, currency: 'EUR' })];
    // Simulate 2x conversion rate
    const stats = calculateSubscriptionStats(subs, (price) => price * 2);
    expect(stats.totalMonthlySpend).toBe(20);
    expect(stats.totalYearlySpend).toBe(240);
  });

  it('builds category breakdown correctly', () => {
    const subs = [
      makeSubscription({ id: '1', category: SubscriptionCategory.STREAMING }),
      makeSubscription({ id: '2', category: SubscriptionCategory.STREAMING }),
      makeSubscription({ id: '3', category: SubscriptionCategory.SOFTWARE }),
    ];
    const stats = calculateSubscriptionStats(subs);
    expect(stats.categoryBreakdown[SubscriptionCategory.STREAMING]).toBe(2);
    expect(stats.categoryBreakdown[SubscriptionCategory.SOFTWARE]).toBe(1);
  });

  it('sums totalGasSpent from active subscriptions', () => {
    const subs = [
      makeSubscription({ id: '1', totalGasSpent: 0.01 }),
      makeSubscription({ id: '2', totalGasSpent: 0.02 }),
      makeSubscription({ id: '3', isActive: false, totalGasSpent: 0.99 }),
    ];
    const stats = calculateSubscriptionStats(subs);
    expect(stats.totalGasSpent).toBeCloseTo(0.03);
  });

  it('handles subscriptions with no totalGasSpent field', () => {
    const subs = [makeSubscription({ id: '1' })];
    const stats = calculateSubscriptionStats(subs);
    expect(stats.totalGasSpent).toBe(0);
  });
});
