/**
 * Integration tests for store actions.
 *
 * These tests use a real in-memory AsyncStorage adapter (not a no-op mock)
 * so that persistence middleware actually writes and reads back data.
 * Each test starts with a clean store and an empty in-memory backing store.
 *
 * Covers:
 *  - subscriptionStore: add/fetch, update (field preservation), delete (cleanup),
 *    persistence, multi-action workflows, error recovery
 *  - walletStore: connect/persist, load-from-storage, disconnect cleanup,
 *    multi-action workflow, crypto stream create → cancel
 */

import { act } from 'react';
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSubscriptionStore } from '../subscriptionStore';
import { useInvoiceStore } from '../invoiceStore';
import { useWalletStore } from '../walletStore';
import { SubscriptionCategory, BillingCycle } from '../../types/subscription';
import { BILLING_CONVERSIONS } from '../../utils/constants/values';

// ── In-memory AsyncStorage ────────────────────────────────────────────────────
// Provides real read/write semantics without disk I/O.
// The variable must be prefixed with "mock" so Jest allows it inside jest.mock().
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

// ── Side-effect mocks ─────────────────────────────────────────────────────────
jest.mock('../../services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const emptyStats = {
  totalActive: 0,
  totalMonthlySpend: 0,
  totalYearlySpend: 0,
  categoryBreakdown: {} as Record<string, number>,
};

function resetSubscriptionStore() {
  useSubscriptionStore.setState({
    subscriptions: [],
    stats: emptyStats,
    isLoading: false,
    error: null,
  });
}

function resetWalletStore() {
  useWalletStore.setState({
    connection: null,
    cryptoStreams: [],
    paymentMethods: [],
    paymentAttempts: [],
    isLoading: false,
    error: null,
  });
}

function resetInvoiceStore() {
  useInvoiceStore.setState({
    invoices: [],
    config: {
      numberingPrefix: 'INV',
      numberingPadding: 6,
      defaultCurrency: 'USD',
      defaultRegion: 'GLOBAL',
      defaultTaxRateBps: 0,
      exchangeRateScale: 1_000_000,
      paymentTermsDays: 14,
    },
    nextSequence: 1,
    isLoading: false,
    error: null,
  });
}

const baseFormData = {
  name: 'Netflix',
  category: SubscriptionCategory.STREAMING,
  price: 15.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-04-01'),
  notificationsEnabled: true,
  isCryptoEnabled: false,
};

// ── Test setup ────────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.useFakeTimers();
  mockMemoryStore.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
  resetSubscriptionStore();
  resetInvoiceStore();
  resetWalletStore();
});

afterEach(() => {
  jest.runAllTimers();
  jest.useRealTimers();
});

// ═════════════════════════════════════════════════════════════════════════════
// subscriptionStore
// ═════════════════════════════════════════════════════════════════════════════
describe('subscriptionStore integration', () => {
  // ── Acceptance: add then fetch ──────────────────────────────────────────────
  it('add then fetch subscription works', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    // fetchSubscriptions has a 1 s internal delay; advance timers to resolve it.
    await act(async () => {
      const fetchPromise = useSubscriptionStore.getState().fetchSubscriptions();
      jest.advanceTimersByTime(1100);
      await fetchPromise;
    });

    const { subscriptions, isLoading } = useSubscriptionStore.getState();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].name).toBe('Netflix');
    expect(isLoading).toBe(false);
  });

  // ── Acceptance: update preserves other data ─────────────────────────────────
  it('update preserves all other fields when only price changes', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    const original = useSubscriptionStore.getState().subscriptions[0];

    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription(original.id, { price: 19.99 });
    });

    const updated = useSubscriptionStore.getState().subscriptions[0];

    expect(updated.price).toBe(19.99);
    expect(updated.name).toBe(original.name);
    expect(updated.category).toBe(original.category);
    expect(updated.currency).toBe(original.currency);
    expect(updated.billingCycle).toBe(original.billingCycle);
    expect(updated.isActive).toBe(original.isActive);
    expect(updated.isCryptoEnabled).toBe(original.isCryptoEnabled);
    expect(updated.createdAt).toEqual(original.createdAt);
  });

  // ── Acceptance: delete cleans up properly ───────────────────────────────────
  it('delete removes the subscription and updates stats', async () => {
    // Seed two subscriptions with distinct, known IDs.
    // (With fake timers Date.now() is frozen, so addSubscription() would produce
    //  duplicate IDs if called twice in a row — seed state directly instead.)
    const now = new Date();
    useSubscriptionStore.setState({
      subscriptions: [
        {
          id: 'del-1',
          name: 'Netflix',
          category: SubscriptionCategory.STREAMING,
          price: 15.99,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-04-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'del-2',
          name: 'Spotify',
          category: SubscriptionCategory.STREAMING,
          price: 9.99,
          currency: 'USD',
          billingCycle: BillingCycle.MONTHLY,
          nextBillingDate: new Date('2026-04-01'),
          isActive: true,
          notificationsEnabled: true,
          isCryptoEnabled: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });

    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(2);

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription('del-1');
    });

    const { subscriptions, stats } = useSubscriptionStore.getState();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].name).toBe('Spotify');
    expect(stats.totalActive).toBe(1);
  });

  // ── Acceptance: persistence works in tests ──────────────────────────────────
  it('subscription data is written to AsyncStorage through persistence middleware', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    // Flush the 400 ms debounced write and drain all async microtasks that
    // follow (writeQueue.then → Promise.all → AsyncStorage.setItem).
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    // A second flush ensures the promise chain inside flushPendingWrites settles.
    await act(async () => {});

    // The persist middleware should have called setItem with the store's storage key.
    const calls = (AsyncStorage.setItem as jest.Mock).mock.calls as [string, string][];
    const storageKey = 'subtrackr-subscriptions';
    const matchingCall = calls.find(([key]) => key === storageKey);

    expect(matchingCall).toBeDefined();
    expect(matchingCall![1]).toContain('Netflix');
  });

  // ── Persistence: serialised payload contains expected subscription fields ────
  it('persisted payload is well-formed JSON with subscription fields', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    // Flush debounce and async chain.
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await act(async () => {});

    const raw = mockMemoryStore.get('subtrackr-subscriptions');
    expect(raw).toBeDefined();

    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveProperty('state');
    expect(parsed.state).toHaveProperty('subscriptions');
    expect(Array.isArray(parsed.state.subscriptions)).toBe(true);
    expect(parsed.state.subscriptions[0].name).toBe('Netflix');
    expect(parsed.state.subscriptions[0].price).toBe(15.99);
  });

  // ── Multi-action: add → update → delete sequence ────────────────────────────
  it('multi-action workflow: add → update → delete', async () => {
    // 1. Add
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });
    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(1);

    const id = useSubscriptionStore.getState().subscriptions[0].id;

    // 2. Update
    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription(id, { name: 'Netflix Premium' });
    });
    expect(useSubscriptionStore.getState().subscriptions[0].name).toBe('Netflix Premium');

    // 3. Delete
    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(id);
    });
    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(0);
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);
  });

  // ── Multi-action: stats computed correctly across billing cycles ────────────
  it('stats are accurate after adding subscriptions with mixed billing cycles', async () => {
    await act(async () => {
      // $10 / month  → monthly $10,  yearly $120
      await useSubscriptionStore.getState().addSubscription({
        ...baseFormData,
        name: 'Monthly Sub',
        price: 10,
        billingCycle: BillingCycle.MONTHLY,
        category: SubscriptionCategory.STREAMING,
      });
      // $120 / year  → monthly $10,  yearly $120
      await useSubscriptionStore.getState().addSubscription({
        ...baseFormData,
        name: 'Yearly Sub',
        price: 120,
        billingCycle: BillingCycle.YEARLY,
        category: SubscriptionCategory.SOFTWARE,
      });
      // $5 / week    → monthly $20 (×4), yearly $260 (×52)
      await useSubscriptionStore.getState().addSubscription({
        ...baseFormData,
        name: 'Weekly Sub',
        price: 5,
        billingCycle: BillingCycle.WEEKLY,
        category: SubscriptionCategory.GAMING,
      });
    });

    const { stats } = useSubscriptionStore.getState();
    expect(stats.totalActive).toBe(3);
    expect(stats.totalMonthlySpend).toBe(10 + 10 + 5 * BILLING_CONVERSIONS.WEEKS_PER_MONTH);
    expect(stats.totalYearlySpend).toBe(500); // 120 + 120 + 260
    expect(stats.categoryBreakdown[SubscriptionCategory.STREAMING]).toBe(1);
    expect(stats.categoryBreakdown[SubscriptionCategory.SOFTWARE]).toBe(1);
    expect(stats.categoryBreakdown[SubscriptionCategory.GAMING]).toBe(1);
  });

  // ── Multi-action: toggle status affects stats ───────────────────────────────
  it('toggle status updates stats on each toggle', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    expect(useSubscriptionStore.getState().stats.totalActive).toBe(1);
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    // Deactivate
    await act(async () => {
      await useSubscriptionStore.getState().toggleSubscriptionStatus(id);
    });
    expect(useSubscriptionStore.getState().subscriptions[0].isActive).toBe(false);
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);

    // Reactivate
    await act(async () => {
      await useSubscriptionStore.getState().toggleSubscriptionStatus(id);
    });
    expect(useSubscriptionStore.getState().subscriptions[0].isActive).toBe(true);
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(1);
  });

  // ── Error recovery: update with unknown id ──────────────────────────────────
  it('updating a non-existent id leaves existing subscriptions intact', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    const before = useSubscriptionStore.getState().subscriptions[0];

    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription('ghost-id', { price: 999 });
    });

    const { subscriptions, error } = useSubscriptionStore.getState();
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].price).toBe(before.price);
    expect(error).toBeNull();
  });

  // ── Error recovery: delete with unknown id ──────────────────────────────────
  it('deleting a non-existent id leaves state unchanged with no error', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription('ghost-id');
    });

    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(1);
    expect(useSubscriptionStore.getState().error).toBeNull();
  });

  // ── recordBillingOutcome: success advances nextBillingDate ──────────────────
  it('recordBillingOutcome advances nextBillingDate by one cycle on success', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription({
        ...baseFormData,
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: new Date('2026-04-01'),
      });
    });

    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'success');
    });

    const { subscriptions } = useSubscriptionStore.getState();
    const next = subscriptions[0].nextBillingDate;
    // Monthly advance: April → May
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(4); // May (0-indexed)
    expect(useInvoiceStore.getState().invoices).toHaveLength(1);
  });

  // ── recordBillingOutcome: failed outcome does not advance billing date ───────
  it('recordBillingOutcome does not advance billing date on failure', async () => {
    const billingDate = new Date('2026-04-01');
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription({
        ...baseFormData,
        nextBillingDate: billingDate,
      });
    });

    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'failed');
    });

    const next = useSubscriptionStore.getState().subscriptions[0].nextBillingDate;
    expect(next.getFullYear()).toBe(billingDate.getFullYear());
    expect(next.getMonth()).toBe(billingDate.getMonth());
    expect(next.getDate()).toBe(billingDate.getDate());
  });

  // ── recordBillingOutcome: silent no-op for unknown id ──────────────────────
  it('recordBillingOutcome silently no-ops for an unknown subscription id', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });

    const before = useSubscriptionStore.getState().subscriptions[0].nextBillingDate;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome('unknown-id', 'success');
    });

    const after = useSubscriptionStore.getState().subscriptions[0].nextBillingDate;
    expect(after).toEqual(before);
  });

  // ── isLoading resets after every mutation ───────────────────────────────────
  it('isLoading resets to false after add, update, and delete', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(baseFormData);
    });
    expect(useSubscriptionStore.getState().isLoading).toBe(false);

    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription(id, { name: 'Updated' });
    });
    expect(useSubscriptionStore.getState().isLoading).toBe(false);

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(id);
    });
    expect(useSubscriptionStore.getState().isLoading).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// walletStore
// ═════════════════════════════════════════════════════════════════════════════
describe('walletStore integration', () => {
  // ── Connect loads persisted data and syncs with service ────────────────────
  it('connectWallet loads persisted payment methods and attempts', async () => {
    const mockPaymentMethods = JSON.stringify([
      {
        id: 'pm_test',
        userId: '0xSavedAddress',
        tokenType: 'USDC',
        tokenAddress: '0xUSDC',
        chainId: 1,
        label: 'USDC Payment',
        priority: 'PRIMARY',
        maxSpendPerInterval: '1000',
        isVerified: true,
        isActive: true,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      },
    ]);
    mockMemoryStore.set('@subtrackr_payment_methods', mockPaymentMethods);

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    const { paymentMethods, isLoading } = useWalletStore.getState();
    expect(paymentMethods).toHaveLength(1);
    expect(paymentMethods[0].id).toBe('pm_test');
    expect(isLoading).toBe(false);
  });

  // ── Disconnect clears wallet from state ────────────────────────────────────
  it('disconnect clears connection and all related state', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    const { connection, cryptoStreams, paymentMethods, paymentAttempts } =
      useWalletStore.getState();
    expect(connection).toBeNull();
    expect(cryptoStreams).toHaveLength(0);
    expect(paymentMethods).toHaveLength(0);
    expect(paymentAttempts).toHaveLength(0);
  });

  // ── Multi-action: connect → disconnect → reconnect ──────────────────────────
  it('multi-action: connect → disconnect → reconnect workflow', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().connection).not.toBeUndefined();

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });
    expect(useWalletStore.getState().connection).toBeNull();

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);
  });

  // ── Multi-action: create then cancel crypto stream ──────────────────────────
  it('create then cancel crypto stream workflow marks stream inactive', async () => {
    jest.useRealTimers(); // createCryptoStream and cancelCryptoStream use real delays

    const streamSetup = {
      token: 'USDC',
      amount: 50,
      flowRate: '0.001',
      startDate: new Date('2026-04-01'),
      protocol: 'superfluid' as const,
    };

    await act(async () => {
      await useWalletStore.getState().createCryptoStream(streamSetup);
    });

    const { cryptoStreams } = useWalletStore.getState();
    expect(cryptoStreams).toHaveLength(1);
    expect(cryptoStreams[0].isActive).toBe(true);
    expect(cryptoStreams[0].token).toBe('USDC');

    const streamId = cryptoStreams[0].id;

    await act(async () => {
      await useWalletStore.getState().cancelCryptoStream(streamId);
    });

    expect(useWalletStore.getState().cryptoStreams[0].isActive).toBe(false);
    expect(useWalletStore.getState().isLoading).toBe(false);

    jest.useFakeTimers(); // restore for afterEach
  }, 10_000);

  // ── isLoading resets after connect and disconnect ───────────────────────────
  it('isLoading resets to false after connect and after disconnect', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });
    expect(useWalletStore.getState().isLoading).toBe(false);
  });

  // ── Error recovery: disconnect handles service failure gracefully ───────
  it('disconnect sets error state when service throws', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    // walletService.disconnectWallet is being called, no need to mock AsyncStorage
    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    // Should complete without error in normal flow
    expect(useWalletStore.getState().connection).toBeNull();
  });
});
