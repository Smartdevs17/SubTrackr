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
 *  - walletStore (#62 + #69): consolidated with walletServiceManager as single
 *    source of truth; network mismatch detection; crypto stream create → cancel
 */

import { act } from 'react';
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSubscriptionStore } from '../subscriptionStore';
import { useInvoiceStore } from '../invoiceStore';
import { useWalletStore } from '../walletStore';
import { walletServiceManager } from '../../services/walletService';
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

// Mock networkService to avoid AsyncStorage calls in walletStore.setPreferredNetwork.
jest.mock('../../services/networkService', () => ({
  networkService: {
    getSelectedNetwork: jest.fn(() => Promise.resolve(null)),
    setSelectedNetwork: jest.fn(() => Promise.resolve(true)),
    checkNetworkHealth: jest.fn(() => Promise.resolve({ healthy: true })),
    getAvailableNetworks: jest.fn(() => Promise.resolve([])),
  },
}));

// Mock walletService so tests don't require ethers / Superfluid / native modules.
// We expose a real WalletServiceManager-like singleton so the store's listener
// subscription and setConnection/getConnection calls work correctly.
jest.mock('../../services/walletService', () => {
  type Listener = (conn: MockConnection | null) => void;
  type MockConnection = { address: string; chainId: number; isConnected: boolean };

  class MockWalletServiceManager {
    private static _instance: MockWalletServiceManager;
    private _connection: MockConnection | null = null;
    private _listeners: Listener[] = [];

    static getInstance() {
      if (!MockWalletServiceManager._instance) {
        MockWalletServiceManager._instance = new MockWalletServiceManager();
      }
      return MockWalletServiceManager._instance;
    }

    setConnection(conn: MockConnection | null) {
      this._connection = conn;
      this._listeners.forEach((l) => l(conn));
    }

    getConnection() {
      return this._connection;
    }

    addListener(l: Listener) {
      this._listeners.push(l);
    }

    removeListener(l: Listener) {
      const i = this._listeners.indexOf(l);
      if (i > -1) this._listeners.splice(i, 1);
    }

    async disconnectWallet() {
      this.setConnection(null);
    }

    async initialize() {}

    isConnected() {
      return this._connection?.isConnected ?? false;
    }
  }

  const instance = MockWalletServiceManager.getInstance();

  return {
    WalletServiceManager: MockWalletServiceManager,
    walletServiceManager: instance,
    PaymentMethodService: { getInstance: () => ({ canAddMethod: jest.fn(), validatePaymentMethodForm: jest.fn(), isDuplicateMethod: jest.fn(), generateId: jest.fn(), verifyPaymentMethod: jest.fn(), processPaymentWithFallback: jest.fn(), getExpiredMethods: jest.fn(() => []), getExpiringSoonMethods: jest.fn(() => []), checkExpiry: jest.fn(), getPrimaryMethods: jest.fn(() => []), getBackupMethods: jest.fn(() => []), getFallbackMethods: jest.fn(() => []), detectTokenContractUpgrade: jest.fn() }) },
    PaymentMethodError: class PaymentMethodError extends Error { constructor(public code: string, msg: string) { super(msg); } },
    PaymentMethodErrorCode: { DUPLICATE: 'DUPLICATE', INVALID_TOKEN: 'INVALID_TOKEN', MAX_METHODS: 'MAX_METHODS', VERIFICATION_FAILED: 'VERIFICATION_FAILED' },
    WalletError: class WalletError extends Error {},
    WalletErrorCode: {},
    errorTracker: { record: jest.fn() },
    default: instance,
  };
});

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
    address: null,
    chainId: null,
    network: null,
    isConnected: false,
    preferredNetwork: null,
    networkMismatch: null,
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
// walletStore — consolidated with walletServiceManager (#62)
// ═════════════════════════════════════════════════════════════════════════════

// walletServiceManager is the single source of truth for connection state.
// The store derives address/chainId/network/isConnected from it via a listener.
// There is no longer a `wallet` property or a `@subtrackr_wallet` storage key.

describe('walletStore integration', () => {
  // Reset walletServiceManager connection before each test so tests are isolated.
  beforeEach(() => {
    walletServiceManager.setConnection(null);
  });

  // ── connectWallet reflects walletServiceManager state ───────────────────────
  it('connectWallet reflects connection state from walletServiceManager', async () => {
    // Simulate an external wallet connection (e.g. AppKit callback)
    walletServiceManager.setConnection({
      address: '0xABC123',
      chainId: 1,
      isConnected: true,
    });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    const { address, chainId, network, isConnected, isLoading } = useWalletStore.getState();
    expect(address).toBe('0xABC123');
    expect(chainId).toBe(1);
    expect(network).toBe('Ethereum');
    expect(isConnected).toBe(true);
    expect(isLoading).toBe(false);
  });

  // ── connectWallet with no active connection leaves state disconnected ────────
  it('connectWallet with no active connection leaves store in disconnected state', async () => {
    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    const { address, isConnected, isLoading } = useWalletStore.getState();
    expect(address).toBeNull();
    expect(isConnected).toBe(false);
    expect(isLoading).toBe(false);
  });

  // ── syncWalletConnection updates store via walletServiceManager ─────────────
  it('syncWalletConnection sets connection state through walletServiceManager', async () => {
    await act(async () => {
      await useWalletStore.getState().syncWalletConnection({
        address: '0xDEF456',
        chainId: 137,
        network: 'Polygon',
      });
    });

    const { address, chainId, isConnected } = useWalletStore.getState();
    expect(address).toBe('0xDEF456');
    expect(chainId).toBe(137);
    expect(isConnected).toBe(true);
  });

  // ── disconnect clears connection state ──────────────────────────────────────
  it('disconnect clears address, chainId, network, and cryptoStreams', async () => {
    walletServiceManager.setConnection({
      address: '0xABC123',
      chainId: 1,
      isConnected: true,
    });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });

    const { address, chainId, network, isConnected, cryptoStreams, networkMismatch } =
      useWalletStore.getState();
    expect(address).toBeNull();
    expect(chainId).toBeNull();
    expect(network).toBeNull();
    expect(isConnected).toBe(false);
    expect(cryptoStreams).toHaveLength(0);
    expect(networkMismatch).toBeNull();
  });

  // ── walletServiceManager listener keeps store in sync ───────────────────────
  it('store stays in sync when walletServiceManager connection changes externally', async () => {
    // Simulate AppKit connecting
    act(() => {
      walletServiceManager.setConnection({
        address: '0xLIVE',
        chainId: 42161,
        isConnected: true,
      });
    });

    const { address, chainId, network, isConnected } = useWalletStore.getState();
    expect(address).toBe('0xLIVE');
    expect(chainId).toBe(42161);
    expect(network).toBe('Arbitrum');
    expect(isConnected).toBe(true);

    // Simulate AppKit disconnecting
    act(() => {
      walletServiceManager.setConnection(null);
    });

    expect(useWalletStore.getState().address).toBeNull();
    expect(useWalletStore.getState().isConnected).toBe(false);
  });

  // ── Multi-action: connect → disconnect → reconnect ──────────────────────────
  it('multi-action: connect → disconnect → reconnect restores wallet state', async () => {
    walletServiceManager.setConnection({ address: '0xABC', chainId: 1, isConnected: true });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isConnected).toBe(true);

    await act(async () => {
      await useWalletStore.getState().disconnect();
    });
    expect(useWalletStore.getState().isConnected).toBe(false);

    walletServiceManager.setConnection({ address: '0xABC', chainId: 1, isConnected: true });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });
    expect(useWalletStore.getState().isConnected).toBe(true);
    expect(useWalletStore.getState().address).toBe('0xABC');
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

  // ── Network detection (#69): detectNetworkMismatch ──────────────────────────
  it('detectNetworkMismatch sets networkMismatch when chainId differs from preferredNetwork', async () => {
    // Set up: connected to Polygon (137) but preferred is Ethereum (chainId 1)
    walletServiceManager.setConnection({ address: '0xABC', chainId: 137, isConnected: true });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    // Manually set preferredNetwork to Ethereum
    useWalletStore.setState({
      preferredNetwork: { id: 'ethereum', name: 'Ethereum', type: 'evm', chainId: 1 },
    });

    act(() => {
      useWalletStore.getState().detectNetworkMismatch();
    });

    const { networkMismatch } = useWalletStore.getState();
    expect(networkMismatch).not.toBeNull();
    expect(networkMismatch!.connectedChainId).toBe(137);
    expect(networkMismatch!.preferredNetwork.id).toBe('ethereum');
  });

  // ── Network detection (#69): no mismatch when chains match ──────────────────
  it('detectNetworkMismatch clears networkMismatch when chainId matches preferredNetwork', async () => {
    walletServiceManager.setConnection({ address: '0xABC', chainId: 1, isConnected: true });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    useWalletStore.setState({
      preferredNetwork: { id: 'ethereum', name: 'Ethereum', type: 'evm', chainId: 1 },
      networkMismatch: { connectedChainId: 137, preferredNetwork: { id: 'ethereum', name: 'Ethereum', type: 'evm', chainId: 1 } },
    });

    act(() => {
      useWalletStore.getState().detectNetworkMismatch();
    });

    expect(useWalletStore.getState().networkMismatch).toBeNull();
  });

  // ── Network detection (#69): Stellar networks never mismatch ────────────────
  it('detectNetworkMismatch ignores Stellar networks (no numeric chainId)', async () => {
    walletServiceManager.setConnection({ address: '0xABC', chainId: 1, isConnected: true });

    await act(async () => {
      await useWalletStore.getState().connectWallet();
    });

    useWalletStore.setState({
      preferredNetwork: { id: 'stellar-testnet', name: 'Stellar Testnet', type: 'stellar' },
    });

    act(() => {
      useWalletStore.getState().detectNetworkMismatch();
    });

    expect(useWalletStore.getState().networkMismatch).toBeNull();
  });
});
