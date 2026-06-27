/**
 * @deprecated Use \`useStore\` from \`./combinedStore\` instead.
 * All stores are now combined into a single store using the slices pattern.
 */
export { useStore as useWebhookStore } from './combinedStore';

import type { WebhookEventType, WebhookDeliveryStatus, WebhookRetryPolicy } from '../types/webhook';

export const webhookEventTypes: WebhookEventType[] = [
  'subscription.created',
  'subscription.updated',
  'subscription.renewed',
  'subscription.cancelled',
  'subscription.payment_failed',
  'subscription.upgraded',
  'subscription.paused',
  'subscription.resumed',
  'subscription.charged',
  'subscription.refund_requested',
  'subscription.refund_approved',
  'subscription.refund_rejected',
  'subscription.transfer_requested',
  'subscription.transfer_accepted',
];

export const webhookStatusLabels: Record<WebhookDeliveryStatus, string> = {
  pending: 'Pending',
  retrying: 'Retrying',
  delivered: 'Delivered',
  failed: 'Failed',
  paused: 'Paused',
  skipped: 'Skipped',
};

const DEFAULT_RETRY_POLICY: WebhookRetryPolicy = {
  maxRetries: 5,
  initialDelayMs: 250,
  maxDelayMs: 8_000,
  backoffFactor: 2,
};

export const defaultRetryPolicy = DEFAULT_RETRY_POLICY;
