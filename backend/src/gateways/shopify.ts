/**
 * Shopify webhook HMAC verification with strict timestamp window.
 *
 * Shopify signs every webhook with HMAC-SHA256 using the app secret and
 * includes the raw body hash in `X-Shopify-Hmac-Sha256` (base64-encoded).
 * Additionally, `X-Shopify-Webhook-Id` and `X-Shopify-Triggered-At` are
 * sent with every delivery.
 *
 * This module:
 *   1. Rejects requests older than `TIMESTAMP_TOLERANCE_SECONDS` to prevent
 *      replay attacks (using `X-Shopify-Triggered-At`).
 *   2. Verifies the HMAC in constant time to prevent timing attacks.
 *   3. Exposes an Express middleware (`shopifyWebhookMiddleware`) that
 *      requires the raw body buffer (use `express.raw()` on the route).
 *
 * References:
 *   https://shopify.dev/docs/apps/build/webhooks/secure/validate-webhooks
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Shopify HMAC header (base64 SHA-256 of the raw body). */
export const SHOPIFY_HMAC_HEADER = 'x-shopify-hmac-sha256';
/** Shopify delivery timestamp header (ISO 8601). */
export const SHOPIFY_TRIGGERED_AT_HEADER = 'x-shopify-triggered-at';
/** Shopify unique webhook delivery id. */
export const SHOPIFY_WEBHOOK_ID_HEADER = 'x-shopify-webhook-id';
/** Shopify topic header (e.g. "orders/paid"). */
export const SHOPIFY_TOPIC_HEADER = 'x-shopify-topic';

/** Maximum age of an accepted webhook delivery in seconds (5 minutes). */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShopifyWebhookVerifyOptions {
  /**
   * Maximum allowed age of the delivery in seconds.
   * Defaults to `TIMESTAMP_TOLERANCE_SECONDS` (300 s).
   */
  toleranceSeconds?: number;
  /**
   * Override for "now" (epoch ms) — useful in tests.
   */
  nowMs?: number;
}

export interface ShopifyWebhookVerifyResult {
  valid: boolean;
  error?: string;
  webhookId?: string;
  topic?: string;
  triggeredAt?: Date;
}

// ── Core verification ─────────────────────────────────────────────────────────

/**
 * Verify a Shopify webhook request.
 *
 * @param rawBody   The raw request body buffer (must NOT be JSON.parse()d first).
 * @param headers   The request headers object (lowercased keys).
 * @param secret    The Shopify app's webhook secret.
 * @param opts      Optional tolerance and clock overrides.
 */
export function verifyShopifyWebhook(
  rawBody: Buffer | string,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  opts: ShopifyWebhookVerifyOptions = {},
): ShopifyWebhookVerifyResult {
  const tolerance = opts.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS;
  const nowMs = opts.nowMs ?? Date.now();

  const hmacHeader = getHeader(headers, SHOPIFY_HMAC_HEADER);
  if (!hmacHeader) {
    return { valid: false, error: `Missing ${SHOPIFY_HMAC_HEADER} header` };
  }

  const triggeredAtHeader = getHeader(headers, SHOPIFY_TRIGGERED_AT_HEADER);
  if (!triggeredAtHeader) {
    return { valid: false, error: `Missing ${SHOPIFY_TRIGGERED_AT_HEADER} header` };
  }

  const triggeredAt = new Date(triggeredAtHeader);
  if (isNaN(triggeredAt.getTime())) {
    return { valid: false, error: `Unparseable ${SHOPIFY_TRIGGERED_AT_HEADER} value` };
  }

  const ageSeconds = (nowMs - triggeredAt.getTime()) / 1000;
  if (ageSeconds > tolerance) {
    return {
      valid: false,
      error: `Webhook delivery is too old (${Math.round(ageSeconds)} s > ${tolerance} s tolerance)`,
    };
  }
  if (ageSeconds < -60) {
    // More than 60 s in the future — clock skew guard.
    return { valid: false, error: 'Webhook timestamp is too far in the future' };
  }

  // Compute expected HMAC over raw body.
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  const expectedHmac = crypto.createHmac('sha256', secret).update(payload).digest('base64');

  let receivedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(hmacHeader, 'base64');
    expectedBuf = Buffer.from(expectedHmac, 'base64');
  } catch {
    return { valid: false, error: 'Could not decode HMAC header as base64' };
  }

  if (receivedBuf.length !== expectedBuf.length) {
    return { valid: false, error: 'HMAC length mismatch' };
  }

  if (!crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
    return { valid: false, error: 'HMAC verification failed' };
  }

  return {
    valid: true,
    webhookId: getHeader(headers, SHOPIFY_WEBHOOK_ID_HEADER),
    topic: getHeader(headers, SHOPIFY_TOPIC_HEADER),
    triggeredAt,
  };
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Express middleware that verifies incoming Shopify webhook requests.
 *
 * Requires the route to be mounted with `express.raw({ type: 'application/json' })`
 * so `req.body` is a raw `Buffer`.
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { shopifyWebhookMiddleware } from './backend/src/gateways/shopify';
 *
 * const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET!;
 *
 * router.post(
 *   '/webhooks/shopify',
 *   express.raw({ type: 'application/json' }),
 *   shopifyWebhookMiddleware(webhookSecret),
 *   (req, res) => { ... },
 * );
 * ```
 */
export function shopifyWebhookMiddleware(
  secret: string,
  opts: ShopifyWebhookVerifyOptions = {},
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!secret) {
      res.status(500).json({ error: 'SHOPIFY_WEBHOOK_SECRET is not configured' });
      return;
    }

    const rawBody = req.body as Buffer | undefined;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      res.status(400).json({
        error:
          'Raw body is required for Shopify webhook verification. ' +
          'Mount this route with express.raw({ type: "application/json" }).',
      });
      return;
    }

    const result = verifyShopifyWebhook(
      rawBody,
      req.headers as Record<string, string | string[] | undefined>,
      secret,
      opts,
    );

    if (!result.valid) {
      res.status(401).json({ error: 'Webhook verification failed', details: result.error });
      return;
    }

    // Expose verified metadata on the request for downstream handlers.
    (req as any).shopifyWebhook = {
      webhookId: result.webhookId,
      topic: result.topic,
      triggeredAt: result.triggeredAt,
    };

    next();
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const val = headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0];
  return val;
}
