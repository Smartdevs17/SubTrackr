/**
 * Tests for PostgreSQL repository implementations — postgres.ts
 *
 * Uses an in-memory mock pool — no real database required.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  PgSubscriptionRepository,
  PgTransactionRepository,
  PgUserRepository,
  PgMerchantRepository,
  PgLoyaltyRepository,
  PostgresUnitOfWork,
  createPostgresRepositories,
} from '../postgres';
import type { Pool, PoolClient } from '../../../shared/db/connectionPool';
import type {
  Subscription,
  Transaction,
  User,
  MerchantRecord,
  LoyaltyRecord,
} from '../interfaces';

// ── Mock Pool ─────────────────────────────────────────────────────────────────

interface MockPool extends Pool {
  _setResponse(rows: unknown[], rowCount?: number): void;
  _setResponseSequence(responses: { rows: unknown[]; rowCount?: number }[]): void;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

function makeMockPool(): MockPool {
  let responses: { rows: unknown[]; rowCount?: number }[] = [];
  let defaultRows: unknown[] = [];

  const pool: MockPool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    query: jest.fn(async (_sql: string, _params?: unknown[]) => {
      if (responses.length > 0) {
        const next = responses.shift()!;
        return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
      }
      return { rows: defaultRows, rowCount: defaultRows.length };
    }),
    connect: jest.fn(async () => {
      const client: PoolClient = {
        query: jest.fn(async (_sql: string, _params?: unknown[]) => {
          if (responses.length > 0) {
            const next = responses.shift()!;
            return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
          }
          return { rows: defaultRows, rowCount: defaultRows.length };
        }),
        release: jest.fn(),
      };
      return client;
    }),
    end: jest.fn(async () => {}),
    on: jest.fn(),
    _setResponse(rows: unknown[], rowCount?: number) {
      defaultRows = rows;
    },
    _setResponseSequence(seq) {
      responses = [...seq];
    },
  };
  return pool;
}

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

// ── PgSubscriptionRepository ──────────────────────────────────────────────────

describe('PgSubscriptionRepository', () => {
  let pool: MockPool;
  let repo: PgSubscriptionRepository;

  beforeEach(() => {
    pool = makeMockPool();
    repo = new PgSubscriptionRepository(pool);
  });

  it('findById returns null when no rows', async () => {
    pool._setResponse([]);
    expect(await repo.findById('nonexistent')).toBeNull();
  });

  it('findById returns row when found', async () => {
    const sub = makeSub();
    pool._setResponse([sub]);
    const result = await repo.findById('sub-1');
    expect(result).toEqual(sub);
  });

  it('save calls query with correct INSERT ... ON CONFLICT params', async () => {
    const sub = makeSub();
    pool._setResponse([sub]);
    const result = await repo.save(sub);
    expect(result).toEqual(sub);
    expect((pool.query as jest.Mock).mock.calls[0][0]).toMatch(/INSERT INTO subscriptions/i);
    expect((pool.query as jest.Mock).mock.calls[0][0]).toMatch(/ON CONFLICT/i);
  });

  it('delete calls DELETE with id param', async () => {
    pool._setResponse([]);
    await repo.delete('sub-1');
    expect((pool.query as jest.Mock).mock.calls[0][0]).toMatch(/DELETE FROM subscriptions/i);
    expect((pool.query as jest.Mock).mock.calls[0][1]).toEqual(['sub-1']);
  });

  it('exists returns true when row found', async () => {
    pool._setResponse([{ exists: true }]);
    expect(await repo.exists('sub-1')).toBe(true);
  });

  it('exists returns false when not found', async () => {
    pool._setResponse([{ exists: false }]);
    expect(await repo.exists('nope')).toBe(false);
  });

  it('findAll returns paginated results', async () => {
    const sub = makeSub();
    pool._setResponseSequence([
      { rows: [{ count: '5' }] },
      { rows: [sub] },
    ]);
    const page = await repo.findAll({ limit: 1, offset: 0 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(1);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(1);
  });

  it('findByUserId filters by userId', async () => {
    const sub = makeSub({ userId: 'user-2' });
    pool._setResponseSequence([
      { rows: [{ count: '1' }] },
      { rows: [sub] },
    ]);
    const page = await repo.findByUserId('user-2');
    const sql = (pool.query as jest.Mock).mock.calls[1][0] as string;
    expect(sql).toMatch(/WHERE user_id/i);
    expect(page.items[0]?.userId).toBe('user-2');
  });

  it('findByStatus filters by status', async () => {
    const sub = makeSub({ status: 'paused' });
    pool._setResponseSequence([
      { rows: [{ count: '1' }] },
      { rows: [sub] },
    ]);
    const page = await repo.findByStatus('paused');
    expect(page.items[0]?.status).toBe('paused');
  });

  it('findDueBefore uses correct WHERE clause', async () => {
    const sub = makeSub({ nextBillingDate: new Date('2026-05-01') });
    pool._setResponse([sub]);
    const results = await repo.findDueBefore(new Date('2026-06-01'));
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/status = 'active'/i);
    expect(sql).toMatch(/next_billing_date <= \$1/i);
    expect(results).toHaveLength(1);
  });
});

// ── PgTransactionRepository ───────────────────────────────────────────────────

describe('PgTransactionRepository', () => {
  let pool: MockPool;
  let repo: PgTransactionRepository;

  beforeEach(() => {
    pool = makeMockPool();
    repo = new PgTransactionRepository(pool);
  });

  it('findById returns null on empty result', async () => {
    pool._setResponse([]);
    expect(await repo.findById('tx-nope')).toBeNull();
  });

  it('save calls INSERT ... ON CONFLICT', async () => {
    const tx = makeTx();
    pool._setResponse([tx]);
    await repo.save(tx);
    expect((pool.query as jest.Mock).mock.calls[0][0]).toMatch(/INSERT INTO transactions/i);
  });

  it('findByStatus filters correctly', async () => {
    pool._setResponse([makeTx({ status: 'failed' })]);
    const results = await repo.findByStatus('failed');
    expect(results[0]?.status).toBe('failed');
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/WHERE status = \$1/i);
  });

  it('findBySubscriptionId returns paginated results', async () => {
    pool._setResponseSequence([
      { rows: [{ count: '1' }] },
      { rows: [makeTx()] },
    ]);
    const page = await repo.findBySubscriptionId('sub-1');
    expect(page.items).toHaveLength(1);
  });

  it('delete removes by id', async () => {
    pool._setResponse([]);
    await repo.delete('tx-1');
    expect((pool.query as jest.Mock).mock.calls[0][0]).toMatch(/DELETE FROM transactions/i);
  });
});

// ── PgUserRepository ──────────────────────────────────────────────────────────

describe('PgUserRepository', () => {
  let pool: MockPool;
  let repo: PgUserRepository;

  beforeEach(() => {
    pool = makeMockPool();
    repo = new PgUserRepository(pool);
  });

  it('findByAddress queries with correct param', async () => {
    pool._setResponse([makeUser()]);
    const result = await repo.findByAddress('GABC123');
    expect(result?.address).toBe('GABC123');
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/WHERE address = \$1/i);
  });

  it('findByEmail returns null when not found', async () => {
    pool._setResponse([]);
    expect(await repo.findByEmail('unknown@example.com')).toBeNull();
  });

  it('save upserts user', async () => {
    const user = makeUser();
    pool._setResponse([user]);
    const result = await repo.save(user);
    expect(result.id).toBe('user-1');
    expect((pool.query as jest.Mock).mock.calls[0][0]).toMatch(/ON CONFLICT/i);
  });
});

// ── PgMerchantRepository ──────────────────────────────────────────────────────

describe('PgMerchantRepository', () => {
  let pool: MockPool;
  let repo: PgMerchantRepository;

  beforeEach(() => {
    pool = makeMockPool();
    repo = new PgMerchantRepository(pool);
  });

  it('findByAddress returns correct merchant', async () => {
    pool._setResponse([makeMerchant()]);
    const m = await repo.findByAddress('GMERCHANT');
    expect(m?.merchantAddress).toBe('GMERCHANT');
  });

  it('findByStatus returns array', async () => {
    pool._setResponse([makeMerchant({ status: 'pending' })]);
    const results = await repo.findByStatus('pending');
    expect(results).toHaveLength(1);
  });
});

// ── PgLoyaltyRepository ───────────────────────────────────────────────────────

describe('PgLoyaltyRepository', () => {
  let pool: MockPool;
  let repo: PgLoyaltyRepository;

  beforeEach(() => {
    pool = makeMockPool();
    repo = new PgLoyaltyRepository(pool);
  });

  it('findBySubscriberId returns null when not found', async () => {
    pool._setResponse([]);
    expect(await repo.findBySubscriberId('nobody')).toBeNull();
  });

  it('findTopByPoints uses ORDER BY points DESC LIMIT', async () => {
    const records = [
      makeLoyalty({ id: 'l-1', points: 900 }),
      makeLoyalty({ id: 'l-2', points: 200 }),
    ];
    pool._setResponse(records);
    const results = await repo.findTopByPoints(2);
    expect(results).toHaveLength(2);
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY points DESC LIMIT/i);
    expect((pool.query as jest.Mock).mock.calls[0][1]).toContain(2);
  });
});

// ── PostgresUnitOfWork ────────────────────────────────────────────────────────

describe('PostgresUnitOfWork', () => {
  it('run() wraps work in a transaction (BEGIN/COMMIT)', async () => {
    const pool = makeMockPool();
    // Return rows for the RETURNING clause in save()
    pool._setResponseSequence([
      { rows: [] },               // BEGIN
      { rows: [makeSub()] },     // INSERT subscription
      { rows: [] },               // COMMIT
    ]);

    const uow = new PostgresUnitOfWork(pool);
    const result = await uow.run(async (u) => {
      return u.subscriptions.save(makeSub());
    });

    expect(result.id).toBe('sub-1');
    const queryCalls = (pool.connect as jest.Mock).mock.results[0].value;
    // connect was called
    expect(pool.connect).toHaveBeenCalled();
  });

  it('run() rolls back and rethrows on error', async () => {
    const pool = makeMockPool();
    const uow = new PostgresUnitOfWork(pool);

    await expect(
      uow.run(async () => { throw new Error('db failure'); }),
    ).rejects.toThrow('db failure');

    // Get the client that was connected
    const client = await (pool.connect as jest.Mock).mock.results[0].value;
    const clientQueryCalls = (client.query as jest.Mock).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(clientQueryCalls).toContain('ROLLBACK');
  });

  it('exposes all five repositories', () => {
    const pool = makeMockPool();
    const uow = new PostgresUnitOfWork(pool);
    expect(uow.subscriptions).toBeDefined();
    expect(uow.transactions).toBeDefined();
    expect(uow.users).toBeDefined();
    expect(uow.merchants).toBeDefined();
    expect(uow.loyalty).toBeDefined();
  });
});

// ── createPostgresRepositories factory ───────────────────────────────────────

describe('createPostgresRepositories()', () => {
  it('returns all repositories and a unitOfWork', () => {
    const pool = makeMockPool();
    const repos = createPostgresRepositories(pool);
    expect(repos.subscriptions).toBeInstanceOf(PgSubscriptionRepository);
    expect(repos.transactions).toBeInstanceOf(PgTransactionRepository);
    expect(repos.users).toBeInstanceOf(PgUserRepository);
    expect(repos.merchants).toBeInstanceOf(PgMerchantRepository);
    expect(repos.loyalty).toBeInstanceOf(PgLoyaltyRepository);
    expect(repos.unitOfWork).toBeInstanceOf(PostgresUnitOfWork);
  });
});
