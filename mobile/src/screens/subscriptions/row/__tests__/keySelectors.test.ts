import {
  areRowPropsEqual,
  createKeyExtractor,
  createStableRowKeySelector,
  isSameSubscriptionRow,
  subscriptionRowKey,
} from '../keySelectors';
import type { SubscriptionRowData } from '../types';

function makeSubscription(overrides: Partial<SubscriptionRowData> = {}): SubscriptionRowData {
  return {
    id: 'sub-1',
    name: 'Netflix',
    category: 'streaming',
    price: 15.99,
    currency: 'USD',
    isActive: true,
    nextBillingDate: '2026-12-01',
    updatedAt: '2026-11-01',
    ...overrides,
  };
}

describe('subscriptionRowKey', () => {
  it('uses the subscription id and ignores the index', () => {
    const subscription = makeSubscription();
    expect(subscriptionRowKey(subscription, 0)).toBe('subscription:sub-1');
    expect(subscriptionRowKey(subscription, 42)).toBe('subscription:sub-1');
  });

  it('falls back to a deterministic key for optimistic inserts', () => {
    const pending = makeSubscription({ id: '' });
    expect(subscriptionRowKey(pending, 3)).toBe(subscriptionRowKey(pending, 3));
    expect(subscriptionRowKey(pending, 3)).not.toBe(subscriptionRowKey(pending, 4));
  });
});

describe('createStableRowKeySelector', () => {
  it('supports a custom namespace', () => {
    const selector = createStableRowKeySelector('search');
    expect(selector(makeSubscription())).toBe('search:sub-1');
    expect(selector(makeSubscription({ id: '' }), 1)).toContain('search:Netflix');
  });
});

describe('isSameSubscriptionRow', () => {
  it('treats equal content in a new object as the same row', () => {
    expect(isSameSubscriptionRow(makeSubscription(), makeSubscription())).toBe(true);
  });

  it('detects changes to rendered fields', () => {
    const original = makeSubscription();
    expect(isSameSubscriptionRow(original, makeSubscription({ price: 19.99 }))).toBe(false);
    expect(isSameSubscriptionRow(original, makeSubscription({ isPaused: true }))).toBe(false);
    expect(isSameSubscriptionRow(original, undefined)).toBe(false);
  });
});

describe('areRowPropsEqual', () => {
  const onPress = jest.fn();
  const base = {
    subscription: makeSubscription(),
    onPress,
    index: 0,
  };

  it('returns true for equivalent props', () => {
    expect(areRowPropsEqual(base, { ...base, subscription: makeSubscription() })).toBe(true);
  });

  it('returns false when a callback or the index changes', () => {
    expect(areRowPropsEqual(base, { ...base, index: 1 })).toBe(false);
    expect(areRowPropsEqual(base, { ...base, onPress: jest.fn() })).toBe(false);
  });
});

describe('createKeyExtractor', () => {
  it('is compatible with FlatList keyExtractor signatures', () => {
    const extractor = createKeyExtractor();
    expect(extractor(makeSubscription(), 7)).toBe('subscription:sub-1');
  });
});
