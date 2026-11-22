/**
 * BillingStreamProducer — Produces Billing Stream Events
 *
 * Wraps the existing BillingEventPublisher and adds charge lifecycle methods
 * for the new stream-specific event types:
 *   - publishChargeAttempted
 *   - publishChargeFailed
 *   - publishChargeRetried
 *   - publishSubscriptionCancelledBilling
 *
 * Existing billing publish methods (invoice generated, payment captured, etc.)
 * are delegated to the underlying BillingEventPublisher so this class can be
 * used as a drop-in replacement.
 */

import {
  buildEvent,
  type IEventBus,
  type EventSourcedStore,
  type AnyDomainEvent,
} from '../../services/shared/events';
import { eventBus, eventStore } from '../../services/shared/events';
import {
  BillingEventPublisher,
  type InvoiceGenerationInput,
  type PaymentCaptureInput,
  type ChargebackInput,
  type UsageThresholdInput,
} from '../../services/eventBusIntegration';
import type {
  ChargeAttemptedPayload,
  ChargeFailedPayload,
  ChargeRetriedPayload,
  SubscriptionCancelledBillingPayload,
} from './types';

// ---------------------------------------------------------------------------
// Input types for new stream events
// ---------------------------------------------------------------------------

export interface ChargeAttemptedInput {
  chargeId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  attemptNumber: number;
  attemptedAt?: number;
}

export interface ChargeFailedInput {
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
  failedAt?: number;
}

export interface ChargeRetriedInput {
  chargeId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  gateway: string;
  attemptNumber: number;
  previousAttemptAt: number;
  retriedAt?: number;
  nextRetryAt?: number;
}

export interface SubscriptionCancelledBillingInput {
  subscriptionId: string;
  userId: string;
  reason: string;
  lastChargeId?: string;
  totalFailedAttempts: number;
  cancelledAt?: number;
}

// ---------------------------------------------------------------------------
// BillingStreamProducer
// ---------------------------------------------------------------------------

export class BillingStreamProducer {
  private readonly publisher: BillingEventPublisher;

  constructor(
    private readonly bus: IEventBus = eventBus,
    private readonly store: EventSourcedStore = eventStore,
  ) {
    this.publisher = new BillingEventPublisher(bus, store);
  }

  // ---------------------------------------------------------------------------
  // Delegated existing billing events
  // ---------------------------------------------------------------------------

  async publishInvoiceGenerated(input: InvoiceGenerationInput): Promise<void> {
    return this.publisher.publishInvoiceGenerated(input);
  }

  async publishPaymentCaptured(input: PaymentCaptureInput): Promise<void> {
    return this.publisher.publishPaymentCaptured(input);
  }

  async publishChargebackRaised(input: ChargebackInput): Promise<void> {
    return this.publisher.publishChargebackRaised(input);
  }

  async publishUsageThresholdReached(input: UsageThresholdInput): Promise<void> {
    return this.publisher.publishUsageThresholdReached(input);
  }

  // ---------------------------------------------------------------------------
  // New charge lifecycle events
  // ---------------------------------------------------------------------------

  /**
   * Emit a `billing.charge_attempted` event.
   * Call this when a charge request is dispatched to the payment gateway.
   */
  async publishChargeAttempted(input: ChargeAttemptedInput): Promise<void> {
    const payload: ChargeAttemptedPayload = {
      ...input,
      attemptedAt: input.attemptedAt ?? Date.now(),
    };
    const event = buildEvent('billing', 'charge_attempted', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.chargeId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  /**
   * Emit a `billing.charge_failed` event.
   * Call this when a gateway response indicates the charge could not be completed.
   */
  async publishChargeFailed(input: ChargeFailedInput): Promise<void> {
    const payload: ChargeFailedPayload = {
      ...input,
      failedAt: input.failedAt ?? Date.now(),
    };
    const event = buildEvent('billing', 'charge_failed', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.chargeId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  /**
   * Emit a `billing.charge_retried` event.
   * Call this when a retry is scheduled or executed for a previously failed charge.
   */
  async publishChargeRetried(input: ChargeRetriedInput): Promise<void> {
    const payload: ChargeRetriedPayload = {
      ...input,
      retriedAt: input.retriedAt ?? Date.now(),
    };
    const event = buildEvent('billing', 'charge_retried', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.chargeId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  /**
   * Emit a `billing.subscription_cancelled_billing` event.
   * Call this when a subscription is cancelled due to persistent billing failure.
   */
  async publishSubscriptionCancelledBilling(
    input: SubscriptionCancelledBillingInput,
  ): Promise<void> {
    const payload: SubscriptionCancelledBillingPayload = {
      ...input,
      cancelledAt: input.cancelledAt ?? Date.now(),
    };
    const event = buildEvent('billing', 'subscription_cancelled_billing', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }
}

// ---------------------------------------------------------------------------
// Singleton producer
// ---------------------------------------------------------------------------

export const billingStreamProducer = new BillingStreamProducer();
