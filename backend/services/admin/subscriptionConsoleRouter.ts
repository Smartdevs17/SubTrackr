/**
 * Express-compatible routes for the administrator subscription console.
 *
 * Route registration is explicit so the console can be mounted on a dedicated
 * admin router without inheriting the public subscription API's middleware.
 */

import { buildErrorEnvelope } from '../../src/middleware/errorEnvelope';
import {
  SubscriptionConsoleError,
  type ManagedSubscriptionStatus,
  type SubscriptionConsoleService,
} from './subscriptionConsole';

export interface SubscriptionConsoleRequest {
  actorId?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}

export interface SubscriptionConsoleResponse {
  status(code: number): SubscriptionConsoleResponse;
  json(body: unknown): void;
}

export type SubscriptionConsoleHandler = (
  req: SubscriptionConsoleRequest,
  res: SubscriptionConsoleResponse
) => Promise<void>;

export interface SubscriptionConsoleRouter {
  get(path: string, handler: SubscriptionConsoleHandler): void;
  post(path: string, handler: SubscriptionConsoleHandler): void;
  patch(path: string, handler: SubscriptionConsoleHandler): void;
}

function stringParam(req: SubscriptionConsoleRequest, key: string): string {
  const value = req.params?.[key] ?? req.body?.[key] ?? req.query?.[key];
  return typeof value === 'string' ? value : '';
}

function numberParam(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sendError(res: SubscriptionConsoleResponse, error: unknown): void {
  if (error instanceof SubscriptionConsoleError) {
    res.status(error.status).json(
      buildErrorEnvelope(error.status, error.message, { code: error.code })
    );
    return;
  }
  const status = 500;
  res.status(status).json(
    buildErrorEnvelope(status, 'Internal server error', { code: 'INTERNAL_SERVER_ERROR' })
  );
}

function handle(
  action: (req: SubscriptionConsoleRequest) => Promise<unknown>
): SubscriptionConsoleHandler {
  return async (req, res) => {
    try {
      const data = await action(req);
      res.status(200).json({ success: true, data });
    } catch (error) {
      sendError(res, error);
    }
  };
}

/** Register all console endpoints on an Express-compatible router. */
export function registerSubscriptionConsoleRoutes(
  router: SubscriptionConsoleRouter,
  service: SubscriptionConsoleService
): void {
  router.get(
    '/admin/subscriptions',
    handle((req) =>
      service.listSubscriptions(req.actorId ?? '', {
        status: stringParam(req, 'status') as ManagedSubscriptionStatus | undefined,
        ownerId: stringParam(req, 'ownerId') || undefined,
        planId: stringParam(req, 'planId') || undefined,
        search: stringParam(req, 'search') || undefined,
        limit: numberParam(req.query?.limit),
        offset: numberParam(req.query?.offset),
      })
    )
  );

  router.get(
    '/admin/subscriptions/summary',
    handle((req) => service.getSummary(req.actorId ?? ''))
  );

  router.get(
    '/admin/subscriptions/audit',
    handle((req) =>
      service.getAuditLog(req.actorId ?? '', {
        subscriptionId: stringParam(req, 'subscriptionId') || undefined,
        actorId: stringParam(req, 'actorId') || undefined,
        limit: numberParam(req.query?.limit),
      })
    )
  );

  router.post(
    '/admin/subscriptions/bulk-pause',
    handle((req) => {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      return service.bulkPause(
        req.actorId ?? '',
        ids.filter((id): id is string => typeof id === 'string'),
        String(req.body?.reason ?? '')
      );
    })
  );

  router.get(
    '/admin/subscriptions/:id',
    handle((req) => service.getSubscription(req.actorId ?? '', stringParam(req, 'id')))
  );

  router.post(
    '/admin/subscriptions/:id/pause',
    handle((req) =>
      service.pauseSubscription(
        req.actorId ?? '',
        stringParam(req, 'id'),
        String(req.body?.reason ?? '')
      )
    )
  );

  router.post(
    '/admin/subscriptions/:id/resume',
    handle((req) =>
      service.resumeSubscription(req.actorId ?? '', stringParam(req, 'id'))
    )
  );

  router.post(
    '/admin/subscriptions/:id/cancel',
    handle((req) =>
      service.cancelSubscription(
        req.actorId ?? '',
        stringParam(req, 'id'),
        String(req.body?.reason ?? '')
      )
    )
  );

  router.patch(
    '/admin/subscriptions/:id/plan',
    handle((req) =>
      service.changePlan(req.actorId ?? '', stringParam(req, 'id'), String(req.body?.planId ?? ''))
    )
  );
}
