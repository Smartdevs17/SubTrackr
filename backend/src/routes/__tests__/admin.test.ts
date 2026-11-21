/** Route-level tests for keyset-paginated admin lists (Issue #2079). */

import {
  ADMIN_RESOURCES,
  type AdminListFetcher,
  type AdminListMetricsEvent,
  type AdminListRow,
  type AdminRequest,
  type AdminResponse,
  type AdminRouteLogger,
  type AdminRouter,
  createAdminListHandler,
  encodeCursor,
  registerAdminRoutes,
} from '../admin';

const at = (day: number): string => new Date(Date.UTC(2026, 0, day)).toISOString();

const ROWS: AdminListRow[] = [
  { id: 'u3', createdAt: at(3) },
  { id: 'u2', createdAt: at(2) },
  { id: 'u1', createdAt: at(1) },
];

class FakeResponse implements AdminResponse {
  statusCode = 200;
  body: unknown = null;

  status(code: number): AdminResponse {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): void {
    this.body = body;
  }
}

class FakeRouter implements AdminRouter {
  readonly routes = new Map<string, (req: AdminRequest, res: AdminResponse) => Promise<void>>();

  get(path: string, handler: (req: AdminRequest, res: AdminResponse) => Promise<void>): void {
    this.routes.set(path, handler);
  }
}

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } satisfies AdminRouteLogger;
}

function harness(options: { failFetch?: boolean; rows?: readonly AdminListRow[] } = {}) {
  const logger = makeLogger();
  const metrics: AdminListMetricsEvent[] = [];
  const calls: Array<{ resource: string; query: unknown }> = [];
  const fetcher: AdminListFetcher = async (query, context) => {
    calls.push({ resource: context.resource, query });
    if (options.failFetch) throw new Error('db password leaked in this error');

    // Mirror the SQL contract: apply the keyset predicate, order by the
    // requested direction, and return at most fetchLimit rows.
    const naturalCompare = (a: AdminListRow, b: AdminListRow): number => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    };
    let rows = [...(options.rows ?? ROWS)];
    if (query.cursor) {
      const boundary: AdminListRow = { id: query.cursor.id, createdAt: query.cursor.createdAt };
      rows = rows.filter((row) =>
        query.direction === 'forward'
          ? naturalCompare(row, boundary) < 0
          : naturalCompare(row, boundary) > 0,
      );
    }
    rows.sort((a, b) =>
      query.direction === 'backward' ? naturalCompare(a, b) : -naturalCompare(a, b),
    );
    return rows.slice(0, query.fetchLimit);
  };
  const lists = Object.fromEntries(ADMIN_RESOURCES.map((resource) => [resource, fetcher])) as Record<
    (typeof ADMIN_RESOURCES)[number],
    AdminListFetcher
  >;
  let clock = 1_000;
  const deps = {
    lists,
    logger,
    onMetrics: (event: AdminListMetricsEvent) => metrics.push(event),
    now: () => {
      clock += 7;
      return clock;
    },
  };

  return { deps, logger, metrics, calls, handler: createAdminListHandler(deps) };
}

function responseBody(res: FakeResponse): Record<string, any> {
  return res.body as Record<string, any>;
}

describe('admin keyset routes (issue #2079)', () => {
  it('registers one generic heavy-list route', () => {
    const router = new FakeRouter();
    const { deps } = harness();
    registerAdminRoutes(router, deps);

    expect([...router.routes.keys()]).toEqual(['/admin/:resource']);
  });

  it('serves the first page with deterministic cursors and no COUNT work', async () => {
    const { handler, calls, metrics } = harness();
    const res = new FakeResponse();

    await handler({ params: { resource: 'users' }, query: { limit: '2' } }, res);

    expect(res.statusCode).toBe(200);
    const body = responseBody(res);
    expect(body.success).toBe(true);
    expect(body.data.resource).toBe('users');
    expect(body.data.items.map((row: AdminListRow) => row.id)).toEqual(['u3', 'u2']);
    expect(body.data.pageInfo.hasNextPage).toBe(true);
    expect(body.data.pageInfo.hasPreviousPage).toBe(false);
    expect(body.data.nextCursor).toBe(encodeCursor({ createdAt: at(2), id: 'u2' }));
    expect(calls[0]).toMatchObject({
      resource: 'users',
      query: { cursor: null, direction: 'forward', limit: 2, fetchLimit: 3 },
    });
    expect(metrics).toEqual([
      expect.objectContaining({
        resource: 'users',
        outcome: 'success',
        itemCount: 2,
        hasMore: true,
        durationMs: 7,
      }),
    ]);
  });

  it('rejects an invalid cursor before hitting the fetcher', async () => {
    const { handler, calls, logger, metrics } = harness();
    const res = new FakeResponse();

    await handler(
      { params: { resource: 'subscriptions' }, query: { cursor: 'offset-50' } },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(responseBody(res).error.code).toBe('INVALID_CURSOR');
    expect(calls).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      '[admin] invalid pagination request',
      expect.objectContaining({ resource: 'subscriptions', code: 'INVALID_CURSOR' }),
    );
    expect(metrics).toEqual([expect.objectContaining({ outcome: 'invalid_cursor' })]);
  });

  it('rejects an invalid direction with a 400', async () => {
    const { handler, calls, metrics } = harness();
    const res = new FakeResponse();

    await handler(
      { params: { resource: 'transactions' }, query: { direction: 'sideways' } },
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(responseBody(res).error.code).toBe('INVALID_PAGINATION');
    expect(calls).toHaveLength(0);
    expect(metrics).toEqual([expect.objectContaining({ outcome: 'invalid_pagination' })]);
  });

  it('rejects unsupported resources without calling a fetcher', async () => {
    const { handler, calls, metrics } = harness();
    const res = new FakeResponse();

    await handler({ params: { resource: 'secrets' } }, res);

    expect(res.statusCode).toBe(400);
    expect(responseBody(res).error.code).toBe('UNSUPPORTED_RESOURCE');
    expect(calls).toHaveLength(0);
    expect(metrics).toEqual([expect.objectContaining({ resource: 'secrets', outcome: 'unsupported_resource' })]);
  });

  it('supports backward paging with the before alias', async () => {
    const { handler, calls } = harness();
    const res = new FakeResponse();

    await handler(
      {
        params: { resource: 'audit-events' },
        query: { before: encodeCursor({ createdAt: at(1), id: 'u1' }), limit: '1' },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(calls[0]).toMatchObject({ query: { direction: 'backward', limit: 1, fetchLimit: 2 } });
    const body = responseBody(res);
    expect(body.data.items.map((row: AdminListRow) => row.id)).toEqual(['u2']);
    expect(body.data.pageInfo.hasPreviousPage).toBe(true);
    expect(body.data.prevCursor).toBe(encodeCursor({ createdAt: at(2), id: 'u2' }));
  });

  it('clamps oversized page requests to the safe ceiling', async () => {
    const { handler, calls } = harness();
    const res = new FakeResponse();

    await handler({ params: { resource: 'users' }, query: { limit: '5000' } }, res);

    expect(calls[0]).toMatchObject({ query: { limit: 100, fetchLimit: 101 } });
  });

  it('hides fetcher errors and records them', async () => {
    const { handler, logger, metrics } = harness({ failFetch: true });
    const res = new FakeResponse();

    await handler({ params: { resource: 'users' } }, res);

    expect(res.statusCode).toBe(500);
    expect(responseBody(res).error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('db password');
    expect(logger.error).toHaveBeenCalledWith('[admin] list fetch failed', expect.any(Object));
    expect(metrics).toEqual([expect.objectContaining({ outcome: 'error' })]);
  });
});
