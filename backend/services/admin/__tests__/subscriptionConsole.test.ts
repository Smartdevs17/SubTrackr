import { AccessControlService } from '../../accessControl';
import {
  InMemorySubscriptionConsoleStore,
  SubscriptionConsoleError,
  SubscriptionConsoleService,
  type ManagedSubscription,
} from '../subscriptionConsole';
import {
  registerSubscriptionConsoleRoutes,
  type SubscriptionConsoleRequest,
  type SubscriptionConsoleResponse,
  type SubscriptionConsoleRouter,
} from '../subscriptionConsoleRouter';

const FIXED_NOW = new Date('2026-11-23T12:00:00.000Z');

const subscription = (
  id: string,
  status: ManagedSubscription['status'],
  overrides: Partial<ManagedSubscription> = {}
): ManagedSubscription => ({
  id,
  ownerId: `owner_${id}`,
  planId: 'plan_pro',
  status,
  amount: 29,
  currency: 'USD',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

interface Harness {
  service: SubscriptionConsoleService;
  accessControl: AccessControlService;
}

function harness(seed: readonly ManagedSubscription[] = []): Harness {
  const accessControl = new AccessControlService();
  accessControl.bootstrap('admin_1');
  accessControl.assignRole('manager_1', 'manager', 'admin_1');
  accessControl.assignRole('viewer_1', 'viewer', 'admin_1');
  return {
    accessControl,
    service: new SubscriptionConsoleService({
      store: new InMemorySubscriptionConsoleStore(seed),
      accessControl,
      clock: () => FIXED_NOW,
    }),
  };
}

describe('SubscriptionConsoleService', () => {
  it('lists, filters and paginates subscriptions for readers', async () => {
    const { service } = harness([
      subscription('sub_1', 'active', { createdAt: '2026-11-03T00:00:00.000Z' }),
      subscription('sub_2', 'paused', { createdAt: '2026-11-02T00:00:00.000Z' }),
      subscription('sub_3', 'active', { createdAt: '2026-11-01T00:00:00.000Z' }),
    ]);

    const page = await service.listSubscriptions('admin_1', { status: 'active', limit: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe('sub_1');

    const searched = await service.listSubscriptions('admin_1', { search: 'owner_sub_3' });
    expect(searched.items.map((row) => row.id)).toEqual(['sub_3']);
  });

  it('rejects viewers that attempt mutations and managers that cancel', async () => {
    const { service } = harness([subscription('sub_1', 'active')]);

    await expect(service.pauseSubscription('viewer_1', 'sub_1', 'support')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(service.cancelSubscription('manager_1', 'sub_1', 'support')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('applies lifecycle transitions and records an audit trail', async () => {
    const { service } = harness([subscription('sub_1', 'active')]);

    const paused = await service.pauseSubscription('admin_1', 'sub_1', 'fraud review');
    expect(paused.status).toBe('paused');
    expect(paused.pausedAt).toBe(FIXED_NOW.toISOString());

    const resumed = await service.resumeSubscription('admin_1', 'sub_1');
    expect(resumed.status).toBe('active');
    expect(resumed.pausedAt).toBeUndefined();

    const canceled = await service.cancelSubscription('admin_1', 'sub_1', 'customer request');
    expect(canceled.status).toBe('canceled');
    expect(canceled.cancelReason).toBe('customer request');

    const audit = await service.getAuditLog('admin_1');
    expect(audit.map((record) => record.action)).toEqual([
      'cancel_subscription',
      'resume_subscription',
      'pause_subscription',
    ]);
    expect(audit[2].before).toEqual({ status: 'active', planId: 'plan_pro' });
    await expect(service.resumeSubscription('admin_1', 'sub_1')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('changes plans and validates identifiers', async () => {
    const { service } = harness([subscription('sub_1', 'trialing')]);
    const changed = await service.changePlan('admin_1', 'sub_1', 'plan_enterprise');
    expect(changed.planId).toBe('plan_enterprise');
    await expect(service.changePlan('admin_1', 'sub_1', '  ')).rejects.toBeInstanceOf(
      SubscriptionConsoleError
    );
    await expect(service.getSubscription('admin_1', 'missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('reports partial failures for bulk pause', async () => {
    const { service } = harness([
      subscription('sub_1', 'active'),
      subscription('sub_2', 'paused'),
      subscription('sub_3', 'active'),
    ]);
    const result = await service.bulkPause('admin_1', ['sub_1', 'sub_2', 'sub_3'], 'incident');
    expect(result.succeeded).toEqual(['sub_1', 'sub_3']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ id: 'sub_2', code: 'INVALID_TRANSITION' });
  });

  it('summarises active revenue', async () => {
    const { service } = harness([
      subscription('sub_1', 'active', { amount: 10 }),
      subscription('sub_2', 'trialing', { amount: 20 }),
      subscription('sub_3', 'canceled', { amount: 40 }),
    ]);
    const summary = await service.getSummary('admin_1');
    expect(summary.total).toBe(3);
    expect(summary.byStatus.canceled).toBe(1);
    expect(summary.monthlyRecurringRevenue).toBe(30);
  });
});

describe('subscription console routes', () => {
  function routerWith(service: SubscriptionConsoleService) {
    const routes: Array<[string, string, string]> = [];
    const router: SubscriptionConsoleRouter = {
      get: (path) => routes.push(['GET', path, '']),
      post: (path) => routes.push(['POST', path, '']),
      patch: (path) => routes.push(['PATCH', path, '']),
    };
    registerSubscriptionConsoleRoutes(router, service);
    return routes;
  }

  it('registers summary and bulk routes before the id route', () => {
    const routes = routerWith(harness().service);
    const paths = routes.filter(([, path]) => path.startsWith('/admin/subscriptions/'));
    expect(paths[0][1]).toBe('/admin/subscriptions/summary');
    expect(paths[1][1]).toBe('/admin/subscriptions/audit');
    expect(paths[2][1]).toBe('/admin/subscriptions/bulk-pause');
    expect(routes).toContainEqual(['POST', '/admin/subscriptions/:id/pause', '']);
  });

  it('maps domain errors onto the standard error envelope', async () => {
    const { service } = harness([subscription('sub_1', 'active')]);
    const captured: { status?: number; body?: unknown } = {};
    const res: SubscriptionConsoleResponse = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(body: unknown) {
        captured.body = body;
      },
    };
    const routes: Record<string, (req: SubscriptionConsoleRequest, res: SubscriptionConsoleResponse) => Promise<void>> = {};
    const recordingRouter: SubscriptionConsoleRouter = {
      get: (path, handler) => {
        routes[`GET ${path}`] = handler;
      },
      post: (path, handler) => {
        routes[`POST ${path}`] = handler;
      },
      patch: (path, handler) => {
        routes[`PATCH ${path}`] = handler;
      },
    };
    registerSubscriptionConsoleRoutes(recordingRouter, service);

    await routes['POST /admin/subscriptions/:id/pause'](
      { actorId: 'viewer_1', params: { id: 'sub_1' }, body: { reason: 'support' } },
      res
    );
    expect(captured.status).toBe(403);
    expect(captured.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
