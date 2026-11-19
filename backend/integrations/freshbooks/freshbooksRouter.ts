/**
 * FreshBooks Integration Router
 *
 * Mounts the OAuth and sync endpoints for the FreshBooks accounting
 * integration. Every route is namespaced under `/api/v1/freshbooks` by
 * `createApiServer`.
 *
 * Routes:
 *   GET  /freshbooks/connect          — Start the OAuth flow (redirect to FreshBooks)
 *   GET  /freshbooks/callback         — OAuth callback handler
 *   POST /freshbooks/disconnect       — Forget the stored connection
 *   GET  /freshbooks/status           — Connection status + token expiry
 *   POST /freshbooks/sync/clients     — Sync clients
 *   POST /freshbooks/sync/invoices    — Sync invoices
 *   POST /freshbooks/sync/payments    — Sync payments
 *   POST /freshbooks/sync/expenses    — Sync expenses
 *   POST /freshbooks/sync/estimates   — Sync estimates
 *   POST /freshbooks/sync/full        — Full sync in dependency order
 *   GET  /freshbooks/sync/result      — Read back a previously stored id mapping
 */

import { Router, type Request, type Response } from 'express';
import type { FreshBooksOAuthService } from './FreshBooksOAuthService';
import type {
  FreshBooksEntityType,
  FreshBooksSyncService,
  SubTrackrClient,
  SubTrackrEstimate,
  SubTrackrExpense,
  SubTrackrInvoice,
  SubTrackrPayment,
  FreshBooksSyncResult,
} from './FreshBooksSyncService';

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Internal error';
      // Never echo a bearer token back to the caller.
      const sanitized = message.replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
      res.status(500).json({ success: false, error: sanitized });
    });
  };
}

export interface FreshBooksRouterOptions {
  /**
   * Extract the authenticated merchantId from the request.
   * Override to integrate with your existing auth middleware.
   */
  getMerchantId?: (req: Request) => string | undefined;
  /** CORS `Access-Control-Allow-Origin` value echoed on the OAuth callback. */
  successRedirectUrl?: string;
}

export function createFreshBooksRouter(
  oauthService: FreshBooksOAuthService,
  syncService: FreshBooksSyncService,
  options: FreshBooksRouterOptions = {},
): Router {
  const router = Router();

  const getMerchantId =
    options.getMerchantId ??
    ((req: Request): string | undefined => {
      const fromHeader = req.headers['x-merchant-id'];
      if (typeof fromHeader === 'string') return fromHeader;
      const fromBody = (req as Request & { body?: { merchantId?: string } }).body?.merchantId;
      return fromBody;
    });

  function requireMerchant(req: Request, res: Response): string | null {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      res.status(401).json({ success: false, error: 'merchantId is required' });
      return null;
    }
    return merchantId;
  }

  function requireConnected(merchantId: string, res: Response): boolean {
    if (oauthService.isConnected(merchantId)) return true;
    res.status(400).json({
      success: false,
      error: 'FreshBooks is not connected',
      needsReconnect: oauthService.needsReconnect(merchantId),
    });
    return false;
  }

  function bodyArray<T>(req: Request, res: Response, field: string): T[] | null {
    const value = (req.body as Record<string, unknown> | undefined)?.[field];
    if (!Array.isArray(value)) {
      res.status(400).json({ success: false, error: `${field} array is required` });
      return null;
    }
    return value as T[];
  }

  function sendResult(res: Response, result: FreshBooksSyncResult): void {
    const failed = result.errors.length > 0;
    res.status(failed ? 207 : 200).json({ success: !failed, result });
  }

  // ── OAuth Flow ─────────────────────────────────────────────────────────────

  /**
   * GET /freshbooks/connect
   * Redirects the merchant to the FreshBooks authorization page.
   */
  router.get(
    '/connect',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      const { url } = oauthService.getAuthorizationUrl(merchantId);
      res.redirect(url);
    }),
  );

  /**
   * GET /freshbooks/callback
   * Handles the redirect from FreshBooks once the merchant grants access.
   * When `successRedirectUrl` is configured the browser is redirected to the
   * app instead of receiving JSON, which is what a hosted dashboard needs.
   */
  router.get(
    '/callback',
    asyncHandler(async (req: Request, res: Response) => {
      const { code, state, account_id: accountId, error } = req.query as {
        code?: string;
        state?: string;
        account_id?: string;
        error?: string;
      };

      if (error) {
        res.status(400).json({ success: false, error: `FreshBooks authorization denied: ${error}` });
        return;
      }
      if (!code || !state || !accountId) {
        res.status(400).json({ success: false, error: 'Missing code, state, or account_id in callback' });
        return;
      }

      const tokenSet = await oauthService.handleCallback(code, state, accountId);

      if (options.successRedirectUrl) {
        res.redirect(options.successRedirectUrl);
        return;
      }

      res.json({
        success: true,
        merchantId: tokenSet.merchantId,
        accountId: tokenSet.accountId,
        expiresAt: new Date(tokenSet.accessTokenExpiresAt).toISOString(),
        message: 'FreshBooks connected successfully',
      });
    }),
  );

  /**
   * POST /freshbooks/disconnect
   * FreshBooks exposes no public revoke endpoint, so this only drops the token.
   */
  router.post(
    '/disconnect',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      oauthService.disconnect(merchantId);
      res.json({ success: true, message: 'FreshBooks disconnected' });
    }),
  );

  /**
   * GET /freshbooks/status
   * Reports whether the merchant can sync right now, and when the token lapses.
   */
  router.get('/status', (req: Request, res: Response) => {
    const merchantId = requireMerchant(req, res);
    if (!merchantId) return;

    const tokenSet = oauthService.getTokenSet(merchantId);
    res.json({
      success: true,
      connected: oauthService.isConnected(merchantId),
      needsReconnect: oauthService.needsReconnect(merchantId),
      accountId: tokenSet?.accountId,
      expiresAt: tokenSet ? new Date(tokenSet.accessTokenExpiresAt).toISOString() : undefined,
      expiresInMs: oauthService.getExpiresInMs(merchantId),
    });
  });

  // ── Sync Endpoints ─────────────────────────────────────────────────────────

  /** POST /freshbooks/sync/clients — body: `{ clients: SubTrackrClient[] }` */
  router.post(
    '/sync/clients',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;
      if (!requireConnected(merchantId, res)) return;

      const clients = bodyArray<SubTrackrClient>(req, res, 'clients');
      if (!clients) return;

      sendResult(res, await syncService.syncClients(merchantId, clients));
    }),
  );

  /** POST /freshbooks/sync/invoices — body: `{ invoices: SubTrackrInvoice[] }` */
  router.post(
    '/sync/invoices',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;
      if (!requireConnected(merchantId, res)) return;

      const invoices = bodyArray<SubTrackrInvoice>(req, res, 'invoices');
      if (!invoices) return;

      sendResult(res, await syncService.syncInvoices(merchantId, invoices));
    }),
  );

  /** POST /freshbooks/sync/payments — body: `{ payments: SubTrackrPayment[] }` */
  router.post(
    '/sync/payments',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;
      if (!requireConnected(merchantId, res)) return;

      const payments = bodyArray<SubTrackrPayment>(req, res, 'payments');
      if (!payments) return;

      sendResult(res, await syncService.syncPayments(merchantId, payments));
    }),
  );

  /** POST /freshbooks/sync/expenses — body: `{ expenses: SubTrackrExpense[] }` */
  router.post(
    '/sync/expenses',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;
      if (!requireConnected(merchantId, res)) return;

      const expenses = bodyArray<SubTrackrExpense>(req, res, 'expenses');
      if (!expenses) return;

      sendResult(res, await syncService.syncExpenses(merchantId, expenses));
    }),
  );

  /** POST /freshbooks/sync/estimates — body: `{ estimates: SubTrackrEstimate[] }` */
  router.post(
    '/sync/estimates',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;
      if (!requireConnected(merchantId, res)) return;

      const estimates = bodyArray<SubTrackrEstimate>(req, res, 'estimates');
      if (!estimates) return;

      sendResult(res, await syncService.syncEstimates(merchantId, estimates));
    }),
  );

  /**
   * POST /freshbooks/sync/full
   * Body: `{ clients, invoices, payments, expenses?, estimates? }`.
   * Entities are synced in dependency order so payments always resolve an
   * invoice and invoices always resolve a client.
   */
  router.post(
    '/sync/full',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;
      if (!requireConnected(merchantId, res)) return;

      const body = (req.body ?? {}) as Record<string, unknown>;
      if (!Array.isArray(body.clients)) {
        res.status(400).json({ success: false, error: 'clients array is required' });
        return;
      }

      const result = await syncService.fullSync(merchantId, {
        clients: body.clients as SubTrackrClient[],
        invoices: (body.invoices ?? []) as SubTrackrInvoice[],
        payments: (body.payments ?? []) as SubTrackrPayment[],
        expenses: (body.expenses ?? []) as SubTrackrExpense[],
        estimates: (body.estimates ?? []) as SubTrackrEstimate[],
      });

      const failed =
        result.clients.errors.length +
          result.invoices.errors.length +
          result.payments.errors.length +
          result.expenses.errors.length;
      res.status(failed > 0 ? 207 : 200).json({ success: failed === 0, result });
    }),
  );

  /**
   * GET /freshbooks/sync/result?entity=invoice&id=inv_123
   * Reads back the FreshBooks id a SubTrackr record was mapped to.
   */
  router.get('/sync/result', (req: Request, res: Response) => {
    const merchantId = requireMerchant(req, res);
    if (!merchantId) return;

    const entity = req.query['entity'] as FreshBooksEntityType | undefined;
    const id = req.query['id'] as string | undefined;
    const validEntities: FreshBooksEntityType[] = [
      'client',
      'invoice',
      'payment',
      'expense',
      'estimate',
    ];

    if (!entity || !validEntities.includes(entity) || !id) {
      res.status(400).json({
        success: false,
        error: `entity (one of ${validEntities.join(', ')}) and id are required`,
      });
      return;
    }

    const mapping = syncService.getMapping(entity, id);
    if (!mapping) {
      res.status(404).json({ success: false, error: `No ${entity} mapping stored for ${id}` });
      return;
    }

    res.json({ success: true, mapping });
  });
}
