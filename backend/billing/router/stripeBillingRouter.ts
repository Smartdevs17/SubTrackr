/**
 * Stripe Billing router (issue #1239).
 *
 * Mounts under `/api/v1/stripe/billing` by `createApiServer`. Every handler
 * returns the shape the rest of the API already uses — `{ success, data }` on
 * success, `{ success: false, error }` on failure — and translates a
 * `StripeApiError` into the right HTTP status:
 *
 * | Stripe status | HTTP | Meaning for the caller                       |
 * | ------------- | ---- | --------------------------------------------- |
 * | 400 / 404     | 400  | Bad request or unknown id — do not retry      |
 * | 402           | 402  | Card declined or requires action             |
 * | 429           | 429  | Rate limited — the client may retry           |
 * | 5xx           | 502  | Stripe is down — the client may retry         |
 *
 * The webhook route needs the raw body: Stripe signs `"<t>.<rawBody>"`, so it is
 * mounted with `express.raw` and a wildcard `type` option before
 * `express.json()` in `createApiServer`, and the payload is decoded only after
 * the signature verifies.
 */

import { Router, type Request, type Response } from 'express';
import {
  getRawRequestBody,
  parseJsonBody,
} from '../../shared/webhook/webhookVerificationMiddleware';
import { StripeApiError } from '../domain/stripe/StripeApiClient';
import { StripeBillingService } from '../domain/stripe/StripeBillingService';
import {
  StripeWebhookVerifier,
  readStripeSignatureHeader,
  type StripeEventShape,
} from '../domain/stripe/StripeWebhookVerifier';

export interface StripeBillingRouterOptions {
  /** `null` when `STRIPE_SECRET_KEY` is unset; the API routes then answer 503. */
  readonly service: StripeBillingService | null;
  /** `null` when `STRIPE_WEBHOOK_SECRET` is unset; the webhook answers 503. */
  readonly verifier: StripeWebhookVerifier | null;
  /**
   * Applies a verified event. Return `true` once handled; `false` makes the
   * route answer 500 so Stripe retries the delivery.
   */
  readonly onEvent?: (
    event: { eventId: string; eventType: string; event: Record<string, unknown> | null },
  ) => boolean | Promise<boolean>;
}

/** Stripe event types SubTrackr acts on; anything else is acknowledged only. */
const ACTIONABLE_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'charge.refunded',
]);

function httpStatusFor(error: StripeApiError): number {
  if (error.status === 402) return 402;
  if (error.status === 429) return 429;
  if (error.status === 404) return 404;
  if (error.status >= 400 && error.status < 500) return 400;
  return 502;
}

/** Never let a secret key reach a log or a response body. */
function redact(message: string): string {
  return message.replace(/\b(sk|rk|whsec)_[A-Za-z0-9]+/g, '$1_[REDACTED]');
}

export function createStripeBillingRouter(options: StripeBillingRouterOptions): Router {
  const router = Router();

  /**
   * Wraps a Stripe call so a configured-but-failing gateway and an
   * unconfigured one produce the same response shape.
   */
  async function handle(
    res: Response,
    action: () => Promise<unknown>,
    successStatus = 200,
  ): Promise<void> {
    if (!options.service) {
      res.status(503).json({
        success: false,
        error: 'Stripe is not configured; set STRIPE_SECRET_KEY to enable billing',
      });
      return;
    }
    try {
      const data = await action();
      res.status(successStatus).json({ success: true, data });
    } catch (error) {
      if (error instanceof StripeApiError) {
        res.status(httpStatusFor(error)).json({
          success: false,
          error: redact(error.message),
          stripeStatus: error.status,
          ...(error.code ? { stripeCode: error.code } : {}),
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: redact(error instanceof Error ? error.message : 'Internal error'),
      });
    }
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  router.post('/customers', (req: Request, res: Response) => {
    void handle(res, () => options.service!.createCustomer(req.body ?? {}), 201);
  });

  router.get('/customers/:customerId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.getCustomer(req.params.customerId));
  });

  router.patch('/customers/:customerId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.updateCustomer(req.params.customerId, req.body ?? {}));
  });

  router.delete('/customers/:customerId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.deleteCustomer(req.params.customerId));
  });

  // ── Subscriptions ──────────────────────────────────────────────────────────

  router.post('/subscriptions', (req: Request, res: Response) => {
    void handle(res, () => options.service!.createSubscription(req.body ?? {}), 201);
  });

  router.get('/subscriptions/:subscriptionId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.getSubscription(req.params.subscriptionId));
  });

  router.get('/customers/:customerId/subscriptions', (req: Request, res: Response) => {
    const limit = Number(req.query['limit'] ?? 10);
    void handle(res, () =>
      options.service!.listSubscriptions(req.params.customerId, Number.isFinite(limit) ? limit : 10),
    );
  });

  router.patch('/subscriptions/:subscriptionId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.updateSubscription(req.params.subscriptionId, req.body ?? {}));
  });

  /**
   * DELETE /subscriptions/:id?atPeriodEnd=false
   * The default (`true`) schedules cancellation at the period end; `false`
   * revokes access immediately.
   */
  router.delete('/subscriptions/:subscriptionId', (req: Request, res: Response) => {
    const atPeriodEnd = req.query['atPeriodEnd'] !== 'false';
    void handle(res, () =>
      options.service!.cancelSubscription(req.params.subscriptionId, atPeriodEnd),
    );
  });

  router.post('/subscriptions/:subscriptionId/resume', (req: Request, res: Response) => {
    void handle(res, () => options.service!.resumeSubscription(req.params.subscriptionId));
  });

  // ── Metered usage ──────────────────────────────────────────────────────────

  router.post('/subscription-items/:itemId/usage', (req: Request, res: Response) => {
    void handle(res, () => {
      const body = req.body ?? {};
      // A missing timestamp would be sent as NaN and rejected by Stripe, so it
      // is filled in here to keep the metering key stable for the period.
      const timestamp = Number.isFinite(Number(body.timestamp))
        ? Number(body.timestamp)
        : Math.floor(Date.now() / 1000);
      return options.service!.recordUsage({
        subscriptionItemId: req.params.itemId,
        quantity: Number(body.quantity),
        timestamp,
        action: body.action,
      });
    }, 201);
  });

  // ── Invoices ───────────────────────────────────────────────────────────────

  router.get('/customers/:customerId/invoices', (req: Request, res: Response) => {
    const limit = Number(req.query['limit'] ?? 10);
    void handle(res, () =>
      options.service!.listInvoices(req.params.customerId, Number.isFinite(limit) ? limit : 10),
    );
  });

  /**
   * GET /invoices/upcoming?customer=cus_1 or ?subscription=sub_1
   *
   * Declared before `/invoices/:invoiceId`, otherwise the parameterised route
   * matches "upcoming" first and Stripe is asked for an invoice named
   * "upcoming".
   */
  router.get('/invoices/upcoming', (req: Request, res: Response) => {
    void handle(res, () =>
      options.service!.getUpcomingInvoice({
        customer: req.query['customer'] as string | undefined,
        subscription: req.query['subscription'] as string | undefined,
      }),
    );
  });

  router.get('/invoices/:invoiceId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.getInvoice(req.params.invoiceId));
  });

  router.post('/invoices/:invoiceId/finalize', (req: Request, res: Response) => {
    void handle(res, () => options.service!.finalizeInvoice(req.params.invoiceId));
  });

  router.post('/invoices/:invoiceId/pay', (req: Request, res: Response) => {
    void handle(res, () => options.service!.payInvoice(req.params.invoiceId));
  });

  // ── Dunning ────────────────────────────────────────────────────────────────

  router.post('/subscriptions/:subscriptionId/dunning', (req: Request, res: Response) => {
    void handle(res, () => options.service!.configureDunning(req.params.subscriptionId, req.body ?? {}));
  });

  // ── Portal ─────────────────────────────────────────────────────────────────

  router.post('/portal-sessions', (req: Request, res: Response) => {
    void handle(res, () => options.service!.createPortalSession(req.body ?? {}), 201);
  });

  // ── Tax IDs ────────────────────────────────────────────────────────────────

  router.post('/customers/:customerId/tax-ids', (req: Request, res: Response) => {
    void handle(res, () => options.service!.createTaxId(req.params.customerId, req.body ?? {}), 201);
  });

  router.get('/customers/:customerId/tax-ids', (req: Request, res: Response) => {
    void handle(res, () => options.service!.listTaxIds(req.params.customerId));
  });

  router.delete('/customers/:customerId/tax-ids/:taxId', (req: Request, res: Response) => {
    void handle(res, () => options.service!.deleteTaxId(req.params.customerId, req.params.taxId));
  });

  // ── Payment methods ────────────────────────────────────────────────────────

  router.get('/customers/:customerId/payment-methods', (req: Request, res: Response) => {
    void handle(res, () =>
      options.service!.listPaymentMethods(
        req.params.customerId,
        req.query['type'] === 'us_bank_account' ? 'us_bank_account' : 'card',
      ),
    );
  });

  router.post('/customers/:customerId/payment-methods/attach', (req: Request, res: Response) => {
    void handle(res, () =>
      options.service!.attachPaymentMethod(req.params.customerId, req.body?.paymentMethodId),
    );
  });

  // ── Webhook ────────────────────────────────────────────────────────────────

  /**
   * Verifies `Stripe-Signature` before the event reaches the handler.
   *
   * The route is mounted with `express.raw` and a wildcard `type` option so the
   * bytes are untouched, and the payload is decoded only *after* the signature
   * passes.
   */
  router.post('/webhook', (req: Request, res: Response) => {
    if (!options.verifier) {
      res.status(503).json({
        success: false,
        error: 'Stripe webhook secret is not configured; set STRIPE_WEBHOOK_SECRET',
      });
      return;
    }

    const parsed = parseJsonBody(req);
    if (!parsed.ok) {
      res.status(400).json({ success: false, error: 'Malformed JSON body' });
      return;
    }

    const verification = options.verifier.verify(
      getRawRequestBody(req),
      readStripeSignatureHeader(req.headers as Record<string, string | string[] | undefined>),
      (parsed.value ?? null) as StripeEventShape | null,
    );

    if (!verification.ok) {
      res.status(401).json({ success: false, error: verification.message, reason: verification.reason });
      return;
    }

    // A redelivery of an event already applied: 200 so Stripe stops retrying.
    if (!verification.fresh) {
      res.status(200).json({ success: true, duplicate: true, eventId: verification.eventId });
      return;
    }

    if (!ACTIONABLE_EVENTS.has(verification.eventType)) {
      res.status(200).json({ success: true, ignored: true, eventType: verification.eventType });
      return;
    }

    if (!options.onEvent) {
      res.status(200).json({ success: true, eventType: verification.eventType });
      return;
    }

    void Promise.resolve(
      options.onEvent({
        eventId: verification.eventId,
        eventType: verification.eventType,
        event: verification.event,
      }),
    )
      .then((handled) => {
        // 500 tells Stripe to redeliver, which is what a failed apply needs.
        res.status(handled ? 200 : 500).json({
          success: handled,
          eventType: verification.eventType,
          eventId: verification.eventId,
        });
      })
      .catch(() => {
        res.status(500).json({ success: false, error: 'Failed to apply Stripe event' });
      });
  });

  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      configured: Boolean(options.service),
      webhooksConfigured: Boolean(options.verifier),
      apiVersion: options.service?.getClient().getApiVersion() ?? null,
    });
  });

  return router;
}
