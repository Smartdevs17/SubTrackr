/**
 * EventCatalogRegistry — Comprehensive webhook event catalog (30+ events)
 * covering the full subscription lifecycle with typed payloads, versioning,
 * and deprecation support.
 */

export interface EventDefinition {
  type: string;
  version: number;
  description: string;
  category: EventCategory;
  deprecated?: boolean;
  deprecatedAt?: string;
  sunsetAt?: string;
  replacedBy?: string;
  payloadSchema: Record<string, SchemaField>;
}

export interface SchemaField {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description: string;
  example?: unknown;
}

export type EventCategory =
  | 'subscription'
  | 'payment'
  | 'invoice'
  | 'trial'
  | 'usage'
  | 'plan';

const basePayloadSchema: Record<string, SchemaField> = {
  id: { type: 'string', required: true, description: 'Unique event ID', example: 'evt_abc123' },
  type: { type: 'string', required: true, description: 'Event type', example: 'subscription.created' },
  version: { type: 'number', required: true, description: 'Schema version', example: 1 },
  occurredAt: { type: 'number', required: true, description: 'Unix timestamp (ms)', example: 1719100000000 },
  idempotencyKey: { type: 'string', required: true, description: 'Idempotency key for deduplication' },
  merchantId: { type: 'string', required: true, description: 'Merchant identifier' },
};

const subscriptionDataSchema: Record<string, SchemaField> = {
  subscriptionId: { type: 'string', required: true, description: 'Subscription ID' },
  planId: { type: 'string', required: true, description: 'Plan ID' },
  subscriberId: { type: 'string', required: true, description: 'Subscriber address/ID' },
  status: { type: 'string', required: true, description: 'Current status' },
  previousStatus: { type: 'string', required: false, description: 'Previous status (for transitions)' },
};

function defineEvent(
  type: string,
  description: string,
  category: EventCategory,
  extraFields: Record<string, SchemaField> = {},
  opts: Partial<Pick<EventDefinition, 'deprecated' | 'deprecatedAt' | 'sunsetAt' | 'replacedBy'>> = {},
): EventDefinition {
  return {
    type,
    version: 1,
    description,
    category,
    ...opts,
    payloadSchema: { ...basePayloadSchema, ...subscriptionDataSchema, ...extraFields },
  };
}

const amountField: SchemaField = { type: 'number', required: true, description: 'Amount in smallest unit' };
const currencyField: SchemaField = { type: 'string', required: true, description: 'Token/currency symbol' };
const reasonField: SchemaField = { type: 'string', required: false, description: 'Reason for the action' };

export const EVENT_CATALOG: EventDefinition[] = [
  // ── Subscription events ──────────────────────────────────────────────────
  defineEvent('subscription.created', 'New subscription created', 'subscription'),
  defineEvent('subscription.updated', 'Subscription details updated', 'subscription'),
  defineEvent('subscription.cancelled', 'Subscription cancelled', 'subscription', { reason: reasonField, cancelledAt: { type: 'number', required: true, description: 'Cancellation timestamp' } }),
  defineEvent('subscription.paused', 'Subscription paused', 'subscription', { pausedAt: { type: 'number', required: true, description: 'Pause timestamp' } }),
  defineEvent('subscription.resumed', 'Subscription resumed from pause', 'subscription', { resumedAt: { type: 'number', required: true, description: 'Resume timestamp' } }),
  defineEvent('subscription.expired', 'Subscription reached end date', 'subscription'),
  defineEvent('subscription.renewed', 'Subscription auto-renewed', 'subscription', { amount: amountField, currency: currencyField }),
  defineEvent('subscription.upgraded', 'Plan upgrade completed', 'subscription', { oldPlanId: { type: 'string', required: true, description: 'Previous plan' }, newPlanId: { type: 'string', required: true, description: 'New plan' } }),
  defineEvent('subscription.downgraded', 'Plan downgrade completed', 'subscription', { oldPlanId: { type: 'string', required: true, description: 'Previous plan' }, newPlanId: { type: 'string', required: true, description: 'New plan' } }),
  defineEvent('subscription.transfer_requested', 'Ownership transfer requested', 'subscription'),
  defineEvent('subscription.transfer_completed', 'Ownership transfer completed', 'subscription'),
  defineEvent('subscription.grace_period_started', 'Grace period after failed payment', 'subscription'),
  defineEvent('subscription.grace_period_ended', 'Grace period expired', 'subscription'),

  // ── Payment events ───────────────────────────────────────────────────────
  defineEvent('payment.succeeded', 'Payment processed successfully', 'payment', { amount: amountField, currency: currencyField, transactionHash: { type: 'string', required: false, description: 'On-chain tx hash' } }),
  defineEvent('payment.failed', 'Payment attempt failed', 'payment', { amount: amountField, currency: currencyField, errorCode: { type: 'string', required: false, description: 'Error code' } }),
  defineEvent('payment.refunded', 'Payment refunded', 'payment', { amount: amountField, currency: currencyField, refundReason: reasonField }),
  defineEvent('payment.disputed', 'Payment disputed by subscriber', 'payment', { amount: amountField, currency: currencyField }),
  defineEvent('payment.chargeback', 'Chargeback initiated', 'payment', { amount: amountField, currency: currencyField }),
  defineEvent('payment.method_updated', 'Payment method changed', 'payment'),
  defineEvent('payment.retry_scheduled', 'Failed payment retry scheduled', 'payment', { retryAt: { type: 'number', required: true, description: 'Retry timestamp' }, attemptNumber: { type: 'number', required: true, description: 'Attempt count' } }),

  // ── Invoice events ───────────────────────────────────────────────────────
  defineEvent('invoice.created', 'Invoice generated', 'invoice', { invoiceId: { type: 'string', required: true, description: 'Invoice ID' }, amount: amountField }),
  defineEvent('invoice.finalized', 'Invoice finalized and ready for payment', 'invoice', { invoiceId: { type: 'string', required: true, description: 'Invoice ID' } }),
  defineEvent('invoice.paid', 'Invoice paid', 'invoice', { invoiceId: { type: 'string', required: true, description: 'Invoice ID' }, amount: amountField }),
  defineEvent('invoice.voided', 'Invoice voided', 'invoice', { invoiceId: { type: 'string', required: true, description: 'Invoice ID' }, reason: reasonField }),
  defineEvent('invoice.overdue', 'Invoice past due', 'invoice', { invoiceId: { type: 'string', required: true, description: 'Invoice ID' }, daysOverdue: { type: 'number', required: true, description: 'Days overdue' } }),

  // ── Trial events ─────────────────────────────────────────────────────────
  defineEvent('trial.started', 'Trial period started', 'trial', { trialEndsAt: { type: 'number', required: true, description: 'Trial end timestamp' } }),
  defineEvent('trial.ending_soon', 'Trial ending within 3 days', 'trial', { trialEndsAt: { type: 'number', required: true, description: 'Trial end timestamp' }, daysRemaining: { type: 'number', required: true, description: 'Days left' } }),
  defineEvent('trial.ended', 'Trial period ended', 'trial', { converted: { type: 'boolean', required: true, description: 'Whether trial converted to paid' } }),
  defineEvent('trial.converted', 'Trial converted to paid subscription', 'trial'),

  // ── Usage events ─────────────────────────────────────────────────────────
  defineEvent('usage.threshold_reached', 'Usage threshold reached', 'usage', { metric: { type: 'string', required: true, description: 'Usage metric name' }, currentUsage: { type: 'number', required: true, description: 'Current value' }, threshold: { type: 'number', required: true, description: 'Threshold value' } }),
  defineEvent('usage.limit_exceeded', 'Usage limit exceeded', 'usage', { metric: { type: 'string', required: true, description: 'Usage metric name' }, currentUsage: { type: 'number', required: true, description: 'Current value' }, limit: { type: 'number', required: true, description: 'Limit value' } }),
  defineEvent('usage.recorded', 'Usage data point recorded', 'usage', { metric: { type: 'string', required: true, description: 'Usage metric name' }, value: { type: 'number', required: true, description: 'Recorded value' } }),

  // ── Plan events ──────────────────────────────────────────────────────────
  defineEvent('plan.created', 'New plan created', 'plan', { planName: { type: 'string', required: true, description: 'Plan name' }, price: amountField }),
  defineEvent('plan.updated', 'Plan details updated', 'plan'),
  defineEvent('plan.archived', 'Plan archived (no new subscriptions)', 'plan'),
  defineEvent('plan.price_changed', 'Plan price changed', 'plan', { oldPrice: amountField, newPrice: { type: 'number', required: true, description: 'New price' } }),
];

export class EventCatalogRegistry {
  private events: Map<string, EventDefinition>;

  constructor() {
    this.events = new Map();
    for (const event of EVENT_CATALOG) {
      this.events.set(event.type, event);
    }
  }

  getEvent(type: string): EventDefinition | undefined {
    return this.events.get(type);
  }

  getAllEvents(): EventDefinition[] {
    return Array.from(this.events.values());
  }

  getByCategory(category: EventCategory): EventDefinition[] {
    return this.getAllEvents().filter(e => e.category === category);
  }

  getActiveEvents(): EventDefinition[] {
    return this.getAllEvents().filter(e => !e.deprecated);
  }

  matchesWildcard(pattern: string, eventType: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) {
      return eventType.startsWith(pattern.slice(0, -1));
    }
    return pattern === eventType;
  }

  filterByPatterns(patterns: string[]): EventDefinition[] {
    return this.getAllEvents().filter(e =>
      patterns.some(p => this.matchesWildcard(p, e.type))
    );
  }

  getDeprecationHeaders(type: string): Record<string, string> {
    const event = this.getEvent(type);
    if (!event?.deprecated) return {};
    const headers: Record<string, string> = {};
    if (event.deprecatedAt) headers['Deprecation'] = event.deprecatedAt;
    if (event.sunsetAt) headers['Sunset'] = event.sunsetAt;
    if (event.replacedBy) headers['Link'] = `<${event.replacedBy}>; rel="successor-version"`;
    return headers;
  }
}

export const eventCatalog = new EventCatalogRegistry();
