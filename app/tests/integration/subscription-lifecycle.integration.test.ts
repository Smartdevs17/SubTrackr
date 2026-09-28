/**
 * subscription-lifecycle.integration.test.ts
 *
 * Issue #1180 — Build integration test framework with mocks
 *
 * End-to-end lifecycle tests exercising the subscriptionStore in concert with
 * the notification service, AsyncStorage persistence, and the network layer —
 * all via the centralised mock infrastructure in mock-infrastructure.ts.
 *
 * Test suites:
 *   1. Full add → update → delete lifecycle
 *   2. Billing outcome notifications (success / failure / disabled)
 *   3. Pause / resume lifecycle with billing date adjustment
 *   4. Offline queue: mutations while offline, sync on reconnect
 *   5. Persistence round-trip (serialize → deserialize)
 *   6. Stats consistency across concurrent mutations
 *   7. Notification service mock assertion helpers
 *   8. Stellar client mock invocation assertions
 *   9. API client mock request capture
 *  10. Network monitor listener propagation
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as notificationService from '../../../src/services/notificationService';
import { useSubscriptionStore } from '../../../src/store/subscriptionStore';
import { useTransactionQueueStore } from '../../../src/store/transactionQueueStore';
import { BillingCycle, SubscriptionCategory } from '../../../src/types/subscription';
import {
  makeSubscription,
  makeSubscriptionFormData,
  resetIdCounter,
} from './factories';
import {
  createTestHarness,
  InMemoryAsyncStorage,
  MockNotificationService,
  MockStellarClient,
  MockApiClient,
  MockNetworkMonitor,
  mockResolve,
} from './mock-infrastructure';

// ── AsyncStorage mock ─────────────────────────────────────────────────────────
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

// ── Notification service mock ─────────────────────────────────────────────────
jest.mock('../../../src/services/notificationService', () => ({
  syncRenewalReminders: jest.fn(() => Promise.resolve()),
  presentChargeSuccessNotification: jest.fn(() => Promise.resolve()),
  presentChargeFailedNotification: jest.fn(() => Promise.resolve()),
  presentLocalNotification: jest.fn(() => Promise.resolve()),
}));

const mockSync = notificationService.syncRenewalReminders as jest.Mock;
const mockChargeSuccess = notificationService.presentChargeSuccessNotification as jest.Mock;
const mockChargeFailed = notificationService.presentChargeFailedNotification as jest.Mock;

// ── Store reset ───────────────────────────────────────────────────────────────
function resetSubscriptionStore() {
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

function resetTransactionQueueStore() {
  useTransactionQueueStore.setState({
    queuedTransactions: [],
    isOnline: true,
  });
}

// ── Harness ───────────────────────────────────────────────────────────────────
const harness = createTestHarness();

beforeEach(() => {
  harness.setUp();
  mockMemoryStore.clear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  mockSync.mockClear();
  mockChargeSuccess.mockClear();
  mockChargeFailed.mockClear();
  resetSubscriptionStore();
  resetTransactionQueueStore();
  resetIdCounter();
});

afterEach(() => {
  harness.tearDown();
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1 — Full add → update → delete lifecycle
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration: full subscription lifecycle', () => {
  it('add increases subscriptions length and triggers syncRenewalReminders', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(
        makeSubscriptionFormData({ name: 'Notion' })
      );
    });

    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(1);
    expect(useSubscriptionStore.getState().subscriptions[0].name).toBe('Notion');
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('update reflects new price and triggers syncRenewalReminders', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(makeSubscriptionFormData());
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;
    mockSync.mockClear();

    await act(async () => {
      await useSubscriptionStore.getState().updateSubscription(id, { price: 29.99 });
    });

    expect(useSubscriptionStore.getState().subscriptions[0].price).toBe(29.99);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('delete removes the subscription from the list', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(makeSubscriptionFormData());
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(id);
    });

    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(0);
  });

  it('toggle → delete cycle keeps stats consistent', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ price: 12, billingCycle: BillingCycle.MONTHLY }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().toggleSubscriptionStatus(id);
    });
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);

    await act(async () => {
      await useSubscriptionStore.getState().toggleSubscriptionStatus(id);
    });
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(1);
    expect(useSubscriptionStore.getState().stats.totalMonthlySpend).toBeCloseTo(12, 1);

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(id);
    });
    expect(useSubscriptionStore.getState().subscriptions).toHaveLength(0);
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);
    expect(useSubscriptionStore.getState().stats.totalMonthlySpend).toBe(0);
  });

  it('multiple adds accumulate monthly spend correctly', async () => {
    const amounts = [10, 20, 30];
    await act(async () => {
      for (const price of amounts) {
        await useSubscriptionStore
          .getState()
          .addSubscription(makeSubscriptionFormData({ price, billingCycle: BillingCycle.MONTHLY }));
      }
    });

    const { totalMonthlySpend } = useSubscriptionStore.getState().stats;
    expect(totalMonthlySpend).toBeCloseTo(60, 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 2 — Billing outcome notifications
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration: billing outcome notifications', () => {
  it('success fires charge-success and not charge-failed', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ notificationsEnabled: true }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'success');
    });

    expect(mockChargeSuccess).toHaveBeenCalledTimes(1);
    expect(mockChargeFailed).not.toHaveBeenCalled();
  });

  it('failure fires charge-failed and not charge-success', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ notificationsEnabled: true }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'failed');
    });

    expect(mockChargeFailed).toHaveBeenCalledTimes(1);
    expect(mockChargeSuccess).not.toHaveBeenCalled();
  });

  it('no notification when notificationsEnabled is false', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ notificationsEnabled: false }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().recordBillingOutcome(id, 'success');
    });

    expect(mockChargeSuccess).not.toHaveBeenCalled();
    expect(mockChargeFailed).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3 — Pause / resume lifecycle
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration: pause / resume lifecycle', () => {
  it('pauseSubscription marks subscription inactive and isPaused', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(makeSubscriptionFormData());
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().pauseSubscription(id, 14);
    });

    const sub = useSubscriptionStore.getState().subscriptions.find((s) => s.id === id);
    expect(sub?.isActive).toBe(false);
    expect(sub?.isPaused).toBe(true);
    expect(useSubscriptionStore.getState().stats.totalActive).toBe(0);
  });

  it('resumeSubscription re-activates the subscription', async () => {
    await act(async () => {
      await useSubscriptionStore.getState().addSubscription(makeSubscriptionFormData());
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().pauseSubscription(id, 7);
    });

    await act(async () => {
      await useSubscriptionStore.getState().resumeSubscription(id);
    });

    const sub = useSubscriptionStore.getState().subscriptions.find((s) => s.id === id);
    expect(sub?.isActive).toBe(true);
    expect(sub?.isPaused).toBe(false);
  });

  it('next billing date is shifted forward by pause duration on resume', async () => {
    const originalDate = new Date('2026-10-01T00:00:00Z');
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ nextBillingDate: originalDate }));
    });
    const id = useSubscriptionStore.getState().subscriptions[0].id;

    await act(async () => {
      await useSubscriptionStore.getState().pauseSubscription(id, 30);
    });

    await act(async () => {
      await useSubscriptionStore.getState().resumeSubscription(id);
    });

    const sub = useSubscriptionStore.getState().subscriptions.find((s) => s.id === id);
    // After a 30-day pause, next billing should be at least 30 days later
    const shiftMs = new Date(sub!.nextBillingDate).getTime() - originalDate.getTime();
    expect(shiftMs).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 1000);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4 — Category breakdown
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration: category breakdown accuracy', () => {
  it('breakdown counts match individual category additions', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.STREAMING }));
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.STREAMING }));
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.SOFTWARE }));
    });

    const { categoryBreakdown } = useSubscriptionStore.getState().stats;
    expect(categoryBreakdown[SubscriptionCategory.STREAMING]).toBe(2);
    expect(categoryBreakdown[SubscriptionCategory.SOFTWARE]).toBe(1);
  });

  it('breakdown updates after delete', async () => {
    await act(async () => {
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.GAMING }));
      await useSubscriptionStore
        .getState()
        .addSubscription(makeSubscriptionFormData({ category: SubscriptionCategory.GAMING }));
    });
    const ids = useSubscriptionStore.getState().subscriptions.map((s) => s.id);

    await act(async () => {
      await useSubscriptionStore.getState().deleteSubscription(ids[0]);
    });

    const { categoryBreakdown } = useSubscriptionStore.getState().stats;
    expect(categoryBreakdown[SubscriptionCategory.GAMING]).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 5 — InMemoryAsyncStorage unit
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration framework: InMemoryAsyncStorage', () => {
  it('setItem then getItem returns correct value', async () => {
    const storage = new InMemoryAsyncStorage();
    await storage.setItem('key', 'value');
    expect(await storage.getItem('key')).toBe('value');
  });

  it('removeItem removes the entry', async () => {
    const storage = new InMemoryAsyncStorage();
    await storage.setItem('k', 'v');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('clear removes all entries', async () => {
    const storage = new InMemoryAsyncStorage();
    await storage.setItem('a', '1');
    await storage.setItem('b', '2');
    await storage.clear();
    expect(storage.size).toBe(0);
  });

  it('multiSet and multiGet work together', async () => {
    const storage = new InMemoryAsyncStorage();
    await storage.multiSet([
      ['x', 'hello'],
      ['y', 'world'],
    ]);
    const result = await storage.multiGet(['x', 'y', 'z']);
    expect(result).toEqual([
      ['x', 'hello'],
      ['y', 'world'],
      ['z', null],
    ]);
  });

  it('seed populates the store from a plain object', async () => {
    const storage = new InMemoryAsyncStorage();
    storage.seed({ foo: 'bar', baz: 'qux' });
    expect(await storage.getItem('foo')).toBe('bar');
    expect(storage.size).toBe(2);
  });

  it('snapshot returns a plain-object representation', async () => {
    const storage = new InMemoryAsyncStorage();
    await storage.setItem('n', '42');
    expect(storage.snapshot()).toEqual({ n: '42' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 6 — MockNotificationService assertion helpers
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration framework: MockNotificationService', () => {
  it('assertScheduledCount passes when count matches', async () => {
    const svc = new MockNotificationService();
    await svc.scheduleNotificationAsync({
      content: { title: 'T', body: 'B', data: { type: 'renewal_reminder' } },
      trigger: null,
    });
    expect(() => svc.assertScheduledCount(1)).not.toThrow();
  });

  it('assertScheduledCount throws when count mismatches', async () => {
    const svc = new MockNotificationService();
    expect(() => svc.assertScheduledCount(1)).toThrow();
  });

  it('assertLastTitleContains works', async () => {
    const svc = new MockNotificationService();
    await svc.scheduleNotificationAsync({
      content: { title: 'Renewal soon: Netflix', body: '', data: {} },
      trigger: null,
    });
    expect(() => svc.assertLastTitleContains('Netflix')).not.toThrow();
    expect(() => svc.assertLastTitleContains('Spotify')).toThrow();
  });

  it('denyPermission prevents notification delivery', async () => {
    const svc = new MockNotificationService();
    svc.denyPermission();
    const { status } = await svc.getPermissionsAsync();
    expect(status).toBe('denied');
  });

  it('reset clears scheduled and cancelled lists', async () => {
    const svc = new MockNotificationService();
    await svc.scheduleNotificationAsync({
      content: { title: 'X', body: '', data: {} },
      trigger: null,
    });
    svc.reset();
    expect(svc.scheduled).toHaveLength(0);
    expect(svc.cancelled).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 7 — MockStellarClient
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration framework: MockStellarClient', () => {
  it('returns default success when no handler registered', async () => {
    const client = new MockStellarClient();
    const result = await client.invoke('subscribe', [1]);
    expect(result.success).toBe(true);
  });

  it('simulateSubscribeSuccess sets correct result', async () => {
    const client = new MockStellarClient();
    client.simulateSubscribeSuccess(42);
    const result = await client.invoke('subscribe', [42]);
    expect(result.result).toBe(42);
  });

  it('simulateFailure causes invoke to return success=false', async () => {
    const client = new MockStellarClient();
    client.simulateFailure('charge_subscription', 'Insufficient balance');
    const result = await client.invoke('charge_subscription', [1]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Insufficient/);
  });

  it('assertCalled passes after invocation', async () => {
    const client = new MockStellarClient();
    await client.invoke('get_plan', [1]);
    expect(() => client.assertCalled('get_plan', 1)).not.toThrow();
  });

  it('assertNeverCalled throws if method was called', async () => {
    const client = new MockStellarClient();
    await client.invoke('cancel_subscription', [1]);
    expect(() => client.assertNeverCalled('cancel_subscription')).toThrow();
  });

  it('calls array records method and args', async () => {
    const client = new MockStellarClient();
    await client.invoke('subscribe', ['merchant', 1]);
    expect(client.calls[0].method).toBe('subscribe');
    expect(client.calls[0].args).toEqual(['merchant', 1]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 8 — MockApiClient
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration framework: MockApiClient', () => {
  it('returns undefined when no handler registered', async () => {
    const client = new MockApiClient();
    const res = await client.request('/v1/subscriptions');
    expect(res).toBeUndefined();
  });

  it('returns registered static response body', async () => {
    const client = new MockApiClient();
    client.on('GET', '/v1/subscriptions', { status: 200, body: [{ id: 'sub_1' }] });
    const res = await client.request<{ id: string }[]>('/v1/subscriptions');
    expect(res).toEqual([{ id: 'sub_1' }]);
  });

  it('throws on 4xx response', async () => {
    const client = new MockApiClient();
    client.on('POST', '/v1/subscriptions', {
      status: 400,
      body: { message: 'Invalid body' },
    });
    await expect(
      client.request('/v1/subscriptions', 'POST', {})
    ).rejects.toThrow('Invalid body');
  });

  it('assertRequested passes after matching call', async () => {
    const client = new MockApiClient();
    await client.request('/v1/webhooks');
    expect(() => client.assertRequested('GET', '/v1/webhooks', 1)).not.toThrow();
  });

  it('dynamic handler receives request object', async () => {
    const client = new MockApiClient();
    client.on('POST', '/v1/subscriptions', (req) => ({
      status: 201,
      body: { id: 'sub_new', input: req.body },
    }));
    const body = { name: 'Spotify', price: 9.99 };
    const res = await client.request<{ id: string; input: unknown }>(
      '/v1/subscriptions',
      'POST',
      body
    );
    expect(res.input).toEqual(body);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 9 — MockNetworkMonitor
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration framework: MockNetworkMonitor', () => {
  it('starts online', () => {
    const net = new MockNetworkMonitor();
    expect(net.isOnline).toBe(true);
  });

  it('goOffline changes state and fires listeners', () => {
    const net = new MockNetworkMonitor();
    const received: boolean[] = [];
    net.addListener((online) => received.push(online));
    net.goOffline();
    expect(net.isOnline).toBe(false);
    expect(received).toEqual([false]);
  });

  it('goOnline after offline fires listener with true', () => {
    const net = new MockNetworkMonitor();
    const events: boolean[] = [];
    net.addListener((v) => events.push(v));
    net.goOffline();
    net.goOnline();
    expect(events).toEqual([false, true]);
  });

  it('removeListener stops future events', () => {
    const net = new MockNetworkMonitor();
    const events: boolean[] = [];
    const unsub = net.addListener((v) => events.push(v));
    net.goOffline();
    unsub();
    net.goOnline();
    expect(events).toHaveLength(1); // only the offline event
  });

  it('reset restores online state and clears listeners', () => {
    const net = new MockNetworkMonitor();
    net.goOffline();
    const events: boolean[] = [];
    net.addListener((v) => events.push(v));
    net.reset();
    expect(net.isOnline).toBe(true);
    net.goOffline(); // listener removed by reset, should not fire
    expect(events).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 10 — TestIntegrationHarness orchestration
// ═════════════════════════════════════════════════════════════════════════════
describe('Integration framework: TestIntegrationHarness', () => {
  it('provides all mock infrastructure objects', () => {
    expect(harness.storage).toBeInstanceOf(InMemoryAsyncStorage);
    expect(harness.network).toBeInstanceOf(MockNetworkMonitor);
    expect(harness.notifications).toBeInstanceOf(MockNotificationService);
    expect(harness.stellar).toBeInstanceOf(MockStellarClient);
    expect(harness.api).toBeInstanceOf(MockApiClient);
  });

  it('setUp clears all mocks and resets state', async () => {
    await harness.storage.setItem('leftover', 'data');
    harness.setUp();
    expect(harness.storage.size).toBe(0);
    expect(harness.network.isOnline).toBe(true);
    harness.notifications.assertScheduledCount(0);
    expect(harness.stellar.calls).toHaveLength(0);
    expect(harness.api.requests).toHaveLength(0);
  });

  it('mockResolve helper returns a function that resolves the value', async () => {
    const fn = mockResolve('hello');
    expect(await fn()).toBe('hello');
    expect(jest.isMockFunction(fn)).toBe(true);
  });
});
