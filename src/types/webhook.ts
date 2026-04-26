import { BillingCycle } from './subscription';

export type WebhookEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.charged'
  | 'subscription.refund_requested'
  | 'subscription.refund_approved'
  | 'subscription.refund_rejected'
  | 'subscription.transfer_requested'
  | 'subscription.transfer_accepted';

export interface WebhookRetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor?: number;
}

export interface WebhookConfig {
  id: string;
  merchantId: string;
  url: string;
  events: WebhookEventType[];
  secretKey: string;
  retryPolicy: WebhookRetryPolicy;
  isPaused: boolean;
  createdAt: number;
  updatedAt: number;
  lastHealthCheckAt?: number;
  lastHealthStatus?: 'healthy' | 'degraded' | 'unhealthy';
  successCount: number;
  failureCount: number;
}

export interface WebhookSubscriptionSnapshot {
  id: string;
  planId: string;
  subscriberId: string;
  status: string;
  startedAt: number;
  lastChargedAt: number;
  nextChargeAt: number;
  totalPaid: number;
  totalGasSpent: number;
  chargeCount: number;
  pausedAt: number;
  pauseDuration: number;
  refundRequestedAmount: number;
}

export interface WebhookPlanSnapshot {
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

export interface WebhookEventInput {
  webhookId: string;
  merchantId: string;
  eventType: WebhookEventType;
  subscription: WebhookSubscriptionSnapshot;
  plan: WebhookPlanSnapshot;
  previousStatus: string;
  currentStatus: string;
  occurredAt?: number;
}

export interface WebhookEventPayload {
  id: string;
  webhookId: string;
  eventType: WebhookEventType;
  occurredAt: number;
  merchantId: string;
  subscription: WebhookSubscriptionSnapshot;
  plan: WebhookPlanSnapshot;
  previousStatus: string;
  currentStatus: string;
  payloadVersion: number;
}

export type WebhookDeliveryStatus =
  | 'pending'
  | 'retrying'
  | 'delivered'
  | 'failed'
  | 'paused'
  | 'skipped';

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: WebhookEventType;
  url: string;
  payload: WebhookEventPayload;
  status: WebhookDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  lastAttemptAt?: number;
  deliveredAt?: number;
  nextRetryAt?: number;
  responseCode?: number;
  errorMessage?: string;
  signature: string;
  idempotencyKey: string;
  latencyMs?: number;
}

export interface WebhookAnalytics {
  webhookId: string;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  retryCount: number;
  pendingDeliveries: number;
  successRate: number;
  avgAttempts: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}
