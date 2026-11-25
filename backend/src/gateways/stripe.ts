/**
 * backend/src/gateways/stripe.ts
 *
 * Stripe subscription adapter with proration on plan change.
 *
 * Sits beside the generic charge/refund adapter in `billingAdapter.ts` and
 * covers the subscription lifecycle: create, change plan, cancel and fetch.
 *
 *   - `calculateProration` is a pure, integer-only preview of what a mid-cycle
 *     plan change costs (unused credit on the old plan, remaining charge on the
 *     new one). The same `prorationDate` is sent to Stripe, so the preview and
 *     the invoice Stripe generates agree.
 *   - Every mutating call carries the caller's idempotency key and is retried
 *     (429/5xx/transport errors) with the SAME key, so a retry can never
 *     double-apply a plan change.
 *   - Each call emits a telemetry event (duration, outcome, error code).
 */

import {
  BillingAdapterError,
  noopBillingTelemetry,
  withIdempotentRetry,
  type BillingOperation,
  type BillingTelemetry,
  type BillingTransport,
  type BillingTransportResponse,
  type RetryPolicy,
} from './billingAdapter';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StripeProrationBehavior = 'create_prorations' | 'none' | 'always_invoice';

export interface StripePlan {
  priceId: string;
  /** Price per billing period, integer minor units. */
  amountMinor: number;
}

export interface StripeProrationInput {
  currentPlan: StripePlan;
  newPlan: StripePlan;
  /** Current billing period, epoch seconds. */
  periodStart: number;
  periodEnd: number;
  /** Moment of the change, epoch seconds. Must fall inside the period. */
  changeAt: number;
  quantity?: number;
}

export interface StripeProration {
  /** Credit for the unused part of the old plan (>= 0). */
  creditMinor: number;
  /** Charge for the remaining part of the new plan (>= 0). */
  chargeMinor: number;
  /** charge - credit. Negative means the customer is owed a credit. */
  netMinor: number;
  /** Fraction of the period left, as remainingSeconds / totalSeconds. */
  remainingSeconds: number;
  totalSeconds: number;
}

export interface StripeSubscriptionResult {
  subscriptionId: string;
  status: string;
  priceId: string;
  itemId: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

export interface StripeCreateSubscriptionRequest {
  idempotencyKey: string;
  customerId: string;
  priceId: string;
  quantity?: number;
}

export interface StripeChangePlanRequest {
  idempotencyKey: string;
  subscriptionId: string;
  newPriceId: string;
  /** Defaults to `create_prorations`. */
  prorationBehavior?: StripeProrationBehavior;
  /** Epoch seconds the proration is computed at. Defaults to adapter clock. */
  prorationDate?: number;
}

export interface StripeCancelRequest {
  idempotencyKey: string;
  subscriptionId: string;
  atPeriodEnd?: boolean;
}

export interface StripeSubscriptionAdapter {
  createSubscription(request: StripeCreateSubscriptionRequest): Promise<StripeSubscriptionResult>;
  /** Preview the proration without changing anything. */
  previewPlanChange(subscriptionId: string, newPlan: StripePlan, quantity?: number): Promise<StripeProration>;
  changePlan(
    request: StripeChangePlanRequest,
  ): Promise<StripeSubscriptionResult & { proration?: StripeProration }>;
  cancelSubscription(request: StripeCancelRequest): Promise<StripeSubscriptionResult>;
  fetchSubscription(subscriptionId: string): Promise<StripeSubscriptionResult>;
}

export interface StripeSubscriptionAdapterOptions {
  transport: BillingTransport;
  telemetry?: BillingTelemetry;
  retry?: RetryPolicy;
  /** Epoch ms clock. */
  now?: () => number;
}

// ── Proration ─────────────────────────────────────────────────────────────────

/**
 * Time-based proration in integer minor units. Amounts are rounded half-up per
 * leg, so credit and charge are each whole minor units and `net` is exact.
 */
export function calculateProration(input: StripeProrationInput): StripeProration {
  const { currentPlan, newPlan, periodStart, periodEnd, changeAt } = input;
  const quantity = input.quantity ?? 1;
  for (const [label, value] of [
    ['currentPlan.amountMinor', currentPlan.amountMinor],
    ['newPlan.amountMinor', newPlan.amountMinor],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BillingAdapterError('INVALID_REQUEST', 'stripe', `${label} must be a non-negative integer`);
    }
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new BillingAdapterError('INVALID_REQUEST', 'stripe', 'quantity must be a positive integer');
  }
  const totalSeconds = periodEnd - periodStart;
  if (!(totalSeconds > 0)) {
    throw new BillingAdapterError('INVALID_REQUEST', 'stripe', 'periodEnd must be after periodStart');
  }
  if (changeAt < periodStart || changeAt > periodEnd) {
    throw new BillingAdapterError('INVALID_REQUEST', 'stripe', 'changeAt must fall inside the billing period');
  }
  const remainingSeconds = periodEnd - changeAt;
  const prorate = (amountMinor: number) =>
    Math.floor((amountMinor * quantity * remainingSeconds * 2 + totalSeconds) / (totalSeconds * 2));
  const creditMinor = prorate(currentPlan.amountMinor);
  const chargeMinor = prorate(newPlan.amountMinor);
  return { creditMinor, chargeMinor, netMinor: chargeMinor - creditMinor, remainingSeconds, totalSeconds };
}

// ── Response parsing ──────────────────────────────────────────────────────────

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BillingAdapterError('INVALID_RESPONSE', 'stripe', `Stripe response is missing "${label}"`);
  }
  return value;
}

function num(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BillingAdapterError('INVALID_RESPONSE', 'stripe', `Stripe response is missing numeric "${label}"`);
  }
  return value;
}

interface ParsedItem {
  itemId: string;
  priceId: string;
  amountMinor: number;
  quantity: number;
}

function firstItem(body: Record<string, unknown>): ParsedItem {
  const items = (body.items as { data?: Array<Record<string, unknown>> } | undefined)?.data;
  const item = items?.[0];
  if (!item) {
    throw new BillingAdapterError('INVALID_RESPONSE', 'stripe', 'Stripe subscription has no items');
  }
  const price = (item.price ?? {}) as Record<string, unknown>;
  return {
    itemId: str(item.id, 'items.data[0].id'),
    priceId: str(price.id, 'items.data[0].price.id'),
    amountMinor: num(price.unit_amount, 'items.data[0].price.unit_amount'),
    quantity: typeof item.quantity === 'number' ? item.quantity : 1,
  };
}

function parseSubscription(body: Record<string, unknown>): StripeSubscriptionResult {
  const item = firstItem(body);
  return {
    subscriptionId: str(body.id, 'id'),
    status: str(body.status, 'status'),
    priceId: item.priceId,
    itemId: item.itemId,
    currentPeriodStart: num(body.current_period_start, 'current_period_start'),
    currentPeriodEnd: num(body.current_period_end, 'current_period_end'),
    cancelAtPeriodEnd: body.cancel_at_period_end === true,
  };
}

function errorMessage(body: Record<string, unknown>): string {
  const error = body?.error as Record<string, unknown> | string | undefined;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return 'Stripe rejected the request';
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export function createStripeSubscriptionAdapter(
  options: StripeSubscriptionAdapterOptions,
): StripeSubscriptionAdapter {
  const telemetry = options.telemetry ?? noopBillingTelemetry;
  const now = options.now ?? (() => Date.now());

  const send = async (
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> =>
    withIdempotentRetry(async () => {
      let response: BillingTransportResponse;
      try {
        response = await options.transport.request({ method, path, body, idempotencyKey });
      } catch (error) {
        throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'stripe', 'Stripe transport failed', true, error);
      }
      if (response.status >= 200 && response.status < 300) return response.body;
      const message = errorMessage(response.body ?? {});
      if (response.status === 429) throw new BillingAdapterError('RATE_LIMITED', 'stripe', message, true, response);
      if (response.status >= 500) {
        throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'stripe', message, true, response);
      }
      throw new BillingAdapterError(
        response.status === 404 ? 'UNKNOWN' : 'PROVIDER_REJECTED',
        'stripe',
        message,
        false,
        response,
      );
    }, options.retry);

  const observe = async <T>(operation: BillingOperation, fn: () => Promise<T>): Promise<T> => {
    const started = now();
    try {
      const result = await fn();
      telemetry.record({ operation, provider: 'stripe', outcome: 'success', durationMs: now() - started });
      return result;
    } catch (error) {
      telemetry.record({
        operation,
        provider: 'stripe',
        outcome: 'failure',
        durationMs: now() - started,
        errorCode: error instanceof BillingAdapterError ? error.code : 'UNKNOWN',
      });
      throw error;
    }
  };

  const requireKey = (key: string) => {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new BillingAdapterError('INVALID_REQUEST', 'stripe', 'idempotencyKey is required');
    }
  };
  const requireId = (value: string, label: string) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BillingAdapterError('INVALID_REQUEST', 'stripe', `${label} is required`);
    }
  };
  const subPath = (id: string) => `/v1/subscriptions/${encodeURIComponent(id)}`;

  const adapter: StripeSubscriptionAdapter = {
    createSubscription: (request) =>
      observe('charge', async () => {
        requireKey(request.idempotencyKey);
        requireId(request.customerId, 'customerId');
        requireId(request.priceId, 'priceId');
        const body = await send(
          'POST',
          '/v1/subscriptions',
          {
            customer: request.customerId,
            items: [{ price: request.priceId, quantity: request.quantity ?? 1 }],
          },
          request.idempotencyKey,
        );
        return parseSubscription(body);
      }),

    fetchSubscription: (subscriptionId) =>
      observe('fetch', async () => {
        requireId(subscriptionId, 'subscriptionId');
        return parseSubscription(await send('GET', subPath(subscriptionId)));
      }),

    previewPlanChange: (subscriptionId, newPlan, quantity) =>
      observe('fetch', async () => {
        requireId(subscriptionId, 'subscriptionId');
        const body = await send('GET', subPath(subscriptionId));
        const sub = parseSubscription(body);
        const item = firstItem(body);
        return calculateProration({
          currentPlan: { priceId: item.priceId, amountMinor: item.amountMinor },
          newPlan,
          periodStart: sub.currentPeriodStart,
          periodEnd: sub.currentPeriodEnd,
          changeAt: Math.floor(now() / 1000),
          quantity: quantity ?? item.quantity,
        });
      }),

    changePlan: (request) =>
      observe('charge', async () => {
        requireKey(request.idempotencyKey);
        requireId(request.subscriptionId, 'subscriptionId');
        requireId(request.newPriceId, 'newPriceId');
        const current = await send('GET', subPath(request.subscriptionId));
        const item = firstItem(current);
        if (item.priceId === request.newPriceId) {
          throw new BillingAdapterError('INVALID_REQUEST', 'stripe', 'Subscription is already on that price');
        }
        const behavior = request.prorationBehavior ?? 'create_prorations';
        const prorationDate = request.prorationDate ?? Math.floor(now() / 1000);
        const updated = await send(
          'POST',
          subPath(request.subscriptionId),
          {
            items: [{ id: item.itemId, price: request.newPriceId }],
            proration_behavior: behavior,
            proration_date: prorationDate,
          },
          request.idempotencyKey,
        );
        const result = parseSubscription(updated);
        if (behavior === 'none') return result;
        const newItem = firstItem(updated);
        return {
          ...result,
          proration: calculateProration({
            currentPlan: { priceId: item.priceId, amountMinor: item.amountMinor },
            newPlan: { priceId: newItem.priceId, amountMinor: newItem.amountMinor },
            periodStart: result.currentPeriodStart,
            periodEnd: result.currentPeriodEnd,
            changeAt: Math.min(Math.max(prorationDate, result.currentPeriodStart), result.currentPeriodEnd),
            quantity: item.quantity,
          }),
        };
      }),

    cancelSubscription: (request) =>
      observe('cancel', async () => {
        requireKey(request.idempotencyKey);
        requireId(request.subscriptionId, 'subscriptionId');
        const body = request.atPeriodEnd
          ? await send('POST', subPath(request.subscriptionId), { cancel_at_period_end: true }, request.idempotencyKey)
          : await send('POST', `${subPath(request.subscriptionId)}/cancel`, {}, request.idempotencyKey);
        return parseSubscription(body);
      }),
  };
  return adapter;
}
