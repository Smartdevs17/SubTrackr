/**
 * workers/src/handlers/index.ts
 *
 * Default lifecycle event handlers for background workers (issue #2258).
 *
 * These handlers are the worker-side counterparts of the event contracts in
 * `backend/src/events/bus.ts`. They are production-shaped but deliberately
 * side-effect-free: instead of calling an email provider or a ledger service,
 * they append intent records to an injected in-memory context. Real adapters
 * can replace those sinks without changing the handler logic or the bus.
 *
 * Design rules:
 *  - Zero new dependencies. No network, no database, no ambient state.
 *  - Every handler is synchronous and deterministic for a given event/context.
 *  - Handler failures are isolated by the bus; handlers here never throw for
 *    well-formed events.
 *  - The same bus instance can be shared by backend publishers and workers.
 *
 * Usage:
 *   const { context } = registerDefaultHandlers(bus);
 *   await bus.publish(subscriptionCreatedEvent);
 *   // context.emailsSent[0].template === 'subscription-welcome'
 */

import {
  DomainEventType,
  type DomainEvent,
  type EventBus,
  type EventSubscription,
  type HouseholdInviteAcceptedEvent,
  type InvoicePaidEvent,
  type PaymentFailedEvent,
  type SubscriptionCancelledEvent,
  type SubscriptionCreatedEvent,
} from '../../../backend/src/events/bus.ts';

// ---------------------------------------------------------------------------
// Handler side-effect records (pure stubs, no external I/O)
// ---------------------------------------------------------------------------

/** An email intent recorded by a handler; a real adapter would send it. */
export interface EmailMessage {
  readonly to: string;
  readonly template: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/** A ledger intent recorded by a handler; a real adapter would persist it. */
export interface LedgerEntry {
  readonly invoiceId: string;
  readonly userId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly kind: 'credit' | 'debit';
}

/** An audit line recorded for every handled lifecycle change. */
export interface AuditLine {
  readonly eventId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly detail: string;
}

/** In-memory sinks collected while handlers run. */
export interface WorkerHandlerContext {
  readonly emailsSent: EmailMessage[];
  readonly ledgerEntries: LedgerEntry[];
  readonly audit: AuditLine[];
}

/** Create an empty, isolated context for one worker run or one unit test. */
export function createHandlerContext(): WorkerHandlerContext {
  return { emailsSent: [], ledgerEntries: [], audit: [] };
}

/** Append an audit line describing a handled event. */
function audit(context: WorkerHandlerContext, event: DomainEvent, detail: string): void {
  context.audit.push({
    eventId: event.id,
    type: event.type,
    aggregateId: event.aggregateId,
    detail,
  });
}

// ---------------------------------------------------------------------------
// Individual handlers
// ---------------------------------------------------------------------------

/**
 * Handle `subscription.created`: queue a welcome email for the new subscriber.
 * No I/O is performed; the message is appended to `context.emailsSent`.
 */
export function handleSubscriptionCreated(
  event: SubscriptionCreatedEvent,
  context: WorkerHandlerContext
): void {
  context.emailsSent.push({
    to: event.payload.email,
    template: 'subscription-welcome',
    data: {
      subscriptionId: event.payload.subscriptionId,
      planId: event.payload.planId,
      userId: event.payload.userId,
      householdId: event.payload.householdId ?? null,
    },
  });
  audit(context, event, `welcome email queued for ${event.payload.email}`);
}

/**
 * Handle `subscription.cancelled`: record the cancellation reason for the
 * retention workflow. A reason is optional and defaults to `unspecified`.
 */
export function handleSubscriptionCancelled(
  event: SubscriptionCancelledEvent,
  context: WorkerHandlerContext
): void {
  const reason = event.payload.reason ?? 'unspecified';
  audit(context, event, `cancellation recorded (${reason})`);
}

/**
 * Handle `invoice.paid`: reconcile the payment into the ledger as a credit.
 * The ledger entry is appended to `context.ledgerEntries` for a real adapter.
 */
export function handleInvoicePaid(
  event: InvoicePaidEvent,
  context: WorkerHandlerContext
): void {
  context.ledgerEntries.push({
    invoiceId: event.payload.invoiceId,
    userId: event.payload.userId,
    amountCents: event.payload.amountCents,
    currency: event.payload.currency,
    kind: 'credit',
  });
  audit(context, event, `ledger credit for ${event.payload.invoiceId}`);
}

/**
 * Handle `household.invite.accepted`: audit that the invitee joined the
 * household and which member invited them.
 */
export function handleHouseholdInviteAccepted(
  event: HouseholdInviteAcceptedEvent,
  context: WorkerHandlerContext
): void {
  audit(
    context,
    event,
    `${event.payload.userId} joined ${event.payload.householdId} via ${event.payload.invitedByUserId}`
  );
}

/**
 * Handle `payment.failed`: audit the failed attempt so the dunning workflow
 * can pick it up. The reason is preserved verbatim.
 */
export function handlePaymentFailed(
  event: PaymentFailedEvent,
  context: WorkerHandlerContext
): void {
  audit(context, event, `payment ${event.payload.paymentId} failed: ${event.payload.reason}`);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Result of {@link registerDefaultHandlers}. */
export interface DefaultHandlers {
  /** The context all default handlers write into. */
  readonly context: WorkerHandlerContext;
  /** The five subscriptions, in registration order. */
  readonly registrations: readonly EventSubscription[];
}

/**
 * Register one handler for every supported lifecycle event type on `bus`.
 *
 * @param bus The shared event bus used by backend publishers and workers.
 * @param context Optional sink context; a fresh one is created by default.
 */
export function registerDefaultHandlers(
  bus: EventBus,
  context: WorkerHandlerContext = createHandlerContext()
): DefaultHandlers {
  const registrations: EventSubscription[] = [
    bus.subscribe(DomainEventType.SUBSCRIPTION_CREATED, (event: SubscriptionCreatedEvent) =>
      handleSubscriptionCreated(event, context)
    ),
    bus.subscribe(DomainEventType.SUBSCRIPTION_CANCELLED, (event: SubscriptionCancelledEvent) =>
      handleSubscriptionCancelled(event, context)
    ),
    bus.subscribe(DomainEventType.INVOICE_PAID, (event: InvoicePaidEvent) =>
      handleInvoicePaid(event, context)
    ),
    bus.subscribe(DomainEventType.HOUSEHOLD_INVITE_ACCEPTED, (event: HouseholdInviteAcceptedEvent) =>
      handleHouseholdInviteAccepted(event, context)
    ),
    bus.subscribe(DomainEventType.PAYMENT_FAILED, (event: PaymentFailedEvent) =>
      handlePaymentFailed(event, context)
    ),
  ];
  return { context, registrations: Object.freeze(registrations) };
}
