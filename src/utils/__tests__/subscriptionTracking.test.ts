import { BillingCycle, SubscriptionCategory, type Subscription } from '../../types/subscription';
import { buildTrackingSnapshot } from '../subscriptionTracking';

function makeSub(overrides: Partial<Subscription>): Subscription {
  return {
    id: overrides.id ?? '1',
    name: overrides.name ?? 'Netflix',
    category: SubscriptionCategory.STREAMING,
    price: overrides.price ?? 10,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: overrides.nextBillingDate ?? new Date(),
    isActive: overrides.isActive ?? true,
    isPaused: overrides.isPaused,
    isCryptoEnabled: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
}

describe('buildTrackingSnapshot', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');

  it('returns empty counts for no subscriptions', () => {
    const snapshot = buildTrackingSnapshot([], now);
    expect(snapshot.overdueCount).toBe(0);
    expect(snapshot.dueThisWeekCount).toBe(0);
    expect(snapshot.nextCharge).toBeNull();
  });

  it('classifies overdue, due this week, and ignores paused items', () => {
    const overdue = makeSub({
      id: 'overdue',
      name: 'Overdue Sub',
      nextBillingDate: new Date('2026-09-20T12:00:00.000Z'),
      price: 5,
    });
    const thisWeek = makeSub({
      id: 'week',
      name: 'Week Sub',
      nextBillingDate: new Date('2026-09-26T12:00:00.000Z'),
      price: 8,
    });
    const paused = makeSub({
      id: 'paused',
      name: 'Paused Sub',
      isPaused: true,
      nextBillingDate: new Date('2026-09-21T12:00:00.000Z'),
    });

    const snapshot = buildTrackingSnapshot([overdue, thisWeek, paused], now);

    expect(snapshot.overdue.map((s) => s.id)).toEqual(['overdue']);
    expect(snapshot.dueThisWeek.map((s) => s.id)).toEqual(['week']);
    expect(snapshot.nextCharge?.id).toBe('overdue');
    expect(snapshot.dueThisMonthSpend).toBe(13);
  });
});
