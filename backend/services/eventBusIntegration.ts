/**
 * Event Bus Integration — SubTrackr
 *
 * Issue #984: Refactor event system to use typed event bus with domain events
 *
 * This module wires the backend service layer to the typed EventBus so that
 * every domain operation (subscription lifecycle, billing, analytics) emits
 * a strongly-typed DomainEvent rather than ad-hoc callbacks or raw emitters.
 *
 * Architecture:
 *  - Each domain integration class wraps its underlying service.
 *  - Operations are delegated to the service; on success a DomainEvent is
 *    published to the shared EventBus and appended to the EventStore.
 *  - Downstream consumers (analytics, notifications, audit) subscribe to
 *    specific event names without coupling to service internals.
 *  - The file is the single integration point — services themselves remain
 *    unaware of the bus, keeping them testable in isolation.
 */

import {
  eventBus,
  eventStore,
  buildEvent,
  EventBus,
  InMemoryEventStore,
  EventCollector,
  SpyEventBus,
  type IEventBus,
  type EventSourcedStore,
  type AnyDomainEvent,
  type SubscriptionCreatedPayload,
  type SubscriptionCancelledPayload,
  type SubscriptionRenewedPayload,
  type SubscriptionPausedPayload,
  type SubscriptionResumedPayload,
  type SubscriptionUpgradedPayload,
  type SubscriptionPaymentFailedPayload,
  type InvoiceGeneratedPayload,
  type PaymentCapturedPayload,
  type ChargebackRaisedPayload,
  type UsageThresholdReachedPayload,
  type ChurnRiskUpdatedPayload,
  type MrrChangedPayload,
  type ContractInvokedPayload,
} from './shared/events';

// Re-export for convenience
export {
  EventBus,
  InMemoryEventStore,
  EventCollector,
  SpyEventBus,
  buildEvent,
  eventBus,
  eventStore,
};

// ---------------------------------------------------------------------------
// Types for domain operations
// ---------------------------------------------------------------------------

export interface SubscriptionCreationInput {
  subscriptionId: string;
  userId: string;
  planId: string;
  status: string;
  billingCycle: string;
  nextBillingDate: number;
}

export interface SubscriptionCancellationInput {
  subscriptionId: string;
  userId: string;
  reason?: string;
  cancelledAt: number;
  effectiveAt: number;
}

export interface SubscriptionRenewalInput {
  subscriptionId: string;
  userId: string;
  planId: string;
  renewedAt: number;
  nextBillingDate: number;
  amount: number;
  currency: string;
}

export interface SubscriptionUpgradeInput {
  subscriptionId: string;
  userId: string;
  fromPlanId: string;
  toPlanId: string;
  effectiveAt: number;
  proratedCredit?: number;
}

export interface SubscriptionPauseInput {
  subscriptionId: string;
  userId: string;
  pausedAt: number;
  resumeAt?: number;
}

export interface SubscriptionResumeInput {
  subscriptionId: string;
  userId: string;
  resumedAt: number;
}

export interface PaymentFailureInput {
  subscriptionId: string;
  userId: string;
  attemptNumber: number;
  nextRetryAt?: number;
  reason: string;
}

export interface InvoiceGenerationInput {
  invoiceId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  dueDate: number;
}

export interface PaymentCaptureInput {
  paymentId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  capturedAt: number;
  gateway: string;
}

export interface ChargebackInput {
  chargebackId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  reason: string;
  raisedAt: number;
}

export interface UsageThresholdInput {
  subscriptionId: string;
  userId: string;
  metricType: string;
  usage: number;
  limit: number;
  level: 'soft' | 'hard';
}

export interface ChurnRiskInput {
  subscriptionId: string;
  userId: string;
  riskScore: number;
  previousScore?: number;
  factors: string[];
}

export interface MrrChangeInput {
  previousMrr: number;
  currentMrr: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
}

export interface ContractInvocationInput {
  contractId: string;
  method: string;
  caller: string;
  ledger: number;
  txHash: string;
}

// ---------------------------------------------------------------------------
// Subscription Domain Integration
// ---------------------------------------------------------------------------

export class SubscriptionEventPublisher {
  constructor(
    private readonly bus: IEventBus = eventBus,
    private readonly store: EventSourcedStore = eventStore,
  ) {}

  async publishCreated(input: SubscriptionCreationInput): Promise<void> {
    const payload: SubscriptionCreatedPayload = { ...input };
    const event = buildEvent('subscription', 'created', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishCancelled(input: SubscriptionCancellationInput): Promise<void> {
    const payload: SubscriptionCancelledPayload = { ...input };
    const event = buildEvent('subscription', 'cancelled', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishRenewed(input: SubscriptionRenewalInput): Promise<void> {
    const payload: SubscriptionRenewedPayload = { ...input };
    const event = buildEvent('subscription', 'renewed', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishUpgraded(input: SubscriptionUpgradeInput): Promise<void> {
    const payload: SubscriptionUpgradedPayload = { ...input };
    const event = buildEvent('subscription', 'upgraded', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishPaused(input: SubscriptionPauseInput): Promise<void> {
    const payload: SubscriptionPausedPayload = { ...input };
    const event = buildEvent('subscription', 'paused', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishResumed(input: SubscriptionResumeInput): Promise<void> {
    const payload: SubscriptionResumedPayload = { ...input };
    const event = buildEvent('subscription', 'resumed', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishPaymentFailed(input: PaymentFailureInput): Promise<void> {
    const payload: SubscriptionPaymentFailedPayload = { ...input };
    const event = buildEvent('subscription', 'payment_failed', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  /**
   * Replay all events for a subscription to reconstruct its current state.
   */
  replaySubscription(subscriptionId: string): Record<string, unknown> {
    return this.store.reconstruct(subscriptionId);
  }
}

// ---------------------------------------------------------------------------
// Billing Domain Integration
// ---------------------------------------------------------------------------

export class BillingEventPublisher {
  constructor(
    private readonly bus: IEventBus = eventBus,
    private readonly store: EventSourcedStore = eventStore,
  ) {}

  async publishInvoiceGenerated(input: InvoiceGenerationInput): Promise<void> {
    const payload: InvoiceGeneratedPayload = { ...input };
    const event = buildEvent('billing', 'invoice_generated', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.invoiceId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishPaymentCaptured(input: PaymentCaptureInput): Promise<void> {
    const payload: PaymentCapturedPayload = { ...input };
    const event = buildEvent('billing', 'payment_captured', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.paymentId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishChargebackRaised(input: ChargebackInput): Promise<void> {
    const payload: ChargebackRaisedPayload = { ...input };
    const event = buildEvent('billing', 'chargeback_raised', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.chargebackId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishUsageThresholdReached(input: UsageThresholdInput): Promise<void> {
    const { usage, limit } = input;
    const payload: UsageThresholdReachedPayload = {
      ...input,
      ratio: limit > 0 ? usage / limit : 0,
    };
    const event = buildEvent('billing', 'usage_threshold_reached', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }
}

// ---------------------------------------------------------------------------
// Analytics Domain Integration
// ---------------------------------------------------------------------------

export class AnalyticsEventPublisher {
  constructor(
    private readonly bus: IEventBus = eventBus,
    private readonly store: EventSourcedStore = eventStore,
  ) {}

  async publishChurnRiskUpdated(input: ChurnRiskInput): Promise<void> {
    const payload: ChurnRiskUpdatedPayload = { ...input };
    const event = buildEvent('analytics', 'churn_risk_updated', payload, {
      aggregateId: input.subscriptionId,
      correlationId: input.userId,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }

  async publishMrrChanged(input: MrrChangeInput): Promise<void> {
    const payload: MrrChangedPayload = {
      ...input,
      delta: input.currentMrr - input.previousMrr,
    };
    const event = buildEvent('analytics', 'mrr_changed', payload, {});
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }
}

// ---------------------------------------------------------------------------
// Contract Domain Integration (Stellar / Soroban)
// ---------------------------------------------------------------------------

export class ContractEventPublisher {
  constructor(
    private readonly bus: IEventBus = eventBus,
    private readonly store: EventSourcedStore = eventStore,
  ) {}

  async publishContractInvoked(input: ContractInvocationInput): Promise<void> {
    const payload: ContractInvokedPayload = { ...input };
    const event = buildEvent('contract', 'invoked', payload, {
      aggregateId: input.contractId,
      correlationId: input.txHash,
    });
    this.store.append(event as AnyDomainEvent);
    await this.bus.publish(event as AnyDomainEvent);
  }
}

// ---------------------------------------------------------------------------
// Domain Event Router
// Registers standard cross-domain handlers so subscriptions to one domain
// can trigger actions in another (e.g., subscription.cancelled → billing alert)
// ---------------------------------------------------------------------------

export interface DomainEventRouterOptions {
  onSubscriptionCancelled?: (subscriptionId: string, userId: string) => Promise<void>;
  onPaymentFailed?: (subscriptionId: string, attemptNumber: number) => Promise<void>;
  onUsageHardLimitReached?: (subscriptionId: string, metricType: string) => Promise<void>;
  onChurnRiskHigh?: (subscriptionId: string, riskScore: number) => Promise<void>;
}

export class DomainEventRouter {
  private readonly subscriptions: ReturnType<IEventBus['subscribe']>[] = [];

  constructor(
    private readonly bus: IEventBus = eventBus,
    private readonly handlers: DomainEventRouterOptions = {},
  ) {}

  /**
   * Register all standard cross-domain routing rules.
   * Call once at application startup.
   */
  register(): void {
    this.subscriptions.push(
      this.bus.subscribe('subscription.cancelled', async (event) => {
        await this.handlers.onSubscriptionCancelled?.(
          event.payload.subscriptionId,
          event.payload.userId,
        );
      }),

      this.bus.subscribe('subscription.payment_failed', async (event) => {
        await this.handlers.onPaymentFailed?.(
          event.payload.subscriptionId,
          event.payload.attemptNumber,
        );
      }),

      this.bus.subscribe(
        'billing.usage_threshold_reached',
        async (event) => {
          await this.handlers.onUsageHardLimitReached?.(
            event.payload.subscriptionId,
            event.payload.metricType,
          );
        },
        { filter: (e) => e.payload.level === 'hard' },
      ),

      this.bus.subscribe(
        'analytics.churn_risk_updated',
        async (event) => {
          await this.handlers.onChurnRiskHigh?.(
            event.payload.subscriptionId,
            event.payload.riskScore,
          );
        },
        { filter: (e) => e.payload.riskScore >= 0.8 },
      ),
    );
  }

  /** Unregister all routing rules. */
  unregister(): void {
    for (const sub of this.subscriptions) sub.unsubscribe();
    this.subscriptions.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Singletons (shared across services)
// ---------------------------------------------------------------------------

export const subscriptionEventPublisher = new SubscriptionEventPublisher();
export const billingEventPublisher = new BillingEventPublisher();
export const analyticsEventPublisher = new AnalyticsEventPublisher();
export const contractEventPublisher = new ContractEventPublisher();
