/**
 * Billing Stream Consumers
 *
 * Four concrete implementations of BillingStreamConsumer, each responsible
 * for a specific downstream concern:
 *
 *   NotificationConsumer     – sends user-facing alerts for charge events
 *   AnalyticsConsumer        – records billing metrics for reporting
 *   FraudDetectionConsumer   – evaluates events for fraud signals
 *   WebhookDispatchConsumer  – dispatches webhook payloads to merchant endpoints
 *
 * All consumers are designed to be idempotent and must not throw for
 * non-retriable errors — they should log and continue.
 *
 * For production use, replace the stub implementations with real service calls.
 */

import type { BillingStreamConsumer, BillingStreamEvent } from './types';

// ---------------------------------------------------------------------------
// NotificationConsumer
// ---------------------------------------------------------------------------

export interface NotificationSink {
  sendNotification(userId: string, type: string, data: Record<string, unknown>): Promise<void>;
}

/** Stub notification sink that logs to console. Swap for real notification service. */
export const consoleNotificationSink: NotificationSink = {
  async sendNotification(userId, type, data) {
    console.info(`[Notification] user=${userId} type=${type} data=${JSON.stringify(data)}`);
  },
};

/**
 * NotificationConsumer dispatches user-facing alerts for billing charge events.
 * Sends notifications for:
 *   - Successful payment captured
 *   - Charge failed (with retriable flag)
 *   - Subscription cancelled due to billing failure
 */
export class NotificationConsumer implements BillingStreamConsumer {
  readonly name = 'NotificationConsumer';

  constructor(private readonly sink: NotificationSink = consoleNotificationSink) {}

  async handleBatch(events: BillingStreamEvent[]): Promise<void> {
    const tasks = events.map(async (event) => {
      try {
        if (event.name === 'billing.payment_captured') {
          await this.sink.sendNotification(event.payload.userId as string, 'payment_success', {
            amount: event.payload.amount,
            currency: event.payload.currency,
            capturedAt: event.payload.capturedAt,
          });
        } else if (event.name === 'billing.charge_failed') {
          await this.sink.sendNotification(event.payload.userId as string, 'charge_failed', {
            amount: event.payload.amount,
            currency: event.payload.currency,
            failureReason: event.payload.failureReason,
            retriable: event.payload.retriable,
          });
        } else if (event.name === 'billing.subscription_cancelled_billing') {
          await this.sink.sendNotification(
            event.payload.userId as string,
            'subscription_cancelled_billing',
            {
              subscriptionId: event.payload.subscriptionId,
              reason: event.payload.reason,
              cancelledAt: event.payload.cancelledAt,
            },
          );
        } else if (event.name === 'billing.invoice_generated') {
          await this.sink.sendNotification(event.payload.userId as string, 'invoice_generated', {
            invoiceId: event.payload.invoiceId,
            amount: event.payload.amount,
            currency: event.payload.currency,
            dueDate: event.payload.dueDate,
          });
        }
      } catch (err) {
        console.error(`[NotificationConsumer] Failed for event ${event.id}: ${String(err)}`);
      }
    });

    await Promise.allSettled(tasks);
  }
}

// ---------------------------------------------------------------------------
// AnalyticsConsumer
// ---------------------------------------------------------------------------

export interface AnalyticsSink {
  record(
    metric: string,
    value: number,
    tags: Record<string, string | number>,
  ): Promise<void>;
}

/** Stub analytics sink that logs to console. Swap for real analytics service. */
export const consoleAnalyticsSink: AnalyticsSink = {
  async record(metric, value, tags) {
    console.info(`[Analytics] metric=${metric} value=${value} tags=${JSON.stringify(tags)}`);
  },
};

/**
 * AnalyticsConsumer records aggregated billing metrics for reporting dashboards.
 * Tracks:
 *   - Payment amounts (captured, attempted, failed)
 *   - Invoice generation volumes
 *   - Charge attempt and retry counts
 *   - Chargeback amounts
 */
export class AnalyticsConsumer implements BillingStreamConsumer {
  readonly name = 'AnalyticsConsumer';

  constructor(private readonly sink: AnalyticsSink = consoleAnalyticsSink) {}

  async handleBatch(events: BillingStreamEvent[]): Promise<void> {
    const tasks = events.map(async (event) => {
      try {
        if (event.name === 'billing.payment_captured') {
          await this.sink.record('billing.payment_captured', event.payload.amount as number, {
            currency: event.payload.currency as string,
            gateway: event.payload.gateway as string,
            subscriptionId: event.payload.subscriptionId as string,
          });
        } else if (event.name === 'billing.charge_attempted') {
          await this.sink.record('billing.charge_attempt', 1, {
            gateway: event.payload.gateway as string,
            attemptNumber: event.payload.attemptNumber as number,
            subscriptionId: event.payload.subscriptionId as string,
          });
        } else if (event.name === 'billing.charge_failed') {
          await this.sink.record('billing.charge_failure', 1, {
            gateway: event.payload.gateway as string,
            failureCode: event.payload.failureCode as string,
            retriable: String(event.payload.retriable),
            subscriptionId: event.payload.subscriptionId as string,
          });
        } else if (event.name === 'billing.charge_retried') {
          await this.sink.record('billing.charge_retry', 1, {
            gateway: event.payload.gateway as string,
            attemptNumber: event.payload.attemptNumber as number,
            subscriptionId: event.payload.subscriptionId as string,
          });
        } else if (event.name === 'billing.invoice_generated') {
          await this.sink.record('billing.invoice_generated', event.payload.amount as number, {
            currency: event.payload.currency as string,
            subscriptionId: event.payload.subscriptionId as string,
          });
        } else if (event.name === 'billing.chargeback_raised') {
          await this.sink.record('billing.chargeback', event.payload.amount as number, {
            currency: event.payload.currency as string,
            subscriptionId: event.payload.subscriptionId as string,
          });
        }
      } catch (err) {
        console.error(`[AnalyticsConsumer] Failed for event ${event.id}: ${String(err)}`);
      }
    });

    await Promise.allSettled(tasks);
  }
}

// ---------------------------------------------------------------------------
// FraudDetectionConsumer
// ---------------------------------------------------------------------------

export interface FraudEvaluationResult {
  eventId: string;
  subscriptionId: string;
  riskScore: number;
  signals: string[];
  blocked: boolean;
}

export interface FraudDetectionSink {
  evaluate(
    subscriptionId: string,
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<FraudEvaluationResult>;
}

/** Stub fraud sink that returns a zero-risk evaluation. Swap for real ML service. */
export const noopFraudSink: FraudDetectionSink = {
  async evaluate(subscriptionId, eventName) {
    return {
      eventId: '',
      subscriptionId,
      riskScore: 0,
      signals: [],
      blocked: false,
    };
  },
};

/**
 * FraudDetectionConsumer evaluates billing events for fraud signals.
 * Inspects:
 *   - Multiple charge failures on the same subscription (velocity)
 *   - Unusual amounts compared to historical baseline
 *   - Rapid charge attempts
 *   - Chargeback patterns
 */
export class FraudDetectionConsumer implements BillingStreamConsumer {
  readonly name = 'FraudDetectionConsumer';

  /** Track consecutive failures per subscription for velocity checking. */
  private readonly failureCount = new Map<string, number>();

  constructor(
    private readonly sink: FraudDetectionSink = noopFraudSink,
    private readonly highRiskThreshold = 0.8,
  ) {}

  async handleBatch(events: BillingStreamEvent[]): Promise<void> {
    const tasks = events.map(async (event) => {
      try {
        // Only evaluate events with fraud relevance
        const relevantNames = new Set([
          'billing.charge_attempted',
          'billing.charge_failed',
          'billing.chargeback_raised',
          'billing.payment_captured',
        ]);
        if (!relevantNames.has(event.name)) return;

        const subscriptionId = event.payload.subscriptionId as string;

        // Track failure velocity
        if (event.name === 'billing.charge_failed') {
          const count = (this.failureCount.get(subscriptionId) ?? 0) + 1;
          this.failureCount.set(subscriptionId, count);
        } else if (event.name === 'billing.payment_captured') {
          // Reset failure count on successful capture
          this.failureCount.delete(subscriptionId);
        }

        const result = await this.sink.evaluate(
          subscriptionId,
          event.name,
          event.payload as Record<string, unknown>,
        );

        if (result.riskScore >= this.highRiskThreshold) {
          console.warn(
            `[FraudDetection] High-risk event detected: subscriptionId=${subscriptionId} ` +
              `event=${event.name} riskScore=${result.riskScore} signals=[${result.signals.join(', ')}]`,
          );
        }
      } catch (err) {
        console.error(`[FraudDetectionConsumer] Failed for event ${event.id}: ${String(err)}`);
      }
    });

    await Promise.allSettled(tasks);
  }

  getFailureCount(subscriptionId: string): number {
    return this.failureCount.get(subscriptionId) ?? 0;
  }

  resetFailureCount(subscriptionId: string): void {
    this.failureCount.delete(subscriptionId);
  }
}

// ---------------------------------------------------------------------------
// WebhookDispatchConsumer
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  eventId: string;
  eventName: string;
  occurredAt: number;
  subscriptionId?: string;
  data: Record<string, unknown>;
}

export interface WebhookDispatchSink {
  dispatch(
    subscriptionId: string,
    payload: WebhookPayload,
  ): Promise<{ delivered: boolean; statusCode?: number }>;
}

/** Stub webhook sink that logs dispatches. Swap for real HTTP delivery service. */
export const consoleWebhookSink: WebhookDispatchSink = {
  async dispatch(subscriptionId, payload) {
    console.info(
      `[Webhook] Dispatching to subscriptionId=${subscriptionId} event=${payload.eventName}`,
    );
    return { delivered: true };
  },
};

/**
 * WebhookDispatchConsumer delivers billing events as webhook payloads to
 * merchant-configured endpoints.
 *
 * All billing stream events that carry a subscriptionId are forwarded.
 * The consumer respects a configurable allow-list of event names to avoid
 * flooding merchant endpoints with internal/low-value events.
 */
export class WebhookDispatchConsumer implements BillingStreamConsumer {
  readonly name = 'WebhookDispatchConsumer';

  private readonly allowedEvents: Set<string>;

  constructor(
    private readonly sink: WebhookDispatchSink = consoleWebhookSink,
    allowedEvents: string[] = [
      'billing.payment_captured',
      'billing.invoice_generated',
      'billing.charge_failed',
      'billing.chargeback_raised',
      'billing.subscription_cancelled_billing',
    ],
  ) {
    this.allowedEvents = new Set(allowedEvents);
  }

  async handleBatch(events: BillingStreamEvent[]): Promise<void> {
    const tasks = events
      .filter((e) => this.allowedEvents.has(e.name))
      .map(async (event) => {
        const subscriptionId = event.payload.subscriptionId as string | undefined;
        if (!subscriptionId) return;

        try {
          const payload: WebhookPayload = {
            eventId: event.id,
            eventName: event.name,
            occurredAt: event.occurredAt,
            subscriptionId,
            data: event.payload as Record<string, unknown>,
          };
          await this.sink.dispatch(subscriptionId, payload);
        } catch (err) {
          console.error(`[WebhookDispatchConsumer] Failed for event ${event.id}: ${String(err)}`);
        }
      });

    await Promise.allSettled(tasks);
  }

  /** Update the set of event names that will be dispatched as webhooks. */
  setAllowedEvents(events: string[]): void {
    this.allowedEvents.clear();
    for (const e of events) this.allowedEvents.add(e);
  }
}
