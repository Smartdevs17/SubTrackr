/**
 * SubTrackr public API HTTP server factory.
 *
 * Mounts CDn-cacheable routes behind edge-cache header middleware.
 * Additional batch subscription routes are mounted with atomic execution support.
 *
 * Integration routes (not CDN-cached):
 *   /api/v1/zapier/*       — Zapier REST-hook integration
 *   /api/v1/quickbooks/*   — QuickBooks Online OAuth + sync
 *   /api/v1/calendar/*     — Calendar sync + renewal reminders
 *   /api/v1/webhooks/verify — Incoming webhook signature verification demo
 */

import express, { type Express, type Request, type Response } from 'express';
import { cacheHeadersMiddleware } from '../shared/middleware';
import { createPublicApiRouter, createThemeRouter, createBatchRouter } from '../subscription/router';
import { API_VERSION_HEADER, API_VERSION_VALUE } from '../services/shared/apiResponse';

// ── Zapier integration ────────────────────────────────────────────────────────
import {
  ZapierIntegrationService,
  createZapierRouter,
} from '../integrations/zapier';

// ── QuickBooks integration ────────────────────────────────────────────────────
import { QuickBooksOAuthService } from '../integrations/quickbooks/QuickBooksOAuthService';
import { QuickBooksSyncService } from '../integrations/quickbooks/QuickBooksSyncService';
import { createQuickBooksRouter } from '../integrations/quickbooks/quickbooksRouter';

// ── Calendar + renewal reminders ──────────────────────────────────────────────
import { calendarSyncService } from '../calendar/domain/CalendarSyncService';
import { createCalendarSyncController } from '../calendar/controller/calendarSyncController';
import { RenewalReminderScheduler } from '../calendar/domain/RenewalReminderScheduler';
import { createRenewalReminderController } from '../calendar/controller/renewalReminderController';

// ── Webhook verification middleware ───────────────────────────────────────────
import KeyStore from '../shared/webhook/keyStore';
import {
  createWebhookVerificationMiddleware,
  captureRawBody,
} from '../shared/webhook/webhookVerificationMiddleware';

// ── Singletons (swap for DI container in production) ─────────────────────────

const zapierService = new ZapierIntegrationService();

const qbCredentials = {
  clientId: process.env['QB_CLIENT_ID'] ?? 'sandbox_client_id',
  clientSecret: process.env['QB_CLIENT_SECRET'] ?? 'sandbox_client_secret',
  redirectUri: process.env['QB_REDIRECT_URI'] ?? 'http://localhost:3000/api/v1/quickbooks/callback',
  environment: (process.env['QB_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production',
};
const qbOAuthService = new QuickBooksOAuthService(qbCredentials);
const qbSyncService = new QuickBooksSyncService(qbOAuthService);

const renewalScheduler = new RenewalReminderScheduler(calendarSyncService);
const calendarController = createCalendarSyncController({ syncService: calendarSyncService });
const reminderController = createRenewalReminderController({ scheduler: renewalScheduler });

const webhookKeyStore = new KeyStore(process.env['WEBHOOK_SIGNING_KEY'] ?? 'default-dev-key-change-in-prod');

export interface CreateApiServerOptions {
  /** Optional middleware applied before cache headers (e.g. auth). */
  beforeCache?: express.RequestHandler[];
}

export function createApiServer(options: CreateApiServerOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  if (options.beforeCache) {
    for (const mw of options.beforeCache) {
      app.use(mw);
    }
  }

  app.use((_req, res, next) => {
    res.setHeader(API_VERSION_HEADER, API_VERSION_VALUE);
    next();
  });

  // ── CDN-cached public routes ───────────────────────────────────────────────
  app.use(cacheHeadersMiddleware());
  app.use(createPublicApiRouter());
  app.use('/api/v1/merchant', createThemeRouter());
  app.use('/api/v1/batch', createBatchRouter());

  // ── Zapier integration ─────────────────────────────────────────────────────
  app.use('/api/v1/zapier', createZapierRouter(zapierService));

  // ── QuickBooks integration ─────────────────────────────────────────────────
  app.use('/api/v1/quickbooks', createQuickBooksRouter(qbOAuthService, qbSyncService));

  // ── Webhook signature verification demo endpoint ───────────────────────────
  // Uses captureRawBody only on this specific route so the stream isn't
  // consumed before express.json() processes all other routes.
  const webhookVerifyMw = createWebhookVerificationMiddleware(webhookKeyStore, {
    onFailure: (req, reason) => {
      console.warn(`[Webhook] Verification failed from ${req.ip}: ${reason}`);
    },
  });

  app.post(
    '/api/v1/webhooks/verify',
    captureRawBody,
    webhookVerifyMw,
    (_req: Request, res: Response) => {
      res.json({ success: true, message: 'Signature verified', verified: true });
    },
  );

  // ── Calendar sync routes ───────────────────────────────────────────────────

  const calRouter = express.Router();

  // Connections
  calRouter.post('/connections', (req: Request, res: Response) => {
    const result = calendarController.createConnection(req.body);
    res.status(result.success ? 201 : (result.status ?? 400)).json(result);
  });
  calRouter.get('/connections', (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    if (!userId) { res.status(400).json({ success: false, error: 'userId required' }); return; }
    res.json(calendarController.listConnections(userId));
  });
  calRouter.get('/connections/:id', (req: Request, res: Response) => {
    res.json(calendarController.getConnection(req.params.id));
  });
  calRouter.patch('/connections/:id', (req: Request, res: Response) => {
    res.json(calendarController.updateConnectionSettings(req.params.id, req.body));
  });
  calRouter.delete('/connections/:id', (req: Request, res: Response) => {
    res.json(calendarController.disconnectConnection(req.params.id));
  });

  // Events
  calRouter.post('/connections/:id/events', (req: Request, res: Response) => {
    const result = calendarController.createEvent(req.params.id, req.body);
    res.status(result.success ? 201 : (result.status ?? 400)).json(result);
  });
  calRouter.get('/connections/:id/events', (req: Request, res: Response) => {
    res.json(calendarController.listEvents(req.params.id));
  });
  calRouter.patch('/events/:id', (req: Request, res: Response) => {
    res.json(calendarController.updateEvent(req.params.id, req.body));
  });
  calRouter.delete('/events/:id', (req: Request, res: Response) => {
    res.json(calendarController.deleteEvent(req.params.id));
  });
  calRouter.get('/subscriptions/:subId/events', (req: Request, res: Response) => {
    res.json(calendarController.listEventsBySubscription(req.params.subId));
  });

  // Sync operations
  calRouter.post('/connections/:id/sync/push', (req: Request, res: Response) => {
    res.json(calendarController.pushSync(req.params.id));
  });
  calRouter.post('/connections/:id/sync/pull', (req: Request, res: Response) => {
    res.json(calendarController.pullSync(req.params.id, req.body?.remoteChanges ?? []));
  });
  calRouter.post('/connections/:id/sync/full', (req: Request, res: Response) => {
    res.json(calendarController.fullSync(req.params.id, req.body?.remoteChanges ?? []));
  });

  // ICS export
  calRouter.get('/connections/:id/export.ics', (req: Request, res: Response) => {
    const result = calendarController.exportICS(req.params.id);
    if (!result.success) { res.status(404).json(result); return; }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.ics"');
    res.send(result.data?.ics);
  });

  // Webhook notifications from calendar providers
  calRouter.post('/webhook', (req: Request, res: Response) => {
    res.json(calendarController.handleWebhook(req.body));
  });

  // Preferences
  calRouter.put('/preferences', (req: Request, res: Response) => {
    res.json(calendarController.setSyncPreferences(req.body));
  });
  calRouter.get('/preferences', (req: Request, res: Response) => {
    const userId = req.query['userId'] as string;
    if (!userId) { res.status(400).json({ success: false, error: 'userId required' }); return; }
    res.json(calendarController.getSyncPreferences(userId));
  });

  // ── Renewal Reminder routes ────────────────────────────────────────────────

  calRouter.post('/reminders/schedule', (req: Request, res: Response) => {
    const result = reminderController.scheduleRenewals(req.body);
    res.status(result.success ? 200 : (result.status ?? 400)).json(result);
  });

  calRouter.post('/reminders/schedule/:subscriptionId', (req: Request, res: Response) => {
    const result = reminderController.scheduleForSubscription(req.params.subscriptionId, req.body);
    res.status(result.success ? 200 : (result.status ?? 400)).json(result);
  });

  calRouter.delete('/reminders/:subscriptionId', (req: Request, res: Response) => {
    const result = reminderController.cancelReminders(req.params.subscriptionId);
    res.json(result);
  });

  calRouter.get('/reminders/subscription/:subscriptionId', (req: Request, res: Response) => {
    res.json(reminderController.getBySubscription(req.params.subscriptionId));
  });

  calRouter.get('/reminders/user/:userId', (req: Request, res: Response) => {
    res.json(reminderController.getByUser(req.params.userId));
  });

  calRouter.get('/reminders/upcoming', (req: Request, res: Response) => {
    const result = reminderController.getUpcoming(
      req.query['withinDays'] as string | undefined,
      req.query['now'] as string | undefined,
    );
    res.status(result.success ? 200 : (result.status ?? 400)).json(result);
  });

  calRouter.post('/reminders/process', (req: Request, res: Response) => {
    const result = reminderController.processReminders(req.body);
    res.status(result.success ? 200 : (result.status ?? 400)).json(result);
  });

  app.use('/api/v1/calendar', calRouter);

  // ── 404 fallback ───────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}

export function startApiServer(port: number = Number(process.env.PORT ?? 3000)): Express {
  const app = createApiServer();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`SubTrackr API listening on port ${port}`);
  });
  return app;
}
