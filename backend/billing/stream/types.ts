/**
 * Billing Stream Processing — Types
 *
 * Extends the core BillingEvent union (from shared/events.ts) with additional
 * stream-specific event types for charge lifecycle operations:
 *   billing.charge_attempted    – a charge was attempted against a subscriber
 *   billing.charge_failed       – a charge attempt failed (non-retriable or exhausted)
 *   billing.charge_retried      – a failed charge is being retried
 *   billing.subscription_cancelled_billing – subscription cancelled due to billing failure
 *
 * These types are designed to slot into the existing DomainEvent shape so they
 * work transparently with the existing EventBus, EventStore, and SpyEventBus.
 */

import type {
  DomainEvent,
  BillingEvent,
  InvoiceGeneratedPayload,
  PaymentCapturedPayload,
  UsageThresholdReachedPayload,
  ChargebackRaisedPayload,
} from '../../services/shared/events';

// ---------------------------------------------------------------------------
// New payload types for stream-specific billing events
// ---------------------------------------------------------------------------

export interface ChargeAttemptedPayload extends Record<string, unknown> {
  chargeId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  attemptNumber: number;
  attemptedAt: number;
}

export interface ChargeFailedPayload extends Record<string, unknown> {
  chargeId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  attemptNumber: number;
  failureCode: string;
  failureReason: string;
  retriable: boolean;
  failedAt: number;
}

export interface ChargeRetriedPayload extends Record<string, unknown> {
  chargeId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  attemptNumber: number;
  previousAttemptAt: number;
  retriedAt: number;
  nextRetryAt?: number;
}

export interface SubscriptionCancelledBillingPayload extends Record<string, unknown> {
  subscriptionId: string;
  userId: string;
  reason: string;
  lastChargeId?: string;
  totalFailedAttempts: number;
  cancelledAt: number;
}

// ---------------------------------------------------------------------------
// New stream-specific billing DomainEvent types
// ---------------------------------------------------------------------------

export type ChargeAttemptedEvent = DomainEvent<
  'billing',
  'charge_attempted',
  ChargeAttemptedPayload
>;

export type ChargeFailedEvent = DomainEvent<'billing', 'charge_failed', ChargeFailedPayload>;

export type ChargeRetriedEvent = DomainEvent<'billing', 'charge_retried', ChargeRetriedPayload>;

export type SubscriptionCancelledBillingEvent = DomainEvent<
  'billing',
  'subscription_cancelled_billing',
  SubscriptionCancelledBillingPayload
>;

/**
 * All billing stream events, including the core BillingEvent types and the
 * new stream-specific ones.
 */
export type BillingStreamEvent =
  | BillingEvent
  | ChargeAttemptedEvent
  | ChargeFailedEvent
  | ChargeRetriedEvent
  | SubscriptionCancelledBillingEvent;

export type BillingStreamEventName = BillingStreamEvent['name'];

// ---------------------------------------------------------------------------
// Consumer interface
// ---------------------------------------------------------------------------

/**
 * A BillingStreamConsumer receives batches of billing stream events and
 * processes them asynchronously.  Implementations should be idempotent —
 * the stream may deliver the same event more than once in error-recovery
 * scenarios.
 */
export interface BillingStreamConsumer {
  /** Human-readable label used in logs and metrics. */
  readonly name: string;

  /**
   * Process a batch of events.
   * Throw to signal a recoverable error — the stream will log and continue.
   */
  handleBatch(events: BillingStreamEvent[]): Promise<void>;

  /**
   * Optional hook called when the stream is paused.
   * Implementations can flush pending work here.
   */
  onPause?(): Promise<void>;

  /**
   * Optional hook called when the stream is resumed after a pause.
   */
  onResume?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stream configuration
// ---------------------------------------------------------------------------

/** Configuration options for BillingEventStream. */
export interface BillingEventStreamConfig {
  /**
   * Maximum number of events to buffer before dispatching to consumers.
   * Defaults to 50.
   */
  batchSize?: number;

  /**
   * Maximum time (ms) to wait before flushing a non-full batch.
   * Defaults to 5 000 ms.
   */
  flushIntervalMs?: number;

  /**
   * Whether to pass all billing event names to the event bus, including new
   * stream-specific ones.  Defaults to true.
   */
  includeStreamEvents?: boolean;
}

// ---------------------------------------------------------------------------
// Stream metrics
// ---------------------------------------------------------------------------

export interface BillingStreamMetrics {
  /** Total number of events received from the bus. */
  received: number;
  /** Total number of events dispatched to consumers. */
  dispatched: number;
  /** Total consumer handler errors. */
  errors: number;
  /** Number of times the stream was paused. */
  pauses: number;
  /** Number of events currently buffered. */
  bufferDepth: number;
  /** Whether the stream is currently paused. */
  paused: boolean;
}

// ---------------------------------------------------------------------------
// Re-export core payload types for convenience
// ---------------------------------------------------------------------------

export type {
  InvoiceGeneratedPayload,
  PaymentCapturedPayload,
  UsageThresholdReachedPayload,
  ChargebackRaisedPayload,
};
