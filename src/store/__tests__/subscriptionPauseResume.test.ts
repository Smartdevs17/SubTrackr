import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useSubscriptionStore } from '../subscriptionStore';
import { BillingCycle, SubscriptionCategory } from '../../types/subscription';
import { PauseReason, PauseState } from '../../types/pause';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      store.clear();
      return Promise.resolve();
    }),
  };
});

jest.mock('../../services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
  presentLocalNotification: jest.fn(() => Promise.resolve()),
  presentDunningRetryNotification: jest.fn(() => Promise.resolve()),
  presentDunningWarningNotification: jest.fn(() => Promise.resolve()),
  presentDunningSuspendedNotification: jest.fn(() => Promise.resolve()),
  presentDunningCancelledNotification: jest.fn(() => Promise.resolve()),
  presentDunningRecoveryNotification: jest.fn(() => Promise.resolve()),
}));

describe('subscription pause/resume billing flow', () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      subscriptions: [],
      creditAccounts: {},
      pauseHistory: [],
      stats: {
        totalActive: 0,
        totalMonthlySpend: 0,
        totalYearlySpend: 0,
        categoryBreakdown: {
          [SubscriptionCategory.STREAMING]: 0,
          [SubscriptionCategory.SOFTWARE]: 0,
          [SubscriptionCategory.GAMING]: 0,
          [SubscriptionCategory.PRODUCTIVITY]: 0,
          [SubscriptionCategory.FITNESS]: 0,
          [SubscriptionCategory.EDUCATION]: 0,
          [SubscriptionCategory.FINANCE]: 0,
          [SubscriptionCategory.OTHER]: 0,
        },
      },
      isLoading: false,
      error: null,
      prorationPreview: null,
      creditMemos: {},
    });
  });

  it('creates a pause record with prorated credit and marks the subscription inactive', () => {
    const id = 'sub-1';
    useSubscriptionStore.setState({
      subscriptions: [
        {
          id,
          name: 'Netflix',
          category: SubscriptionCategory.STREAMING,
          price: 30,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-08-30T00:00:00.000Z'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    const record = useSubscriptionStore.getState().pauseSubscription(id, 14, PauseReason.VACATION);

    expect(record.state).toBe(PauseState.PAUSED);
    expect(record.creditAmount).toBe(14);
    expect(record.creditRemaining).toBe(14);
    expect(record.status).toBe('active');
    expect(useSubscriptionStore.getState().subscriptions[0].isActive).toBe(false);
    expect(useSubscriptionStore.getState().getActivePause(id)?.subscriptionId).toBe(id);
  });

  it('resumes a paused subscription and shifts the next billing date', () => {
    const id = 'sub-2';
    const originalNextBillingDate = new Date('2026-08-30T00:00:00.000Z');
    useSubscriptionStore.setState({
      subscriptions: [
        {
          id,
          name: 'Spotify',
          category: SubscriptionCategory.OTHER,
          price: 60,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: originalNextBillingDate,
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    useSubscriptionStore.getState().pauseSubscription(id, 14, PauseReason.TEMPORARY_NEED);
    const resumed = useSubscriptionStore.getState().resumeSubscription(id, true);

    expect(resumed).not.toBeNull();
    expect(resumed?.status).toBe('resumed');
    expect(resumed?.creditRemaining).toBeGreaterThanOrEqual(0);
    expect(useSubscriptionStore.getState().subscriptions[0].isActive).toBe(true);
    const shifted = useSubscriptionStore.getState().subscriptions[0].nextBillingDate;
    expect(shifted.getTime()).toBeGreaterThan(originalNextBillingDate.getTime());
    expect(useSubscriptionStore.getState().getPauseHistory(id)[0].status).toBe('resumed');
  });
});
