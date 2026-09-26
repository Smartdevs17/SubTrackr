/**
 * Webhook delivery background jobs.
 *
 * Outbound merchant webhook dispatch — normal priority.
 */

import type { PriorityClass, PriorityQueue, QueueJob, WeightedFairQueue } from '../../shared/queue';

export const WEBHOOK_JOB_PRIORITY: PriorityClass = 'normal';

export const WEBHOOK_JOB_NAMES = {
  DELIVER: 'webhook:deliver',
  RETRY: 'webhook:retry',
} as const;

export type WebhookJobName = (typeof WEBHOOK_JOB_NAMES)[keyof typeof WEBHOOK_JOB_NAMES];

export interface WebhookDeliveryPayload {
  webhookId: string;
  merchantId: string;
  url: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
}

export async function enqueueWebhookDelivery(
  queue: PriorityQueue<WebhookDeliveryPayload>,
  payload: WebhookDeliveryPayload,
): Promise<QueueJob<WebhookDeliveryPayload>> {
  return queue.add(WEBHOOK_JOB_NAMES.DELIVER, payload);
}

export async function enqueueWebhookRetry(
  scheduler: WeightedFairQueue,
  payload: WebhookDeliveryPayload,
): Promise<QueueJob<WebhookDeliveryPayload>> {
  return scheduler.spawnSubJob(WEBHOOK_JOB_PRIORITY, WEBHOOK_JOB_NAMES.RETRY, payload);
}
