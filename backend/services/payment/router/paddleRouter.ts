/**
 * Paddle Billing Router (issue #1240).
 *
 * Mounts the Paddle endpoints under `/api/v1/paddle` by `createApiServer`:
 *
 *   POST /paddle/checkout  — open a Paddle transaction for a catalog price
 *   POST /paddle/webhook   — verify a Paddle notification and dispatch it
 *   GET  /paddle/status    — whether Paddle is configured for this deployment
 *
 * The webhook route needs the **raw** body: Paddle signs the exact bytes it
 * sent, so it is mounted with `express.raw` and a wildcard `type` option before
 * `express.json()` in `createApiServer`, and the payload is decoded only after
 * the signature verifies.
 */

import { Router, type Request, type Response } from 'express';
import {
  getRawRequestBody,
  parseJsonBody,
} from '../../../shared/webhook/webhookVerificationMiddleware';
import { PaddleAdapter } from '../domain/gateways/PaddleAdapter';
import {
  PaddleWebhookVerifier,
  readPaddleSignatureHeader,
  type PaddleWebhookEvent,
} from '../domain/paddle/PaddleWebhookVerifier';
import type { PaymentRequest } from '../interfaces';

export interface PaddleRouterOptions {
  adapter: PaddleAdapter | null;
  verifier: PaddleWebhookVerifier | null;
  /**
   * Handles a verified notification. Return `true` once the event has been
   * applied; returning `false` makes the route answer 500 so Paddle retries.
   */
  onEvent?: (event: { eventType: string; eventId: string; data: unknown }) => boolean | Promise<boolean>;
}

const SUBSCRIPTION_EVENTS = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.trialing',
  'subscription.paused',
  'subscription.resumed',
]);

/** Paddle notifications SubTrackr acts on; anything else is acknowledged only. */
const ACTIONABLE_EVENTS = new Set([
  'transaction.completed',
  'transaction.updated',
  ...SUBSCRIPTION_EVENTS,
]);

export function createPaddleRouter(options: PaddleRouterOptions): Router {
  const router = Router();

  // ── Checkout ───────────────────────────────────────────────────────────────

  /**
   * POST /paddle/checkout
   * Body: `{ customerId, priceId, amount, currency, idempotencyKey, paddleCustomerId? }`
   */
  router.post('/checkout', (req: Request, res: Response) => {
    if (!options.adapter) {
      res.status(503).json({ success: false, error: 'Paddle is not configured' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Number(body.amount);
    const currency = typeof body.currency === 'string' ? body.currency : '';
    const customerId = typeof body.customerId === 'string' ? body.customerId : '';
    const priceId = typeof body.priceId === 'string' ? body.priceId : '';
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';

    if (!customerId || !priceId || !idempotencyKey || !currency || !Number.isFinite(amount)) {
      res.status(400).json({
        success: false,
        error: 'customerId, priceId, amount, currency and idempotencyKey are required',
      });
      return;
    }
    if (amount <= 0) {
      res.status(400).json({ success: false, error: 'amount must be greater than zero' });
      return;
    }

    const request: PaymentRequest = {
      amount,
      currency,
      customerId,
      paymentMethodId: typeof body.paymentMethodId === 'string' ? body.paymentMethodId : '',
      idempotencyKey,
      chainType: 'fiat',
      metadata: {
        paddlePriceId: priceId,
        ...(typeof body.paddleCustomerId === 'string'
          ? { paddleCustomerId: body.paddleCustomerId }
          : {}),
      },
    };

    void options.adapter
      .charge(request)
      .then((result) => {
        res.status(result.status === 'failed' ? 402 : 200).json({ success: result.status !== 'failed', result });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Internal error';
        res.status(500).json({ success: false, error: message.replace(/Bearer [A-Za-z0-9._-]+/g, 'Bearer [REDACTED]') });
      });
  });

  // ── Webhook ────────────────────────────────────────────────────────────────

  /**
   * POST /paddle/webhook
   *
   * Verifies the `Paddle-Signature` header before the payload is dispatched.
   * The route is mounted with `express.raw({ type: '*/*' })` so the signed bytes
   * are untouched, and the event is decoded only once the signature passes.
   */
  router.post('/webhook', (req: Request, res: Response) => {
    if (!options.verifier) {
      res.status(503).json({ success: false, error: 'Paddle webhook secret is not configured' });
      return;
    }

    const parsed = parseJsonBody(req);
    if (!parsed.ok) {
      res.status(400).json({ success: false, error: 'Malformed JSON body' });
      return;
    }
    const event = (parsed.value ?? {}) as PaddleWebhookEvent;

    const verification = options.verifier.verify(
      getRawRequestBody(req),
      readPaddleSignatureHeader(req.headers as Record<string, string | string[] | undefined>),
      event,
    );

    if (!verification.ok) {
      res.status(401).json({ success: false, error: verification.message, reason: verification.reason });
      return;
    }

    // A Paddle retry of an already-applied event: acknowledge it so Paddle stops.
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
        eventType: verification.eventType,
        eventId: verification.eventId,
        data: verification.data,
      }),
    )
      .then((handled) => {
        // 500 tells Paddle to redeliver, which is what we want for a failed apply.
        res.status(handled ? 200 : 500).json({
          success: handled,
          eventType: verification.eventType,
          eventId: verification.eventId,
        });
      })
      .catch(() => {
        res.status(500).json({ success: false, error: 'Failed to apply Paddle event' });
      });
  });

  // ── Status ─────────────────────────────────────────────────────────────────

  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      success: true,
      configured: Boolean(options.adapter),
      environment: options.adapter?.getBaseUrl() ?? null,
    });
  });

  return router;
}
