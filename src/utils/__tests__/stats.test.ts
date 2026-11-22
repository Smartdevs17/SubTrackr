import { BillingCycle, Subscription, SubscriptionCategory } from '../../types/subscription';
import { BILLING_CONVERSIONS } from '../constants/values';
import { calculateSubscriptionStats, getMonthlySubscriptionSpend } from '../stats';

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  name: 'Test subscription',
  category: SubscriptionCategory.STREAMING,
  price: 10,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-01-01T00:00:00Z'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

describe('calculateSubscriptionStats', () => {
  it('returns empty stats for missing or non-array input', () => {
    expect(calculateSubscriptionStats(undefined).totalActive).toBe(0);
    expect(calculateSubscriptionStats(null).totalMonthlySpend).toBe(0);
  });

  it('calculates monthly, yearly, category, and gas totals from one shared function', () => {
    const stats = calculateSubscriptionStats([
      makeSubscription({
        id: 'monthly',
        price: 10,
        billingCycle: BillingCycle.MONTHLY,
        category: SubscriptionCategory.STREAMING,
        totalGasSpent: 0.2,
      }),
      makeSubscription({
        id: 'yearly',
        price: 120,
        billingCycle: BillingCycle.YEARLY,
        category: SubscriptionCategory.SOFTWARE,
        totalGasSpent: 0.3,
      }),
      makeSubscription({
        id: 'weekly',
        price: 5,
        billingCycle: BillingCycle.WEEKLY,
        category: SubscriptionCategory.GAMING,
        totalGasSpent: 0.5,
      }),
      makeSubscription({ id: 'inactive', isActive: false }),
    ]);

    expect(stats.totalActive).toBe(3);
    expect(stats.totalMonthlySpend).toBe(10 + 10 + 5 * BILLING_CONVERSIONS.WEEKS_PER_MONTH);
    expect(stats.totalYearlySpend).toBe(120 + 120 + 5 * BILLING_CONVERSIONS.WEEKS_PER_YEAR);
    expect(stats.categoryBreakdown[SubscriptionCategory.STREAMING]).toBe(1);
    expect(stats.categoryBreakdown[SubscriptionCategory.SOFTWARE]).toBe(1);
    expect(stats.categoryBreakdown[SubscriptionCategory.GAMING]).toBe(1);
    expect(stats.totalGasSpent).toBe(1);
  });

  it('applies a supplied currency converter before billing-cycle conversion', () => {
    const subscription = makeSubscription({
      price: 12,
      currency: 'EUR',
      billingCycle: BillingCycle.YEARLY,
    });

    const monthlySpend = getMonthlySubscriptionSpend(subscription, (amount, currency) =>
      currency === 'EUR' ? amount * 2 : amount
    );

    expect(monthlySpend).toBe(2);
  });
});
