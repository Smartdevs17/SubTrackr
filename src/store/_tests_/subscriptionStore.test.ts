import { act } from 'react';
import { expect, describe, it, beforeEach, jest } from '@jest/globals';
import { useSubscriptionStore } from '../subscriptionStore';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';

// 🔥 Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(),
}));

// 🔥 Mock notification + side effects
jest.mock('../../services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../utils/billingDate', () => ({
  advanceBillingDate: jest.fn((date) => date),
}));

describe('subscriptionStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSubscriptionStore.setState({
      subscriptions: [],
      stats: {
        totalActive: 0,
        totalMonthlySpend: 0,
        totalYearlySpend: 0,
        categoryBreakdown: {
          [SubscriptionCategory.STREAMING]: 0,
          [SubscriptionCategory.FITNESS]: 0,
          [SubscriptionCategory.SOFTWARE]: 0,
          [SubscriptionCategory.GAMING]: 0,
          [SubscriptionCategory.PRODUCTIVITY]: 0,
          [SubscriptionCategory.FINANCE]: 0,
          [SubscriptionCategory.EDUCATION]: 0,
          [SubscriptionCategory.OTHER]: 0,
        },
      },
      isLoading: false,
      error: null,
    });
  });

  // =========================
  // ADD SUBSCRIPTION
  // =========================
  it('adds a subscription', async () => {
    const store = useSubscriptionStore.getState();

    await act(async () => {
      await store.addSubscription({
        name: 'Netflix',
        category: SubscriptionCategory.STREAMING,
        price: 10,
        currency: 'USD',
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: new Date(),
        notificationsEnabled: true,
        isCryptoEnabled: false,
      });
    });

    const state = useSubscriptionStore.getState();
    expect(state.subscriptions.length).toBe(1);
    expect(state.subscriptions[0].name).toBe('Netflix');
  });

  // =========================
  // UPDATE SUBSCRIPTION
  // =========================
  it('updates a subscription', async () => {
    const id = '1';

    useSubscriptionStore.setState({
      subscriptions: [
        {
          id,
          name: 'Old Name',
          category: SubscriptionCategory.OTHER,
          price: 5,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date(),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription(id, {
        name: 'New Name',
      });
    });

    const updated = useSubscriptionStore.getState().subscriptions[0];
    expect(updated.name).toBe('New Name');
  });

  // =========================
  // DELETE SUBSCRIPTION
  // =========================
  it('deletes a subscription', async () => {
    const id = '1';

    useSubscriptionStore.setState({
      subscriptions: [
        {
          id,
          name: 'To Delete',
          category: SubscriptionCategory.OTHER,
          price: 5,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date(),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(id);
    });

    expect(useSubscriptionStore.getState().subscriptions.length).toBe(0);
  });

  // =========================
  // CALCULATE STATS
  // =========================
  it('calculates stats correctly', () => {
    useSubscriptionStore.setState({
      subscriptions: [
        {
          id: '1',
          name: 'Monthly Sub',
          category: SubscriptionCategory.STREAMING,
          price: 10,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date(),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          name: 'Yearly Sub',
          category: SubscriptionCategory.OTHER,
          price: 120,
          currency: 'USD',
          billingCycle: BillingCycle.YEARLY,
          nextBillingDate: new Date(),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    act(() => {
      useSubscriptionStore.getState().calculateStats();
    });

    const stats = useSubscriptionStore.getState().stats;

    expect(stats.totalActive).toBe(2);
    expect(stats.totalMonthlySpend).toBe(20); // 10 + (120/12)
    expect(stats.totalYearlySpend).toBe(240); // (10*12) + 120
    expect(stats.categoryBreakdown[SubscriptionCategory.STREAMING]).toBe(1);
  });

  // =========================
  // EDGE CASE: EMPTY STATE
  // =========================
  it('handles empty subscriptions safely', () => {
    useSubscriptionStore.setState({ subscriptions: [] });

    act(() => {
      useSubscriptionStore.getState().calculateStats();
    });

    const stats = useSubscriptionStore.getState().stats;

    expect(stats.totalActive).toBe(0);
    expect(stats.totalMonthlySpend).toBe(0);
    expect(stats.totalYearlySpend).toBe(0);
  });

  // =========================
  // EDGE CASE: SINGLE ITEM
  // =========================
  it('handles single subscription correctly', () => {
    useSubscriptionStore.setState({
      subscriptions: [
        {
          id: '1',
          name: 'Single',
          category: SubscriptionCategory.OTHER,
          price: 50,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date(),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    act(() => {
      useSubscriptionStore.getState().calculateStats();
    });

    const stats = useSubscriptionStore.getState().stats;

    expect(stats.totalActive).toBe(1);
    expect(stats.totalMonthlySpend).toBe(50);
    expect(stats.totalYearlySpend).toBe(600);
  });
});
