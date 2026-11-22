/**
 * Tests for data mappers (Issue #2215).
 *
 * Covers each mapper's toRow/toEntity round-trip, type normalisation
 * (especially Date handling), and the DataMapperRegistry.
 */

import { describe, it, expect } from '@jest/globals';
import {
  SubscriptionDataMapper,
  TransactionDataMapper,
  UserDataMapper,
  MerchantDataMapper,
  LoyaltyDataMapper,
  DataMapperRegistry,
  dataMapperRegistry,
} from '../dataMapper';
import type { Subscription, Transaction, User, MerchantRecord, LoyaltyRecord } from '../interfaces';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const subscription: Subscription = {
  id: 'sub_1',
  userId: 'user_1',
  name: 'Pro Plan',
  amount: 29.99,
  currency: 'USD',
  billingCycle: 'monthly',
  status: 'active',
  nextBillingDate: new Date('2024-08-01T00:00:00Z'),
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-07-01T00:00:00Z'),
};

const transaction: Transaction = {
  id: 'tx_1',
  subscriptionId: 'sub_1',
  userId: 'user_1',
  amount: 29.99,
  currency: 'USD',
  status: 'success',
  timestamp: new Date('2024-07-01T12:00:00Z'),
  txHash: '0xabc123',
};

const user: User = {
  id: 'user_1',
  address: '0xPayer',
  email: 'alice@example.com',
  createdAt: new Date('2024-01-01T00:00:00Z'),
};

const merchant: MerchantRecord = {
  id: 'merch_1',
  merchantAddress: '0xMerchant',
  status: 'verified',
  verificationTier: 'gold',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-07-01T00:00:00Z'),
};

const loyalty: LoyaltyRecord = {
  id: 'loy_1',
  subscriberId: 'user_1',
  points: 500,
  lifetimePoints: 1500,
  tier: 'gold',
  streakCurrent: 3,
  streakLongest: 7,
  updatedAt: new Date('2024-07-01T00:00:00Z'),
};

// ── SubscriptionDataMapper ───────────────────────────────────────────────────

describe('SubscriptionDataMapper', () => {
  const mapper = new SubscriptionDataMapper();

  it('converts entity to row with snake_case keys', () => {
    const row = mapper.toRow(subscription);
    expect(row.id).toBe('sub_1');
    expect(row.user_id).toBe('user_1');
    expect(row.billing_cycle).toBe('monthly');
    expect(row.next_billing_date).toEqual(subscription.nextBillingDate);
    expect(row.created_at).toEqual(subscription.createdAt);
    expect(row.updated_at).toEqual(subscription.updatedAt);
  });

  it('converts row to entity with camelCase keys and Date objects', () => {
    const row = {
      id: 'sub_2',
      user_id: 'user_2',
      name: 'Basic Plan',
      amount: 9.99,
      currency: 'EUR',
      billing_cycle: 'yearly',
      status: 'paused',
      next_billing_date: '2024-12-01T00:00:00Z',
      created_at: '2024-03-15T00:00:00Z',
      updated_at: '2024-06-01T00:00:00Z',
    };
    const entity = mapper.toEntity(row);
    expect(entity.id).toBe('sub_2');
    expect(entity.userId).toBe('user_2');
    expect(entity.billingCycle).toBe('yearly');
    expect(entity.status).toBe('paused');
    expect(entity.nextBillingDate).toBeInstanceOf(Date);
    expect(entity.createdAt).toBeInstanceOf(Date);
    expect(entity.updatedAt).toBeInstanceOf(Date);
  });

  it('round-trips entity → row → entity preserves data', () => {
    const row = mapper.toRow(subscription);
    const restored = mapper.toEntity(row);
    expect(restored.id).toBe(subscription.id);
    expect(restored.name).toBe(subscription.name);
    expect(restored.amount).toBe(subscription.amount);
    expect(restored.status).toBe(subscription.status);
    expect(restored.nextBillingDate.getTime()).toBe(subscription.nextBillingDate.getTime());
  });
});

// ── TransactionDataMapper ───────────────────────────────────────────────────

describe('TransactionDataMapper', () => {
  const mapper = new TransactionDataMapper();

  it('converts entity to row with snake_case keys', () => {
    const row = mapper.toRow(transaction);
    expect(row.id).toBe('tx_1');
    expect(row.subscription_id).toBe('sub_1');
    expect(row.user_id).toBe('user_1');
    expect(row.tx_hash).toBe('0xabc123');
  });

  it('converts null tx_hash to undefined in entity', () => {
    const row = {
      id: 'tx_2',
      subscription_id: 'sub_2',
      user_id: 'user_2',
      amount: 10,
      currency: 'USD',
      status: 'pending',
      timestamp: '2024-07-01T12:00:00Z',
      tx_hash: null,
    };
    const entity = mapper.toEntity(row);
    expect(entity.txHash).toBeUndefined();
  });

  it('round-trips entity → row → entity preserves data', () => {
    const row = mapper.toRow(transaction);
    const restored = mapper.toEntity(row);
    expect(restored.id).toBe(transaction.id);
    expect(restored.subscriptionId).toBe(transaction.subscriptionId);
    expect(restored.txHash).toBe(transaction.txHash);
    expect(restored.timestamp.getTime()).toBe(transaction.timestamp.getTime());
  });
});

// ── UserDataMapper ───────────────────────────────────────────────────────────

describe('UserDataMapper', () => {
  const mapper = new UserDataMapper();

  it('converts entity to row with null email when undefined', () => {
    const userNoEmail: User = { ...user, email: undefined };
    const row = mapper.toRow(userNoEmail);
    expect(row.email).toBeNull();
  });

  it('converts null email to undefined in entity', () => {
    const row = {
      id: 'user_2',
      address: '0xOther',
      email: null,
      created_at: '2024-01-01T00:00:00Z',
    };
    const entity = mapper.toEntity(row);
    expect(entity.email).toBeUndefined();
  });

  it('round-trips entity → row → entity', () => {
    const row = mapper.toRow(user);
    const restored = mapper.toEntity(row);
    expect(restored.id).toBe(user.id);
    expect(restored.address).toBe(user.address);
    expect(restored.email).toBe(user.email);
    expect(restored.createdAt.getTime()).toBe(user.createdAt.getTime());
  });
});

// ── MerchantDataMapper ──────────────────────────────────────────────────────

describe('MerchantDataMapper', () => {
  const mapper = new MerchantDataMapper();

  it('converts entity to row with null verification_tier when undefined', () => {
    const merchNoTier: MerchantRecord = { ...merchant, verificationTier: undefined };
    const row = mapper.toRow(merchNoTier);
    expect(row.verification_tier).toBeNull();
  });

  it('converts null verification_tier to undefined in entity', () => {
    const row = {
      id: 'merch_2',
      merchant_address: '0xOther',
      status: 'pending',
      verification_tier: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };
    const entity = mapper.toEntity(row);
    expect(entity.verificationTier).toBeUndefined();
  });

  it('round-trips entity → row → entity', () => {
    const row = mapper.toRow(merchant);
    const restored = mapper.toEntity(row);
    expect(restored.id).toBe(merchant.id);
    expect(restored.merchantAddress).toBe(merchant.merchantAddress);
    expect(restored.verificationTier).toBe(merchant.verificationTier);
  });
});

// ── LoyaltyDataMapper ─────────────────────────────────────────────────────────

describe('LoyaltyDataMapper', () => {
  const mapper = new LoyaltyDataMapper();

  it('converts entity to row with snake_case keys', () => {
    const row = mapper.toRow(loyalty);
    expect(row.id).toBe('loy_1');
    expect(row.subscriber_id).toBe('user_1');
    expect(row.lifetime_points).toBe(1500);
    expect(row.streak_current).toBe(3);
    expect(row.streak_longest).toBe(7);
  });

  it('round-trips entity → row → entity', () => {
    const row = mapper.toRow(loyalty);
    const restored = mapper.toEntity(row);
    expect(restored.id).toBe(loyalty.id);
    expect(restored.subscriberId).toBe(loyalty.subscriberId);
    expect(restored.points).toBe(loyalty.points);
    expect(restored.lifetimePoints).toBe(loyalty.lifetimePoints);
    expect(restored.tier).toBe(loyalty.tier);
    expect(restored.streakCurrent).toBe(loyalty.streakCurrent);
    expect(restored.streakLongest).toBe(loyalty.streakLongest);
  });
});

// ── DataMapperRegistry ────────────────────────────────────────────────────────

describe('DataMapperRegistry', () => {
  it('registers all default mappers on construction', () => {
    const registry = new DataMapperRegistry();
    expect(registry.has('subscription')).toBe(true);
    expect(registry.has('transaction')).toBe(true);
    expect(registry.has('user')).toBe(true);
    expect(registry.has('merchant')).toBe(true);
    expect(registry.has('loyalty')).toBe(true);
    expect(registry.list()).toHaveLength(5);
  });

  it('returns the correct mapper by name', () => {
    const registry = new DataMapperRegistry();
    const subMapper = registry.get<Subscription>('subscription');
    expect(subMapper).toBeInstanceOf(SubscriptionDataMapper);
  });

  it('throws when getting an unregistered mapper', () => {
    const registry = new DataMapperRegistry();
    expect(() => registry.get('unknown')).toThrow(/No data mapper registered/);
  });

  it('allows registering custom mappers', () => {
    const registry = new DataMapperRegistry();
    const customMapper = new SubscriptionDataMapper();
    registry.register('custom_sub', customMapper);
    expect(registry.has('custom_sub')).toBe(true);
    expect(registry.get('custom_sub')).toBe(customMapper);
  });

  it('singleton dataMapperRegistry has all mappers', () => {
    expect(dataMapperRegistry.has('subscription')).toBe(true);
    expect(dataMapperRegistry.has('transaction')).toBe(true);
    expect(dataMapperRegistry.has('user')).toBe(true);
    expect(dataMapperRegistry.has('merchant')).toBe(true);
    expect(dataMapperRegistry.has('loyalty')).toBe(true);
  });
});
