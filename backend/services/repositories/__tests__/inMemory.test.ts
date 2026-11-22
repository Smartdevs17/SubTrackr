/**
 * Tests for in-memory repository implementations (Issue #2215).
 *
 * Covers all five repository types and the InMemoryUnitOfWork, including
 * CRUD operations, domain-specific queries, pagination, and transaction
 * behavior.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  InMemorySubscriptionRepository,
  InMemoryTransactionRepository,
  InMemoryUserRepository,
  InMemoryMerchantRepository,
  InMemoryLoyaltyRepository,
  InMemoryUnitOfWork,
} from '../inMemory';
import type {
  Subscription,
  Transaction,
  User,
  MerchantRecord,
  LoyaltyRecord,
} from '../interfaces';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub_1',
    userId: 'user_1',
    name: 'Pro Plan',
    amount: 29.99,
    currency: 'USD',
    billingCycle: 'monthly',
    status: 'active',
    nextBillingDate: new Date('2024-08-01'),
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-07-01'),
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx_1',
    subscriptionId: 'sub_1',
    userId: 'user_1',
    amount: 29.99,
    currency: 'USD',
    status: 'success',
    timestamp: new Date('2024-07-01'),
    txHash: '0xabc',
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    address: '0xPayer',
    email: 'alice@example.com',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeMerchant(overrides: Partial<MerchantRecord> = {}): MerchantRecord {
  return {
    id: 'merch_1',
    merchantAddress: '0xMerchant',
    status: 'verified',
    verificationTier: 'gold',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-07-01'),
    ...overrides,
  };
}

function makeLoyalty(overrides: Partial<LoyaltyRecord> = {}): LoyaltyRecord {
  return {
    id: 'loy_1',
    subscriberId: 'user_1',
    points: 500,
    lifetimePoints: 1500,
    tier: 'gold',
    streakCurrent: 3,
    streakLongest: 7,
    updatedAt: new Date('2024-07-01'),
    ...overrides,
  };
}

// ── Subscription repository ───────────────────────────────────────────────────

describe('InMemorySubscriptionRepository', () => {
  let repo: InMemorySubscriptionRepository;

  beforeEach(() => {
    repo = new InMemorySubscriptionRepository();
  });

  it('saves and retrieves a subscription by id', async () => {
    const sub = makeSubscription();
    await repo.save(sub);
    const found = await repo.findById('sub_1');
    expect(found).toEqual(sub);
  });

  it('returns null when not found', async () => {
    const found = await repo.findById('nonexistent');
    expect(found).toBeNull();
  });

  it('updates an existing subscription on save', async () => {
    await repo.save(makeSubscription());
    await repo.save(makeSubscription({ name: 'Updated Plan', amount: 49.99 }));
    const found = await repo.findById('sub_1');
    expect(found?.name).toBe('Updated Plan');
    expect(found?.amount).toBe(49.99);
  });

  it('deletes a subscription', async () => {
    await repo.save(makeSubscription());
    await repo.delete('sub_1');
    expect(await repo.findById('sub_1')).toBeNull();
  });

  it('checks existence', async () => {
    await repo.save(makeSubscription());
    expect(await repo.exists('sub_1')).toBe(true);
    expect(await repo.exists('nonexistent')).toBe(false);
  });

  it('finds all with pagination', async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.save(makeSubscription({ id: `sub_${i}`, name: `Plan ${i}` }));
    }
    const page = await repo.findAll({ offset: 1, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.offset).toBe(1);
    expect(page.limit).toBe(2);
  });

  it('finds by user id', async () => {
    await repo.save(makeSubscription({ id: 'sub_1', userId: 'user_a' }));
    await repo.save(makeSubscription({ id: 'sub_2', userId: 'user_a' }));
    await repo.save(makeSubscription({ id: 'sub_3', userId: 'user_b' }));
    const page = await repo.findByUserId('user_a');
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(2);
  });

  it('finds by status', async () => {
    await repo.save(makeSubscription({ id: 's1', status: 'active' }));
    await repo.save(makeSubscription({ id: 's2', status: 'paused' }));
    await repo.save(makeSubscription({ id: 's3', status: 'active' }));
    const page = await repo.findByStatus('active');
    expect(page.items).toHaveLength(2);
  });

  it('finds due before a date', async () => {
    await repo.save(makeSubscription({ id: 's1', nextBillingDate: new Date('2024-06-01') }));
    await repo.save(makeSubscription({ id: 's2', nextBillingDate: new Date('2024-12-01') }));
    await repo.save(makeSubscription({ id: 's3', status: 'paused', nextBillingDate: new Date('2024-06-01') }));
    const due = await repo.findDueBefore(new Date('2024-07-01'));
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('s1');
  });
});

// ── Transaction repository ────────────────────────────────────────────────────

describe('InMemoryTransactionRepository', () => {
  let repo: InMemoryTransactionRepository;

  beforeEach(() => {
    repo = new InMemoryTransactionRepository();
  });

  it('saves and retrieves by id', async () => {
    await repo.save(makeTransaction());
    const found = await repo.findById('tx_1');
    expect(found).toEqual(makeTransaction());
  });

  it('finds by subscription id', async () => {
    await repo.save(makeTransaction({ id: 't1', subscriptionId: 'sub_a' }));
    await repo.save(makeTransaction({ id: 't2', subscriptionId: 'sub_a' }));
    await repo.save(makeTransaction({ id: 't3', subscriptionId: 'sub_b' }));
    const page = await repo.findBySubscriptionId('sub_a');
    expect(page.items).toHaveLength(2);
  });

  it('finds by user id', async () => {
    await repo.save(makeTransaction({ id: 't1', userId: 'u1' }));
    await repo.save(makeTransaction({ id: 't2', userId: 'u2' }));
    const page = await repo.findByUserId('u1');
    expect(page.items).toHaveLength(1);
  });

  it('finds by status', async () => {
    await repo.save(makeTransaction({ id: 't1', status: 'success' }));
    await repo.save(makeTransaction({ id: 't2', status: 'failed' }));
    await repo.save(makeTransaction({ id: 't3', status: 'success' }));
    const found = await repo.findByStatus('success');
    expect(found).toHaveLength(2);
  });

  it('deletes a transaction', async () => {
    await repo.save(makeTransaction());
    await repo.delete('tx_1');
    expect(await repo.exists('tx_1')).toBe(false);
  });
});

// ── User repository ───────────────────────────────────────────────────────────

describe('InMemoryUserRepository', () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
  });

  it('finds by address', async () => {
    await repo.save(makeUser({ address: '0xABC' }));
    const found = await repo.findByAddress('0xABC');
    expect(found?.address).toBe('0xABC');
  });

  it('finds by email', async () => {
    await repo.save(makeUser({ email: 'bob@example.com' }));
    const found = await repo.findByEmail('bob@example.com');
    expect(found?.email).toBe('bob@example.com');
  });

  it('returns null for unknown address', async () => {
    expect(await repo.findByAddress('0xUnknown')).toBeNull();
  });

  it('returns null for unknown email', async () => {
    expect(await repo.findByEmail('unknown@example.com')).toBeNull();
  });
});

// ── Merchant repository ───────────────────────────────────────────────────────

describe('InMemoryMerchantRepository', () => {
  let repo: InMemoryMerchantRepository;

  beforeEach(() => {
    repo = new InMemoryMerchantRepository();
  });

  it('finds by address', async () => {
    await repo.save(makeMerchant({ merchantAddress: '0xMerch' }));
    const found = await repo.findByAddress('0xMerch');
    expect(found?.merchantAddress).toBe('0xMerch');
  });

  it('finds by status', async () => {
    await repo.save(makeMerchant({ id: 'm1', status: 'verified' }));
    await repo.save(makeMerchant({ id: 'm2', status: 'pending' }));
    await repo.save(makeMerchant({ id: 'm3', status: 'verified' }));
    const found = await repo.findByStatus('verified');
    expect(found).toHaveLength(2);
  });
});

// ── Loyalty repository ────────────────────────────────────────────────────────

describe('InMemoryLoyaltyRepository', () => {
  let repo: InMemoryLoyaltyRepository;

  beforeEach(() => {
    repo = new InMemoryLoyaltyRepository();
  });

  it('finds by subscriber id', async () => {
    await repo.save(makeLoyalty({ subscriberId: 'user_42' }));
    const found = await repo.findBySubscriberId('user_42');
    expect(found?.subscriberId).toBe('user_42');
  });

  it('finds top by points', async () => {
    await repo.save(makeLoyalty({ id: 'l1', points: 100 }));
    await repo.save(makeLoyalty({ id: 'l2', points: 500 }));
    await repo.save(makeLoyalty({ id: 'l3', points: 300 }));
    const top = await repo.findTopByPoints(2);
    expect(top).toHaveLength(2);
    expect(top[0].points).toBe(500);
    expect(top[1].points).toBe(300);
  });

  it('returns null for unknown subscriber', async () => {
    expect(await repo.findBySubscriberId('unknown')).toBeNull();
  });
});

// ── InMemoryUnitOfWork ───────────────────────────────────────────────────────

describe('InMemoryUnitOfWork', () => {
  it('provides all repositories', () => {
    const uow = new InMemoryUnitOfWork();
    expect(uow.subscriptions).toBeDefined();
    expect(uow.transactions).toBeDefined();
    expect(uow.users).toBeDefined();
    expect(uow.merchants).toBeDefined();
    expect(uow.loyalty).toBeDefined();
  });

  it('runs work and returns the result', async () => {
    const uow = new InMemoryUnitOfWork();
    const result = await uow.run(async (u) => {
      await u.subscriptions.save(makeSubscription());
      return 'done';
    });
    expect(result).toBe('done');
    expect(await uow.subscriptions.findById('sub_1')).toBeDefined();
  });

  it('propagates errors from work', async () => {
    const uow = new InMemoryUnitOfWork();
    await expect(uow.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});
