import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useSubscriptionStore } from '../subscriptionStore';
import { BillingCycle, SubscriptionCategory, type Subscription } from '../../types/subscription';

jest.mock('react-native', () => ({
  Share: { share: jest.fn(() => Promise.resolve({ action: 'sharedAction' })) },
  Platform: { OS: 'ios', select: (spec: Record<string, unknown>) => spec.ios ?? spec.default },
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  InteractionManager: { runAfterInteractions: (cb: () => void) => cb() },
  Alert: { alert: jest.fn() },
  I18nManager: { isRTL: false, forceRTL: jest.fn() },
  Linking: { openURL: jest.fn(() => Promise.resolve()) },
  Vibration: { vibrate: jest.fn() },
  StyleSheet: { create: (styles: unknown) => styles, flatten: (styles: unknown) => styles },
}));

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

jest.mock('../../services/network/networkMonitor', () => ({
  networkMonitor: {
    isOnline: jest.fn(() => true),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  },
}));

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  name: 'Netflix',
  category: SubscriptionCategory.STREAMING,
  price: 9.99,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  nextBillingDate: new Date('2026-08-30T00:00:00.000Z'),
  isActive: true,
  notificationsEnabled: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

describe('subscription lifecycle history', () => {
  beforeEach(() => {
    useSubscriptionStore.setState({
      subscriptions: [],
      creditAccounts: {},
      pauseHistory: [],
      lifecycleHistory: [],
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
      syncStatus: 'idle',
      crdtMetadata: {},
    });
  });

  it('records timestamped events and filters them per subscription', () => {
    const store = useSubscriptionStore.getState();
    store.recordLifecycleEvent('sub-1', 'created');
    store.recordLifecycleEvent('sub-2', 'created');
    store.recordLifecycleEvent('sub-1', 'paused', 'Paused for 30 day(s)');

    const events = useSubscriptionStore.getState().getLifecycleHistory('sub-1');

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type).sort()).toEqual(['created', 'paused']);
    expect(events.every((event) => event.occurredAt instanceof Date)).toBe(true);
    expect(events.find((event) => event.type === 'paused')?.details).toBe('Paused for 30 day(s)');
    expect(useSubscriptionStore.getState().getLifecycleHistory()).toHaveLength(3);
  });

  it('returns the full history newest first', () => {
    useSubscriptionStore.setState({
      lifecycleHistory: [
        {
          id: 'evt-old',
          subscriptionId: 'sub-1',
          type: 'created',
          occurredAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 'evt-new',
          subscriptionId: 'sub-1',
          type: 'paused',
          occurredAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ],
    });

    const events = useSubscriptionStore.getState().getLifecycleHistory('sub-1');
    expect(events.map((event) => event.id)).toEqual(['evt-new', 'evt-old']);
  });

  it('records a created event when a subscription is added', async () => {
    await useSubscriptionStore.getState().addSubscription({
      name: 'Spotify',
      category: SubscriptionCategory.STREAMING,
      price: 11.99,
      currency: 'USD',
      billingCycle: BillingCycle.MONTHLY,
      nextBillingDate: new Date('2026-09-01T00:00:00.000Z'),
      isCryptoEnabled: false,
    });

    const sub = useSubscriptionStore.getState().subscriptions[0];
    const events = useSubscriptionStore.getState().getLifecycleHistory(sub.id);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('created');
    expect(events[0].details).toBe('Spotify added');
  });

  it('records a price change with old and new values', async () => {
    useSubscriptionStore.setState({ subscriptions: [makeSub()] });

    await useSubscriptionStore.getState().updateSubscription('sub-1', { price: 19.99 });

    const events = useSubscriptionStore.getState().getLifecycleHistory('sub-1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('price_changed');
    expect(events[0].details).toContain('9.99');
    expect(events[0].details).toContain('19.99');
  });

  it('records a generic update when no price change occurs', async () => {
    useSubscriptionStore.setState({ subscriptions: [makeSub()] });

    await useSubscriptionStore.getState().updateSubscription('sub-1', { name: 'Netflix Premium' });

    const events = useSubscriptionStore.getState().getLifecycleHistory('sub-1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('updated');
  });

  it('records pause and resume transitions from the status toggle', async () => {
    useSubscriptionStore.setState({ subscriptions: [makeSub()] });

    await useSubscriptionStore.getState().toggleSubscriptionStatus('sub-1');
    await useSubscriptionStore.getState().toggleSubscriptionStatus('sub-1');

    const types = useSubscriptionStore
      .getState()
      .getLifecycleHistory('sub-1')
      .map((event) => event.type)
      .sort();
    expect(types).toEqual(['paused', 'resumed']);
  });

  it('records a cancellation event when a subscription is removed', async () => {
    useSubscriptionStore.setState({ subscriptions: [makeSub()] });

    await useSubscriptionStore.getState().deleteSubscription('sub-1');

    const events = useSubscriptionStore.getState().getLifecycleHistory('sub-1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('cancelled');
  });
});
