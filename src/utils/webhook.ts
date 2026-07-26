import { BillingCycle, Subscription } from '../types/subscription';
import {
  WebhookEventPayload,
  WebhookEventType,
  WebhookPlanSnapshot,
  WebhookSubscriptionSnapshot,
} from '../types/webhook';

export interface WebhookPlanLike {
  id: string;
  merchantId: string;
  name: string;
  price: number;
  token: string;
  interval: BillingCycle;
  active: boolean;
  subscriberCount: number;
  createdAt: number;
}

export const toWebhookSubscriptionSnapshot = (
  subscription: Subscription
): WebhookSubscriptionSnapshot => ({
  id: subscription.id,
  planId: subscription.id,
  subscriberId: subscription.id,
  status: subscription.isActive ? 'active' : 'inactive',
  startedAt: subscription.createdAt.getTime(),
  lastChargedAt: subscription.updatedAt.getTime(),
  nextChargeAt: subscription.nextBillingDate.getTime(),
  totalPaid: subscription.price,
  totalGasSpent: subscription.totalGasSpent ?? 0,
  chargeCount: subscription.chargeCount ?? 0,
  pausedAt: 0,
  pauseDuration: 0,
  refundRequestedAmount: 0,
});

export const toWebhookPlanSnapshot = (plan: WebhookPlanLike): WebhookPlanSnapshot => ({
  id: plan.id,
  merchantId: plan.merchantId,
  name: plan.name,
  price: plan.price,
  token: plan.token,
  interval: plan.interval,
  active: plan.active,
  subscriberCount: plan.subscriberCount,
  createdAt: plan.createdAt,
});

export const buildWebhookEventPayload = (input: {
  id: string;
  webhookId: string;
  merchantId: string;
  eventType: WebhookEventType;
  subscription: Subscription;
  plan: WebhookPlanLike;
  previousStatus: string;
  currentStatus: string;
  occurredAt?: number;
}): WebhookEventPayload => ({
  id: input.id,
  webhookId: input.webhookId,
  eventType: input.eventType,
  occurredAt: input.occurredAt ?? Date.now(),
  merchantId: input.merchantId,
  subscription: toWebhookSubscriptionSnapshot(input.subscription),
  plan: toWebhookPlanSnapshot(input.plan),
  previousStatus: input.previousStatus,
  currentStatus: input.currentStatus,
  payloadVersion: 1,
});
