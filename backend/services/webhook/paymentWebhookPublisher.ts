/**
 * Payment webhook publisher – emits signed finality/expiry/cancellation
 * webhooks for partners by reusing the existing WebhookDeliveryService
 * (HMAC signing, retry with backoff, DLQ).
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/1719
 */

import type { PaymentIntent } from '../payment/domain/PaymentIntent';
import type { WebhookEventType, WebhookSubscriptionSnapshot, WebhookPlanSnapshot } from '../../../src/types/webhook';
import { webhookDeliveryService, type WebhookDeliveryResult } from '../notification/webhook';

export type PaymentWebhookEventType = Extract<
  WebhookEventType,
  'payment.finalized' | 'payment.expired' | 'payment.cancelled' | 'payment.succeeded'
>;

/** Default empty snapshots used when a full subscription/plan snapshot is unavailable. */
const EMPTY_SUBSCRIPTION_SNAPSHOT: WebhookSubscriptionSnapshot = {
  id: '',
  planId: '',
  subscriberId: '',
  status: '',
  startedAt: 0,
  lastChargedAt: 0,
  nextChargeAt: 0,
  totalPaid: 0,
  totalGasSpent: 0,
  chargeCount: 0,
  pausedAt: 0,
  pauseDuration: 0,
  refundRequestedAmount: 0,
};

const EMPTY_PLAN_SNAPSHOT: WebhookPlanSnapshot = {
  id: '',
  merchantId: '',
  name: '',
  price: 0,
  token: '',
  interval: 'monthly' as WebhookPlanSnapshot['interval'],
  active: true,
  subscriberCount: 0,
  createdAt: 0,
};

export interface PaymentWebhookSnapshot {
  subscription?: Partial<WebhookSubscriptionSnapshot>;
  plan?: Partial<WebhookPlanSnapshot>;
}

export class PaymentWebhookPublisher {
  /**
   * Emit a signed webhook for a payment lifecycle transition.
   *
   * Returns the delivery result (or null when no webhook is registered for
   * the merchant). The payload carries tx hash + confirmation depth so
   * partners can react to finality.
   */
  async publishPaymentEvent(
    intent: PaymentIntent,
    eventType: PaymentWebhookEventType,
    snapshot: PaymentWebhookSnapshot = {},
    webhookIds?: string[],
  ): Promise<WebhookDeliveryResult[]> {
    const targets = webhookIds?.length
      ? webhookIds
      : webhookDeliveryService
          .listWebhooks(intent.merchantId)
          .filter((wh) => wh.events.includes(eventType) && !wh.isPaused)
          .map((wh) => wh.id);

    const results: WebhookDeliveryResult[] = [];

    for (const webhookId of targets) {
      const previousStatus =
        eventType === 'payment.finalized' ? 'pending_finality' : eventType.replace('payment.', '');
      const currentStatus =
        eventType === 'payment.finalized' ? 'finalized' : eventType.replace('payment.', '');

      const result = await webhookDeliveryService.deliverEvent({
        webhookId,
        merchantId: intent.merchantId,
        eventType,
        subscription: {
          ...EMPTY_SUBSCRIPTION_SNAPSHOT,
          id: intent.subscriptionId ?? '',
          subscriberId: intent.subscriberId,
          status: currentStatus,
          ...(snapshot.subscription ?? {}),
        },
        plan: {
          ...EMPTY_PLAN_SNAPSHOT,
          merchantId: intent.merchantId,
          token: intent.asset,
          ...(snapshot.plan ?? {}),
        },
        previousStatus,
        currentStatus,
        occurredAt: intent.updatedAt,
        idempotencyKey: `payment_${intent.id}_${eventType}_${webhookId}`,
      });

      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /** Emit a finality webhook (tx hash + confirmations in the intent metadata). */
  async publishFinalized(
    intent: PaymentIntent,
    snapshot: PaymentWebhookSnapshot = {},
  ): Promise<WebhookDeliveryResult[]> {
    return this.publishPaymentEvent(intent, 'payment.finalized', snapshot);
  }

  /** Emit an expiry webhook when a pending payment times out. */
  async publishExpired(
    intent: PaymentIntent,
    snapshot: PaymentWebhookSnapshot = {},
  ): Promise<WebhookDeliveryResult[]> {
    return this.publishPaymentEvent(intent, 'payment.expired', snapshot);
  }

  /** Emit a cancellation webhook when a payment intent is cancelled. */
  async publishCancelled(
    intent: PaymentIntent,
    snapshot: PaymentWebhookSnapshot = {},
  ): Promise<WebhookDeliveryResult[]> {
    return this.publishPaymentEvent(intent, 'payment.cancelled', snapshot);
  }
}

export const paymentWebhookPublisher = new PaymentWebhookPublisher();
export default paymentWebhookPublisher;
