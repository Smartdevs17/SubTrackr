/**
 * Repository tests — Issue #405.
 * Uses in-memory implementations for fast, isolated unit tests.
 */

import {
  InMemorySubscriptionRepository,
  InMemoryTransactionRepository,
  InMemoryUserRepository,
  InMemoryMerchantRepository,
  InMemoryLoyaltyRepository,
  InMemoryUnitOfWork,
  Subscription,
  Transaction,
  User,
  MerchantRecord,
  LoyaltyRecord,
} from '../repositories';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeSub = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: 'sub-1',
  userId: 'user-1',
  name: 'Netflix',
  amount: 15,
  currency: 'USD',
  billingCycle: 'monthly',
  status: 'active',
  nextBillingDate: new Date('2026-06-01'),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  subscriptionId: 'sub-1',
  userId: 'user-1',
  amount: 15,
  currency: 'USD',
  status: 'success',
  timestamp: new Date('2026-05-01'),
  ...overrides,
});

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  address: 'GABC123',
  email: 'alice@example.com',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

const makeMerchant = (overrides: Partial<MerchantRecord> = {}): MerchantRecord => ({
  id: 'merchant-1',
  merchantAddress: 'GMERCHANT',
  status: 'verified',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeLoyalty = (overrides: Partial<LoyaltyRecord> = {}): LoyaltyRecord => ({
  id: 'loyalty-1',
  subscriberId: 'user-1',
  points: 500,
  lifetimePoints: 1200,
  tier: 'silver',
  streakCurrent: 7,
  streakLongest: 14,
  updatedAt: new Date('2026-05-01'),
  ...overrides,
});

// ── Subscription repository ───────────────────────────────────────────────────

describe('InMemorySubscriptionRepository', () => {
  let repo: InMemorySubscriptionRepository;

  beforeEach(() => {
    repo = new InMemorySubscriptionRepository();
  });

  it('saves and retrieves by id', async () => {
    const sub = makeSub();
    await repo.save(sub);
    expect(await repo.findById('sub-1')).toEqual(sub);
  });

  it('returns null for unknown id', async () => {
    expect(await repo.findById('nope')).toBeNull();
  });

  it('exists returns correct boolean', async () => {
    await repo.save(makeSub());
    expect(await repo.exists('sub-1')).toBe(true);
    expect(await repo.exists('nope')).toBe(false);
  });

  it('deletes a record', async () => {
    await repo.save(makeSub());
    await repo.delete('sub-1');
    expect(await repo.findById('sub-1')).toBeNull();
  });

  it('findAll returns all records with pagination', async () => {
    await repo.save(makeSub({ id: 'sub-1' }));
    await repo.save(makeSub({ id: 'sub-2' }));
    const page = await repo.findAll({ limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('findByUserId filters correctly', async () => {
    await repo.save(makeSub({ id: 'sub-1', userId: 'user-1' }));
    await repo.save(makeSub({ id: 'sub-2', userId: 'user-2' }));
    const page = await repo.findByUserId('user-1');
    expect(page.items).toHaveLength(1);
    expect(page.items[0].userId).toBe('user-1');
  });

  it('findByStatus filters correctly', async () => {
    await repo.save(makeSub({ id: 'sub-1', status: 'active' }));
    await repo.save(makeSub({ id: 'sub-2', status: 'paused' }));
    const page = await repo.findByStatus('active');
    expect(page.items).toHaveLength(1);
  });

  it('findDueBefore returns only due active subscriptions', async () => {
    await repo.save(makeSub({ id: 'sub-1', nextBillingDate: new Date('2026-05-01') }));
    await repo.save(makeSub({ id: 'sub-2', nextBillingDate: new Date('2026-07-01') }));
    const due = await repo.findDueBefore(new Date('2026-06-01'));
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('sub-1');
  });
});

// ── Transaction repository ────────────────────────────────────────────────────

describe('InMemoryTransactionRepository', () => {
  let repo: InMemoryTransactionRepository;

  beforeEach(() => { repo = new InMemoryTransactionRepository(); });

  it('saves and retrieves', async () => {
    const tx = makeTx();
    await repo.save(tx);
    expect(await repo.findById('tx-1')).toEqual(tx);
  });

  it('findBySubscriptionId filters correctly', async () => {
    await repo.save(makeTx({ id: 'tx-1', subscriptionId: 'sub-1' }));
    await repo.save(makeTx({ id: 'tx-2', subscriptionId: 'sub-2' }));
    const page = await repo.findBySubscriptionId('sub-1');
    expect(page.items).toHaveLength(1);
  });

  it('findByStatus filters correctly', async () => {
    await repo.save(makeTx({ id: 'tx-1', status: 'success' }));
    await repo.save(makeTx({ id: 'tx-2', status: 'failed' }));
    const failed = await repo.findByStatus('failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].id).toBe('tx-2');
  });
});

// ── User repository ───────────────────────────────────────────────────────────

describe('InMemoryUserRepository', () => {
  let repo: InMemoryUserRepository;

  beforeEach(() => { repo = new InMemoryUserRepository(); });

  it('findByAddress returns correct user', async () => {
    await repo.save(makeUser());
    expect(await repo.findByAddress('GABC123')).not.toBeNull();
    expect(await repo.findByAddress('GOTHER')).toBeNull();
  });

  it('findByEmail returns correct user', async () => {
    await repo.save(makeUser());
    expect(await repo.findByEmail('alice@example.com')).not.toBeNull();
    expect(await repo.findByEmail('bob@example.com')).toBeNull();
  });
});

// ── Merchant repository ───────────────────────────────────────────────────────

describe('InMemoryMerchantRepository', () => {
  let repo: InMemoryMerchantRepository;

  beforeEach(() => { repo = new InMemoryMerchantRepository(); });

  it('findByAddress returns correct merchant', async () => {
    await repo.save(makeMerchant());
    expect(await repo.findByAddress('GMERCHANT')).not.toBeNull();
  });

  it('findByStatus filters correctly', async () => {
    await repo.save(makeMerchant({ id: 'm-1', status: 'verified' }));
    await repo.save(makeMerchant({ id: 'm-2', status: 'pending' }));
    const verified = await repo.findByStatus('verified');
    expect(verified).toHaveLength(1);
  });
});

// ── Loyalty repository ────────────────────────────────────────────────────────

describe('InMemoryLoyaltyRepository', () => {
  let repo: InMemoryLoyaltyRepository;

  beforeEach(() => { repo = new InMemoryLoyaltyRepository(); });

  it('findBySubscriberId returns correct record', async () => {
    await repo.save(makeLoyalty());
    expect(await repo.findBySubscriberId('user-1')).not.toBeNull();
    expect(await repo.findBySubscriberId('user-99')).toBeNull();
  });

  it('findTopByPoints returns sorted results', async () => {
    await repo.save(makeLoyalty({ id: 'l-1', subscriberId: 'u-1', points: 100 }));
    await repo.save(makeLoyalty({ id: 'l-2', subscriberId: 'u-2', points: 500 }));
    await repo.save(makeLoyalty({ id: 'l-3', subscriberId: 'u-3', points: 250 }));
    const top2 = await repo.findTopByPoints(2);
    expect(top2[0].points).toBe(500);
    expect(top2[1].points).toBe(250);
  });
});

// ── Unit of work ──────────────────────────────────────────────────────────────

describe('InMemoryUnitOfWork', () => {
  it('run executes work and returns result', async () => {
    const uow = new InMemoryUnitOfWork();
    const result = await uow.run(async (u) => {
      await u.subscriptions.save(makeSub());
      return u.subscriptions.findById('sub-1');
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe('sub-1');
  });

  it('run propagates errors', async () => {
    const uow = new InMemoryUnitOfWork();
    await expect(
      uow.run(async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
  });

  it('all repositories are accessible', () => {
    const uow = new InMemoryUnitOfWork();
    expect(uow.subscriptions).toBeDefined();
    expect(uow.transactions).toBeDefined();
    expect(uow.users).toBeDefined();
    expect(uow.merchants).toBeDefined();
    expect(uow.loyalty).toBeDefined();
  });
});
