/**
 * Zapier Integration Router
 *
 * Mounts the REST endpoints Zapier uses for triggers, actions, and searches.
 *
 * Routes:
 *
 *   Trigger subscriptions (REST hooks)
 *     POST   /zapier/hooks          — subscribe to an event
 *     DELETE /zapier/hooks/:id      — unsubscribe
 *     GET    /zapier/hooks          — list active subscriptions (for debug)
 *
 *   Trigger catalog (used by Zapier's UI)
 *     GET    /zapier/triggers        — list available trigger definitions
 *     GET    /zapier/triggers/:event/sample  — get sample payload
 *
 *   Actions (Zapier calls SubTrackr to perform work)
 *     POST   /zapier/actions        — execute an action
 *
 *   Searches (Zapier looks up data in SubTrackr)
 *     POST   /zapier/searches       — perform a search
 *
 *   Auth test
 *     GET    /zapier/auth/test      — Zapier uses this to validate API keys
 */

import { Router, type Request, type Response } from 'express';
import {
  ZapierIntegrationService,
  ZAPIER_TRIGGER_DEFINITIONS,
  ZAPIER_ACTION_DEFINITIONS,
  type RegisterHookInput,
  type ZapierTriggerEvent,
} from './ZapierIntegrationService';

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Internal error';
      res.status(500).json({ success: false, error: message });
    });
  };
}

/**
 * Creates the Zapier router. Inject the service instance for testability.
 */
export function createZapierRouter(service: ZapierIntegrationService): Router {
  const router = Router();

  // ── Auth guard ─────────────────────────────────────────────────────────────
  router.use((req: Request, res: Response, next) => {
    const apiKey =
      (req.headers['x-api-key'] as string | undefined) ??
      req.query['api_key'] as string | undefined;

    if (!apiKey) {
      res.status(401).json({ success: false, error: 'Missing X-Api-Key header' });
      return;
    }

    const merchantId = service.validateApiKey(apiKey);
    if (!merchantId) {
      res.status(401).json({ success: false, error: 'Invalid API key' });
      return;
    }

    // Attach merchantId for downstream handlers
    (req as Request & { merchantId: string }).merchantId = merchantId;
    next();
  });

  // ── Auth test ─────────────────────────────────────────────────────────────
  router.get(
    '/auth/test',
    (req: Request, res: Response) => {
      const merchantId = (req as Request & { merchantId: string }).merchantId;
      res.json({ success: true, merchantId, message: 'API key is valid' });
    },
  );

  // ── Trigger catalog ────────────────────────────────────────────────────────
  router.get('/triggers', (_req: Request, res: Response) => {
    res.json({ success: true, triggers: ZAPIER_TRIGGER_DEFINITIONS });
  });

  router.get('/triggers/:event/sample', (req: Request, res: Response) => {
    const trigger = ZAPIER_TRIGGER_DEFINITIONS.find(t => t.key === req.params.event);
    if (!trigger) {
      res.status(404).json({ success: false, error: 'Trigger not found' });
      return;
    }
    res.json({ success: true, sample: trigger.samplePayload });
  });

  // ── Action catalog ─────────────────────────────────────────────────────────
  router.get('/actions', (_req: Request, res: Response) => {
    res.json({ success: true, actions: ZAPIER_ACTION_DEFINITIONS });
  });

  // ── Hook subscriptions ─────────────────────────────────────────────────────

  // Register a REST hook
  router.post(
    '/hooks',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = (req as Request & { merchantId: string }).merchantId;
      const { targetUrl, event } = req.body as { targetUrl?: string; event?: string };

      if (!targetUrl || !event) {
        res.status(400).json({ success: false, error: 'targetUrl and event are required' });
        return;
      }

      // Validate event is known
      const validEvent = ZAPIER_TRIGGER_DEFINITIONS.find(t => t.key === event);
      if (!validEvent) {
        res.status(400).json({
          success: false,
          error: `Unknown event '${event}'. Valid events: ${ZAPIER_TRIGGER_DEFINITIONS.map(t => t.key).join(', ')}`,
        });
        return;
      }

      const input: RegisterHookInput = {
        merchantId,
        targetUrl,
        event: event as ZapierTriggerEvent,
      };

      const hook = service.registerHook(input);

      // Return 201 with the hook data; Zapier uses the id for future DELETE
      res.status(201).json({
        success: true,
        hook: {
          id: hook.id,
          event: hook.event,
          targetUrl: hook.targetUrl,
          signingSecret: hook.signingSecret,
          createdAt: hook.createdAt,
        },
      });
    }),
  );

  // Unsubscribe a REST hook
  router.delete(
    '/hooks/:id',
    (req: Request, res: Response) => {
      const merchantId = (req as Request & { merchantId: string }).merchantId;
      const removed = service.unregisterHook(req.params.id, merchantId);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Hook not found' });
        return;
      }
      res.json({ success: true });
    },
  );

  // List hooks (debug / admin)
  router.get(
    '/hooks',
    (req: Request, res: Response) => {
      const merchantId = (req as Request & { merchantId: string }).merchantId;
      const hooks = service.listHooks(merchantId).map(h => ({
        id: h.id,
        event: h.event,
        targetUrl: h.targetUrl,
        active: h.active,
        createdAt: h.createdAt,
        lastFiredAt: h.lastFiredAt,
        failureCount: h.failureCount,
      }));
      res.json({ success: true, hooks });
    },
  );

  // ── Actions ────────────────────────────────────────────────────────────────

  router.post(
    '/actions',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = (req as Request & { merchantId: string }).merchantId;
      const { action, params } = req.body as {
        action?: string;
        params?: Record<string, unknown>;
      };

      if (!action) {
        res.status(400).json({ success: false, error: 'action is required' });
        return;
      }

      const result = service.handleAction({
        merchantId,
        action: action as import('./ZapierIntegrationService').ZapierActionType,
        params: params ?? {},
      });

      res.status(result.success ? 200 : 400).json(result);
    }),
  );

  // ── Searches ───────────────────────────────────────────────────────────────

  router.post(
    '/searches',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = (req as Request & { merchantId: string }).merchantId;
      const { searchType, query } = req.body as {
        searchType?: string;
        query?: Record<string, unknown>;
      };

      if (!searchType) {
        res.status(400).json({ success: false, error: 'searchType is required' });
        return;
      }

      const result = service.handleSearch({
        merchantId,
        searchType: searchType as import('./ZapierIntegrationService').ZapierSearchType,
        query: query ?? {},
      });

      res.status(result.success ? 200 : 400).json(result);
    }),
  );

  return router;
}
