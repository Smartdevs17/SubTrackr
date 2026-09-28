/**
 * QuickBooks Integration Router
 *
 * Mounts OAuth and sync endpoints for the QuickBooks Online integration.
 *
 * Routes:
 *   GET  /quickbooks/connect           — Start OAuth flow (redirect to Intuit)
 *   GET  /quickbooks/callback          — OAuth callback handler
 *   POST /quickbooks/disconnect        — Revoke tokens and disconnect
 *   GET  /quickbooks/status            — Connection status
 *   POST /quickbooks/sync/customers    — Sync customers to QBO
 *   POST /quickbooks/sync/plans        — Sync subscription plans → QBO items
 *   POST /quickbooks/sync/invoices     — Sync invoices to QBO
 *   POST /quickbooks/sync/payments     — Sync payments to QBO
 *   POST /quickbooks/sync/full         — Full sync (all entities)
 */

import { Router, type Request, type Response } from 'express';
import type { QuickBooksOAuthService } from './QuickBooksOAuthService';
import type { QuickBooksSyncService } from './QuickBooksSyncService';

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'Internal error';
      // Don't expose QBO errors with tokens
      const sanitized = message.replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]');
      res.status(500).json({ success: false, error: sanitized });
    });
  };
}

export interface QuickBooksRouterOptions {
  /**
   * Extract the authenticated merchantId from the request.
   * Override to integrate with your existing auth middleware.
   */
  getMerchantId?: (req: Request) => string | undefined;
}

export function createQuickBooksRouter(
  oauthService: QuickBooksOAuthService,
  syncService: QuickBooksSyncService,
  options: QuickBooksRouterOptions = {},
): Router {
  const router = Router();

  const getMerchantId =
    options.getMerchantId ??
    ((req: Request): string | undefined => {
      // Default: read from x-merchant-id header or req body
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

  // ── OAuth Flow ─────────────────────────────────────────────────────────────

  /**
   * GET /quickbooks/connect
   * Starts the OAuth flow. Redirects the user to the Intuit authorization page.
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
   * GET /quickbooks/callback
   * Handles the redirect from Intuit after the user grants access.
   */
  router.get(
    '/callback',
    asyncHandler(async (req: Request, res: Response) => {
      const { code, state, realmId, error } = req.query as {
        code?: string;
        state?: string;
        realmId?: string;
        error?: string;
      };

      if (error) {
        res.status(400).json({ success: false, error: `QuickBooks authorization denied: ${error}` });
        return;
      }

      if (!code || !state || !realmId) {
        res.status(400).json({ success: false, error: 'Missing code, state, or realmId in callback' });
        return;
      }

      const tokenSet = await oauthService.handleCallback(code, state, realmId);

      // In a real app, redirect to the frontend with a success message.
      // Here we return JSON for API-mode usage.
      res.json({
        success: true,
        merchantId: tokenSet.merchantId,
        realmId: tokenSet.realmId,
        expiresAt: new Date(tokenSet.accessTokenExpiresAt).toISOString(),
        message: 'QuickBooks connected successfully',
      });
    }),
  );

  /**
   * POST /quickbooks/disconnect
   * Revokes tokens and removes the QBO connection.
   */
  router.post(
    '/disconnect',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      await oauthService.disconnect(merchantId);
      res.json({ success: true, message: 'QuickBooks disconnected' });
    }),
  );

  /**
   * GET /quickbooks/status
   * Returns the current connection status for a merchant.
   */
  router.get(
    '/status',
    (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      const connected = oauthService.isConnected(merchantId);
      const tokenSet = oauthService.getTokenSet(merchantId);

      res.json({
        success: true,
        connected,
        realmId: tokenSet?.realmId,
        accessTokenExpiresAt: tokenSet
          ? new Date(tokenSet.accessTokenExpiresAt).toISOString()
          : undefined,
        refreshTokenExpiresAt: tokenSet
          ? new Date(tokenSet.refreshTokenExpiresAt).toISOString()
          : undefined,
      });
    },
  );

  // ── Sync Endpoints ─────────────────────────────────────────────────────────

  /**
   * POST /quickbooks/sync/customers
   * Body: { customers: SubTrackrCustomer[] }
   */
  router.post(
    '/sync/customers',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      if (!oauthService.isConnected(merchantId)) {
        res.status(400).json({ success: false, error: 'QuickBooks is not connected' });
        return;
      }

      const { customers } = req.body as {
        customers?: import('./QuickBooksSyncService').SubTrackrCustomer[];
      };

      if (!Array.isArray(customers)) {
        res.status(400).json({ success: false, error: 'customers array is required' });
        return;
      }

      const result = await syncService.syncCustomers(merchantId, customers);
      res.json({ success: true, result });
    }),
  );

  /**
   * POST /quickbooks/sync/plans
   * Body: { plans: SubTrackrPlan[] }
   */
  router.post(
    '/sync/plans',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      if (!oauthService.isConnected(merchantId)) {
        res.status(400).json({ success: false, error: 'QuickBooks is not connected' });
        return;
      }

      const { plans } = req.body as { plans?: import('./QuickBooksSyncService').SubTrackrPlan[] };
      if (!Array.isArray(plans)) {
        res.status(400).json({ success: false, error: 'plans array is required' });
        return;
      }

      const results: import('./QuickBooksSyncService').QBOIdMapping[] = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const plan of plans) {
        try {
          const mapping = await syncService.syncPlan(merchantId, plan);
          results.push(mapping);
        } catch (err) {
          errors.push({ id: plan.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      res.json({ success: true, synced: results.length, errors });
    }),
  );

  /**
   * POST /quickbooks/sync/invoices
   * Body: { invoices: SubTrackrInvoice[] }
   */
  router.post(
    '/sync/invoices',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      if (!oauthService.isConnected(merchantId)) {
        res.status(400).json({ success: false, error: 'QuickBooks is not connected' });
        return;
      }

      const { invoices } = req.body as { invoices?: import('./QuickBooksSyncService').SubTrackrInvoice[] };
      if (!Array.isArray(invoices)) {
        res.status(400).json({ success: false, error: 'invoices array is required' });
        return;
      }

      const results: import('./QuickBooksSyncService').QBOIdMapping[] = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const invoice of invoices) {
        try {
          const mapping = await syncService.syncInvoice(merchantId, invoice);
          results.push(mapping);
        } catch (err) {
          errors.push({ id: invoice.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      res.json({ success: true, synced: results.length, errors });
    }),
  );

  /**
   * POST /quickbooks/sync/payments
   * Body: { payments: SubTrackrPayment[] }
   */
  router.post(
    '/sync/payments',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      if (!oauthService.isConnected(merchantId)) {
        res.status(400).json({ success: false, error: 'QuickBooks is not connected' });
        return;
      }

      const { payments } = req.body as { payments?: import('./QuickBooksSyncService').SubTrackrPayment[] };
      if (!Array.isArray(payments)) {
        res.status(400).json({ success: false, error: 'payments array is required' });
        return;
      }

      const results: import('./QuickBooksSyncService').QBOIdMapping[] = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const payment of payments) {
        try {
          const mapping = await syncService.syncPayment(merchantId, payment);
          results.push(mapping);
        } catch (err) {
          errors.push({ id: payment.id, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      res.json({ success: true, synced: results.length, errors });
    }),
  );

  /**
   * POST /quickbooks/sync/full
   * Body: { customers, plans, invoices, payments }
   * Performs a complete sync of all entities in the correct dependency order.
   */
  router.post(
    '/sync/full',
    asyncHandler(async (req: Request, res: Response) => {
      const merchantId = requireMerchant(req, res);
      if (!merchantId) return;

      if (!oauthService.isConnected(merchantId)) {
        res.status(400).json({ success: false, error: 'QuickBooks is not connected' });
        return;
      }

      const { customers = [], plans = [], invoices = [], payments = [] } = req.body as {
        customers?: import('./QuickBooksSyncService').SubTrackrCustomer[];
        plans?: import('./QuickBooksSyncService').SubTrackrPlan[];
        invoices?: import('./QuickBooksSyncService').SubTrackrInvoice[];
        payments?: import('./QuickBooksSyncService').SubTrackrPayment[];
      };

      const result = await syncService.fullSync(merchantId, { customers, plans, invoices, payments });
      res.json({ success: true, result });
    }),
  );

  return router;
}
