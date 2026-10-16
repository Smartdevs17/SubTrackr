/**
 * The keyset paginated resolvers issue two independent queries per page: the
 * page itself and a `COUNT(*)` for `totalCount`. These tests pin that they are
 * issued *concurrently*, so a page costs `max(page, count)` rather than
 * `page + count`.
 *
 * The barrier pool below is the mechanism: no query resolves until at least two
 * are in flight. If the resolver awaited the page query before starting the
 * count, the first query could never settle and the test would time out.
 */

import { resolvers } from '../resolvers';

type Row = Record<string, unknown>;

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => {
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
  });
}

function makeBarrierPool(rows: Row[]) {
  const state = { issued: 0 };
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    state.issued += 1;
    if (state.issued >= 2) release();
    await gate;

    if (sql.includes('COUNT(*)')) {
      return { rows: [{ count: String(rows.length) }], rowCount: 1 };
    }
    const limitMatch = sql.match(/LIMIT \$(\d+)/);
    const limitIdx = limitMatch ? parseInt(limitMatch[1], 10) - 1 : -1;
    const limit = limitIdx >= 0 ? (params[limitIdx] as number) : rows.length;
    return { rows: rows.slice(0, limit), rowCount: Math.min(limit, rows.length) };
  });

  return { pool: { query } as never, query, state };
}

const ctxWith = (pool: unknown) => ({ pool, loaders: {} as never });

describe('GraphQL keyset pagination issues its queries concurrently', () => {
  const ROWS = makeRows(30);

  it('runs the subscriptions page query and its count at the same time', async () => {
    const { pool, query, state } = makeBarrierPool(ROWS);
    // Nothing resolves until two queries are in flight; a timeout here means
    // the resolver serialised them.
    const result = await resolvers.Query.subscriptions(
      undefined,
      { userId: 'user_1', first: 10 },
      ctxWith(pool),
    );

    expect(state.issued).toBe(2);
    expect(result.edges).toHaveLength(10);
    expect(result.totalCount).toBe(30);

    const sqls = query.mock.calls.map((call) => String(call[0]));
    expect(sqls.some((sql) => sql.includes('COUNT(*)'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('FROM subscriptions s'))).toBe(true);
  });

  it('runs the transactions page query and its count at the same time', async () => {
    const { pool, query, state } = makeBarrierPool(ROWS);

    await resolvers.Subscription.transactions(
      { id: 'sub_1' },
      { first: 10 },
      ctxWith(pool),
    );

    expect(state.issued).toBe(2);
    const sqls = query.mock.calls.map((call) => String(call[0]));
    expect(sqls.some((sql) => sql.includes('COUNT(*)'))).toBe(true);
    expect(sqls.some((sql) => sql.includes('FROM transactions t'))).toBe(true);
  });

  it('still returns the correct page and total when both queries are concurrent', async () => {
    const { pool } = makeBarrierPool(ROWS);

    const result = await resolvers.Query.subscriptions(
      undefined,
      { userId: 'user_1', first: 10 },
      ctxWith(pool),
    );

    expect(result.edges).toHaveLength(10);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(false);
    expect(result.totalCount).toBe(30);
    // The count query is scoped to the caller, never parameterless.
    const countCall = (pool as { query: jest.Mock }).query.mock.calls.find((call) =>
      String(call[0]).includes('COUNT(*)')
    );
    expect(countCall?.[1]).toEqual(['user_1']);
  });
});
