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
 * The second half of the module is the Shopify App Subscription billing
 * adapter (`createShopifyBillingAdapter`) with idempotent retries.
 *
 * References:
 *   https://shopify.dev/docs/apps/build/webhooks/secure/validate-webhooks
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  BillingAdapterError,
  noopBillingTelemetry,
  withIdempotentRetry,
  type BillingMoney,
  type BillingOperation,
  type BillingTelemetry,
  type RetryPolicy,
} from './billingAdapter';

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

// ── Billing adapter (Shopify App Subscriptions, Admin GraphQL API) ────────────
//
// Shopify's appSubscriptionCreate has no server-side idempotency header, so
// idempotency is enforced here: one in-flight/settled result per caller key,
// shared across concurrent callers and across retries. Throttling (HTTP 429,
// THROTTLED GraphQL errors) and 5xx are retried with backoff using the same key.

/** Narrow GraphQL transport. Inject the Admin API client. */
export interface ShopifyGraphqlTransport {
  query(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
}

export type ShopifyInterval = 'EVERY_30_DAYS' | 'ANNUAL';

export interface ShopifyCreateSubscriptionRequest {
  idempotencyKey: string;
  name: string;
  returnUrl: string;
  /** Integer minor units; converted to the decimal string Shopify expects. */
  price: BillingMoney;
  interval?: ShopifyInterval;
  trialDays?: number;
  /** Creates a test charge that is never billed. */
  test?: boolean;
}

export interface ShopifySubscriptionResult {
  subscriptionId: string;
  status: string;
  /** Merchant must open this URL to approve the charge. Absent on cancel/fetch. */
  confirmationUrl?: string;
}

export interface ShopifyBillingAdapter {
  createSubscription(request: ShopifyCreateSubscriptionRequest): Promise<ShopifySubscriptionResult>;
  cancelSubscription(request: { idempotencyKey: string; subscriptionId: string }): Promise<ShopifySubscriptionResult>;
  fetchSubscription(subscriptionId: string): Promise<ShopifySubscriptionResult>;
}

export interface ShopifyBillingAdapterOptions {
  transport: ShopifyGraphqlTransport;
  telemetry?: BillingTelemetry;
  retry?: RetryPolicy;
  now?: () => number;
}

const CREATE_MUTATION = `mutation($name: String!, $returnUrl: URL!, $trialDays: Int, $test: Boolean, $lineItems: [AppSubscriptionLineItemInput!]!) {
  appSubscriptionCreate(name: $name, returnUrl: $returnUrl, trialDays: $trialDays, test: $test, lineItems: $lineItems) {
    appSubscription { id status }
    confirmationUrl
    userErrors { field message }
  }
}`;
const CANCEL_MUTATION = `mutation($id: ID!) {
  appSubscriptionCancel(id: $id) {
    appSubscription { id status }
    userErrors { field message }
  }
}`;
const FETCH_QUERY = `query($id: ID!) { node(id: $id) { ... on AppSubscription { id status } } }`;

/** Integer minor units → "19.99" without floating-point arithmetic. */
export function minorToDecimalString(amountMinor: number): string {
  const whole = Math.trunc(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, '0');
  return `${whole}.${cents}`;
}

export function createShopifyBillingAdapter(options: ShopifyBillingAdapterOptions): ShopifyBillingAdapter {
  const telemetry = options.telemetry ?? noopBillingTelemetry;
  const now = options.now ?? (() => Date.now());
  const settled = new Map<string, Promise<unknown>>();

  const reject = (code: 'INVALID_REQUEST' | 'INVALID_RESPONSE', message: string) =>
    new BillingAdapterError(code, 'shopify', message);

  const run = async (
    query: string,
    variables: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    withIdempotentRetry(async () => {
      let response: { status: number; body: Record<string, unknown> };
      try {
        response = await options.transport.query(query, variables);
      } catch (error) {
        throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'shopify', 'Shopify transport failed', true, error);
      }
      const errors = response.body?.errors as Array<{ message?: string; extensions?: { code?: string } }> | undefined;
      const throttled = response.status === 429 || errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) throw new BillingAdapterError('RATE_LIMITED', 'shopify', 'Shopify throttled the request', true);
      if (response.status >= 500) {
        throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'shopify', `Shopify returned ${response.status}`, true);
      }
      if (response.status < 200 || response.status >= 300 || (errors && errors.length > 0)) {
        throw new BillingAdapterError(
          'PROVIDER_REJECTED',
          'shopify',
          errors?.[0]?.message ?? `Shopify returned ${response.status}`,
        );
      }
      return (response.body.data ?? {}) as Record<string, unknown>;
    }, options.retry);

  const observe = async <T>(operation: BillingOperation, fn: () => Promise<T>): Promise<T> => {
    const started = now();
    try {
      const result = await fn();
      telemetry.record({ operation, provider: 'shopify', outcome: 'success', durationMs: now() - started });
      return result;
    } catch (error) {
      telemetry.record({
        operation,
        provider: 'shopify',
        outcome: 'failure',
        durationMs: now() - started,
        errorCode: error instanceof BillingAdapterError ? error.code : 'UNKNOWN',
      });
      throw error;
    }
  };

  /** Run `fn` at most once per key; concurrent and later callers share the result. */
  const once = <T>(scope: string, key: string, fn: () => Promise<T>): Promise<T> => {
    if (typeof key !== 'string' || key.trim() === '') {
      return Promise.reject(reject('INVALID_REQUEST', 'idempotencyKey is required'));
    }
    const id = `${scope}:${key}`;
    const existing = settled.get(id);
    if (existing) return existing as Promise<T>;
    const promise = fn().catch((error) => {
      settled.delete(id); // failures are not cached: the caller may retry the same key
      throw error;
    });
    settled.set(id, promise);
    return promise;
  };

  const parse = (node: unknown, confirmationUrl?: unknown): ShopifySubscriptionResult => {
    const sub = node as { id?: unknown; status?: unknown } | null;
    if (!sub || typeof sub.id !== 'string' || typeof sub.status !== 'string') {
      throw reject('INVALID_RESPONSE', 'Shopify response is missing the app subscription');
    }
    return {
      subscriptionId: sub.id,
      status: sub.status,
      ...(typeof confirmationUrl === 'string' ? { confirmationUrl } : {}),
    };
  };

  const userErrors = (payload: Record<string, unknown> | undefined): void => {
    const list = payload?.userErrors as Array<{ message?: string }> | undefined;
    if (list && list.length > 0) {
      throw new BillingAdapterError(
        'PROVIDER_REJECTED',
        'shopify',
        list.map((e) => e.message ?? 'Unknown error').join('; '),
      );
    }
  };

  return {
    createSubscription: (request) =>
      once('create', request.idempotencyKey, () =>
        observe('charge', async () => {
          if (!request.name || !request.returnUrl) {
            throw reject('INVALID_REQUEST', 'name and returnUrl are required');
          }
          if (!Number.isSafeInteger(request.price.amountMinor) || request.price.amountMinor <= 0) {
            throw reject('INVALID_REQUEST', 'price.amountMinor must be a positive integer');
          }
          if (!/^[A-Z]{3}$/.test(request.price.currency)) {
            throw reject('INVALID_REQUEST', 'price.currency must be a three-letter upper-case ISO code');
          }
          const data = await run(CREATE_MUTATION, {
            name: request.name,
            returnUrl: request.returnUrl,
            trialDays: request.trialDays,
            test: request.test ?? false,
            lineItems: [
              {
                plan: {
                  appRecurringPricingDetails: {
                    interval: request.interval ?? 'EVERY_30_DAYS',
                    price: {
                      amount: minorToDecimalString(request.price.amountMinor),
                      currencyCode: request.price.currency,
                    },
                  },
                },
              },
            ],
          });
          const payload = data.appSubscriptionCreate as Record<string, unknown> | undefined;
          userErrors(payload);
          return parse(payload?.appSubscription, payload?.confirmationUrl);
        }),
      ),

    cancelSubscription: (request) =>
      once('cancel', `${request.idempotencyKey}:${request.subscriptionId}`, () =>
        observe('cancel', async () => {
          if (!request.subscriptionId) throw reject('INVALID_REQUEST', 'subscriptionId is required');
          const data = await run(CANCEL_MUTATION, { id: request.subscriptionId });
          const payload = data.appSubscriptionCancel as Record<string, unknown> | undefined;
          userErrors(payload);
          return parse(payload?.appSubscription);
        }),
      ),

    fetchSubscription: (subscriptionId) =>
      observe('fetch', async () => {
        if (!subscriptionId) throw reject('INVALID_REQUEST', 'subscriptionId is required');
        const data = await run(FETCH_QUERY, { id: subscriptionId });
        return parse(data.node);
      }),
  };
}
