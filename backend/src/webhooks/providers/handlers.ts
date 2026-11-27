/**
 * backend/src/webhooks/providers/handlers.ts
 *
 * First-class, zero-dependency handler examples for the webhook providers
 * SubTrackr already integrates with: Stripe, PayPal and GitHub (issue #2254).
 *
 * Each handler normalizes a provider payload into a single
 * `NormalizedWebhookEvent` and forwards it to an injected sink. The handlers
 * never perform network I/O, mutate the delivery or throw on malformed
 * payloads — missing fields are simply omitted. This keeps them safe to use
 * behind the JWT-gated dispatcher and trivial to unit test.
 */

import {
  WILDCARD_EVENT,
  type ProviderHandler,
  type ProviderHandlerContext,
  type ProviderKind,
  type NormalizedWebhookEvent,
  type EventSink,
  type WebhookRoute,
} from './types.ts';

const noopSink: EventSink = () => {};

/** Read a plain object from an unknown value, defaulting to `{}`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return {};
}

/** Read a non-empty string, or `undefined` when absent/invalid. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Read a finite number, or `undefined` when absent/invalid. */
function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parse a numeric string (PayPal amounts) into a finite number. */
function asNumericString(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Convert Unix seconds into an ISO-8601 timestamp when valid. */
function fromUnixSeconds(value: unknown): string | undefined {
  const seconds = asNumber(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function baseEvent(
  context: ProviderHandlerContext,
  provider: ProviderKind
): Omit<NormalizedWebhookEvent, 'subject' | 'status' | 'amount' | 'currency' | 'occurredAt'> {
  return {
    provider,
    eventType: context.eventType,
    deliveryId: context.delivery.id,
    raw: context.delivery.payload,
  };
}

/**
 * Build a handler for Stripe events (`charge.succeeded`, `invoice.paid`,
 * `payment_intent.succeeded`, ...). It reads the object under `data.object`.
 */
export function createStripeHandler(sink: EventSink = noopSink): ProviderHandler {
  return function stripeHandler(context: ProviderHandlerContext): void {
    const payload = asRecord(context.delivery.payload);
    const data = asRecord(payload.data);
    const object = asRecord(data.object);
    const amount = asNumber(object.amount_received) ?? asNumber(object.amount);
    sink(
      Object.freeze({
        ...baseEvent(context, 'stripe'),
        subject: asString(object.id),
        status: asString(object.status),
        amount,
        currency: asString(object.currency),
        occurredAt: fromUnixSeconds(object.created),
      })
    );
  };
}

/**
 * Build a handler for PayPal events (`PAYMENT.CAPTURE.COMPLETED`, ...). It
 * reads `resource`, `resource.amount` and `resource.status`.
 */
export function createPaypalHandler(sink: EventSink = noopSink): ProviderHandler {
  return function paypalHandler(context: ProviderHandlerContext): void {
    const payload = asRecord(context.delivery.payload);
    const resource = asRecord(payload.resource);
    const amount = asRecord(resource.amount);
    sink(
      Object.freeze({
        ...baseEvent(context, 'paypal'),
        subject: asString(resource.id) ?? asString(payload.id),
        status: asString(resource.status) ?? asString(payload.event_type),
        amount: asNumericString(amount.value),
        currency: asString(amount.currency_code),
        occurredAt: asString(resource.create_time) ?? asString(payload.create_time),
      })
    );
  };
}

/**
 * Build a handler for GitHub events (`push`, `pull_request`, ...). It reads
 * `repository.full_name`, `sender.login` and the optional `action`.
 */
export function createGithubHandler(sink: EventSink = noopSink): ProviderHandler {
  return function githubHandler(context: ProviderHandlerContext): void {
    const payload = asRecord(context.delivery.payload);
    const repository = asRecord(payload.repository);
    const sender = asRecord(payload.sender);
    const headCommit = asRecord(payload.head_commit);
    const subject = asString(repository.full_name) ?? asString(sender.login);
    sink(
      Object.freeze({
        ...baseEvent(context, 'github'),
        subject,
        status: asString(payload.action),
        occurredAt: asString(headCommit.timestamp) ?? asString(payload.pushed_at),
      })
    );
  };
}

/**
 * Build a complete, frozen route table for all built-in providers using the
 * supplied sink. Exact events are declared first; a provider wildcard route
 * acts as a catch-all for any other event from that provider.
 */
export function createProviderRoutes(sink: EventSink = noopSink): readonly WebhookRoute[] {
  const stripe = createStripeHandler(sink);
  const paypal = createPaypalHandler(sink);
  const github = createGithubHandler(sink);

  const route = (
    provider: ProviderKind,
    eventType: string,
    handler: ProviderHandler
  ): WebhookRoute =>
    Object.freeze({
      provider,
      eventType,
      handler,
      name: `${provider}:${eventType}`,
      description: `Built-in ${provider} handler for ${eventType}`,
      priority: eventType === WILDCARD_EVENT ? -1 : 0,
    });

  return Object.freeze([
    route('stripe', 'charge.succeeded', stripe),
    route('stripe', 'invoice.paid', stripe),
    route('stripe', 'payment_intent.succeeded', stripe),
    route('stripe', WILDCARD_EVENT, stripe),
    route('paypal', 'PAYMENT.CAPTURE.COMPLETED', paypal),
    route('paypal', 'CHECKOUT.ORDER.APPROVED', paypal),
    route('paypal', WILDCARD_EVENT, paypal),
    route('github', 'push', github),
    route('github', 'pull_request', github),
    route('github', WILDCARD_EVENT, github),
  ]);
}

/** Event types with a dedicated built-in route, grouped by provider. */
export const BUILTIN_EVENT_TYPES: Readonly<Record<ProviderKind, readonly string[]>> = Object.freeze({
  stripe: Object.freeze(['charge.succeeded', 'invoice.paid', 'payment_intent.succeeded']),
  paypal: Object.freeze(['PAYMENT.CAPTURE.COMPLETED', 'CHECKOUT.ORDER.APPROVED']),
  github: Object.freeze(['push', 'pull_request']),
});
