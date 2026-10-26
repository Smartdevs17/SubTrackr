/**
 * GraphQL cursor-based pagination tests
 *
 * Tests correctness of cursor encoding/decoding and pagination behaviour
 * using an in-memory mock pool so no real database is required.
 */

import { resolvers } from '../resolvers';
import { Pool } from '../../shared/db/connectionPool';
import {
  createSubscriptionLoader,
  createTransactionLoader,
  createPaymentMethodLoader,
  createPlanLoader,
} from '../dataloaders';

// ── Mock pool factory ─────────────────────────────────────────────────────────

function makeMockRow(i: number) {
  const d = new Date(2026, 0, i + 1).toISOString();
  return {
    id: `sub_${i}`,
    userId: 'user_1',
    name: `Sub ${i}`,
    amount: (i + 1) * 10,
    currency: 'USD',
    billingCycle: 'monthly',
    status: 'active',
    nextBillingDate: d,
    createdAt: d,
    updatedAt: d,
  };
}

const ALL_ROWS = Array.from({ length: 30 }, (_, i) => makeMockRow(i)).reverse(); // newest first

function makeMockPool(rows = ALL_ROWS): Pool {
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: String(rows.length) }], rowCount: 1 };
      }

      // Simple LIMIT extraction
      const limitMatch = sql.match(/LIMIT \$(\d+)/);
      const limitIdx = limitMatch ? parseInt(limitMatch[1], 10) - 1 : -1;
      const limit = limitIdx >= 0 ? (params[limitIdx] as number) : rows.length;

      // Simple cursor filter: skip rows until id matches
      let filtered = [...rows];
      const afterParam = (params as string[]).find((p) => typeof p === 'string' && p.startsWith('20'));
      if (afterParam) {
        const idx = filtered.findIndex((r) => r.createdAt <= afterParam);
        filtered = idx >= 0 ? filtered.slice(idx) : [];
      }

      return { rows: filtered.slice(0, limit), rowCount: Math.min(limit, filtered.length) };
    }) as Pool['query'],
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  } as unknown as Pool;
}

async function makeContext(pool: Pool) {
  const [subLoader, txLoader, pmLoader, planLoader] = await Promise.all([
    createSubscriptionLoader(pool),
    createTransactionLoader(pool),
    createPaymentMethodLoader(pool),
    createPlanLoader(pool),
  ]);
  return {
    pool,
    loaders: { subscriptionLoader: subLoader, transactionLoader: txLoader, paymentMethodLoader: pmLoader, planLoader },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GraphQL cursor-based pagination', () => {
  it('returns first page with correct pageInfo', async () => {
    const pool = makeMockPool();
    const ctx = await makeContext(pool);

    const result = await resolvers.Query.subscriptions(
      undefined,
      { userId: 'user_1', first: 10 },
      ctx,
    );

    expect(result.edges).toHaveLength(10);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(false);
    expect(result.pageInfo.startCursor).toBeTruthy();
    expect(result.pageInfo.endCursor).toBeTruthy();
    expect(result.totalCount).toBe(30);
  });

  it('cursor is valid Base64 JSON', async () => {
    const pool = makeMockPool();
    const ctx = await makeContext(pool);

    const result = await resolvers.Query.subscriptions(
      undefined,
      { userId: 'user_1', first: 5 },
      ctx,
    );

    const cursor = result.pageInfo.endCursor!;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { id: string; sortValue: string };
    expect(decoded).toHaveProperty('id');
    expect(decoded).toHaveProperty('sortValue');
  });

  it('returns empty edges when no subscriptions exist', async () => {
    const pool = makeMockPool([]);
    const ctx = await makeContext(pool);

    const result = await resolvers.Query.subscriptions(
      undefined,
      { userId: 'user_nobody', first: 10 },
      ctx,
    );

    expect(result.edges).toHaveLength(0);
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it('caps first at 100', async () => {
    const pool = makeMockPool(Array.from({ length: 200 }, (_, i) => makeMockRow(i)));
    const ctx = await makeContext(pool);

    const result = await resolvers.Query.subscriptions(
      undefined,
      { userId: 'user_1', first: 500 },
      ctx,
    );

    // Pool receives limit = 101 (100 + 1 for hasNextPage detection)
    const calls = (pool.query as jest.Mock).mock.calls as Array<[string, unknown[]]>;
    const limitCall = calls.find(([sql]) => !sql.includes('COUNT(*)'));
    expect(limitCall).toBeTruthy();
    const limitParam = limitCall![1][limitCall![1].length - 1] as number;
    expect(limitParam).toBe(101); // 100 + 1
    expect(result.edges.length).toBeLessThanOrEqual(100);
  });

  it('deprecation warning is logged for offset resolver', async () => {
    const pool = makeMockPool();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = await makeContext(pool);

    await resolvers.Query.subscriptionsOffset(
      undefined,
      { userId: 'user_1', limit: 5, offset: 0 },
      ctx,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
    warnSpy.mockRestore();
  });
});
