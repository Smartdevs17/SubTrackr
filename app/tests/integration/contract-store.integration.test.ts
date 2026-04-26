/**
 * Integration tests: contract ↔ store interaction
 *
 * Verifies that the subscriptionStore correctly integrates with the
 * notificationService (the "contract" layer) on every mutation.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notificationService from '../../../src/services/notificationService';
import { useSubscriptionStore } from '../../../src/store/subscriptionStore';
import { SubscriptionCategory, BillingCycle } from '../../../src/types/subscription';
import { makeSubscription, makeSubscriptionFormData, resetIdCounter } from './factories';

// ── In-memory AsyncStorage ────────────────────────────────────────────────────
const mockMemoryStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockMemoryStore.set(key, value);
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => Promise.resolve(mockMemoryStore.get(key) ?? null)),
  removeItem: jest.fn((key: string) => {
    mockMemoryStore.delete(key);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    mockMemoryStore.clear();
    return Promise.resolve();
  }),
}));

// ── Notification service mock (the "contract" side) ───────────────────────────
jest.mock('../../../src/services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

const mockSyncRenewalReminders = notificationService.syncRenewalReminders as jest.Mock;
const mockPresentChargeSuccess = notificationService.presentChargeSuccessNotification as jest.Mock;
const mockPresentChargeFailed = notificationService.presentChargeFailedNotification as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────
function resetStore() {
  useSubscriptionStore.setState({
    subscriptions: [],
    stats: {
      totalActive: 0,
      totalMonthlySpend: 0,
      totalYearlySpend: 0,
      categoryBreakdown: {} as never,
    },
    isLoading: false,
    error: null,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockMemoryStore.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  mockSyncRenewalReminders.mockClear();
  mockPresentChargeSuccess.mockClear();
  mockPresentChargeFailed.mockClear();
  resetStore();
  resetIdCounter();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
describe('contract-store integration', () => {
  it('addSubscription calls syncRenewalReminders with the new subscription', async () => {
    const formData = makeSubscriptionFormData({ name: 'GitHub Copilot' });

    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(formData);
    });

    expect(mockSyncRenewalReminders).toHaveBeenCalledTimes(1);
    const [subs] = mockSyncRenewalReminders.mock.calls[0] as unknown as [unknown[]];
    expect(Array.isArray(subs)).toBe(true);
    expect((subs as { name: string }[]).some((s) => s.name === 'GitHub Copilot')).toBe(true);
  });

  it('updateSubscription propagates updated list to syncRenewalReminders', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(makeSubscriptionFormData());
    });
    mockSyncRenewalReminders.mockClear();

    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription(id, { price: 19.99 });
    });

    expect(mockSyncRenewalReminders).toHaveBeenCalledTimes(1);
    const [subs] = mockSyncRenewalReminders.mock.calls[0] as unknown as [{ price: number }[]];
    expect(subs[0].price).toBe(19.99);
  });

  it('deleteSubscription syncs reminders after removal', async () => {
    const sub1 = makeSubscription({ id: 'keep', name: 'Keep Me' });
    const sub2 = makeSubscription({ id: 'remove', name: 'Remove Me' });
    useSubscriptionStore.setState({ subscriptions: [sub1, sub2] });
    mockSyncRenewalReminders.mockClear();

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription('remove');
    });

    expect(mockSyncRenewalReminders).toHaveBeenCalledTimes(1);
    const [subs] = mockSyncRenewalReminders.mock.calls[0] as unknown as [{ name: string }[]];
    expect(subs.every((s) => s.name !== 'Remove Me')).toBe(true);
  });

  it('recordBillingOutcome success fires charge-success notification', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(
          makeSubscriptionFormData({ name: 'Vercel Pro', notificationsEnabled: true })
        );
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'success');
    });

    expect(mockPresentChargeSuccess).toHaveBeenCalledTimes(1);
    expect(mockPresentChargeFailed).not.toHaveBeenCalled();
  });

  it('recordBillingOutcome failure fires charge-failed notification', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ notificationsEnabled: true }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'failed');
    });

    expect(mockPresentChargeFailed).toHaveBeenCalledTimes(1);
    expect(mockPresentChargeSuccess).not.toHaveBeenCalled();
  });

  it('recordBillingOutcome skips notifications when notificationsEnabled is false', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ notificationsEnabled: false }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'success');
    });

    expect(mockPresentChargeSuccess).not.toHaveBeenCalled();
  });

  it('stats stay consistent after a full add → toggle → delete cycle', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(
          makeSubscriptionFormData({ price: 10, billingCycle: BillingCycle.MONTHLY })
        );
    });
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(1);

    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().toggleSubscriptionStatus(id);
    });
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(id);
    });
    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(0);
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);
  });

  it('categoryBreakdown reflects multiple categories correctly', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.STREAMING }));
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.GAMING }));
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.GAMING }));
    });

    const { categoryBreakdown } = useSubscriptionStore.getState().stats;
    expect(categoryBreakdown[SubscriptionCategory.STREAMING]).toBe(1);
    expect(categoryBreakdown[SubscriptionCategory.GAMING]).toBe(2);
  });
});
