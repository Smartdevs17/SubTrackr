/**
 * Notification delivery background jobs.
 *
 * Push, email, and in-app notifications — high priority.
 */

import type { PriorityClass, PriorityQueue, QueueJob, WeightedFairQueue } from '../../shared/queue';

export const NOTIFICATION_JOB_PRIORITY: PriorityClass = 'high';

export const NOTIFICATION_JOB_NAMES = {
  PUSH: 'notification:push',
  EMAIL: 'notification:email',
  IN_APP: 'notification:in-app',
} as const;

export type NotificationJobName = (typeof NOTIFICATION_JOB_NAMES)[keyof typeof NOTIFICATION_JOB_NAMES];

export interface NotificationDeliveryPayload {
  userId: string;
  channel: 'push' | 'email' | 'in_app';
  title: string;
  body: string;
  metadata?: Record<string, string>;
}

export async function enqueueNotification(
  queue: PriorityQueue<NotificationDeliveryPayload>,
  payload: NotificationDeliveryPayload,
): Promise<QueueJob<NotificationDeliveryPayload>> {
  const name =
    payload.channel === 'push'
      ? NOTIFICATION_JOB_NAMES.PUSH
      : payload.channel === 'email'
        ? NOTIFICATION_JOB_NAMES.EMAIL
        : NOTIFICATION_JOB_NAMES.IN_APP;
  return queue.add(name, payload);
}

export async function enqueueNotificationBatch(
  scheduler: WeightedFairQueue,
  payloads: NotificationDeliveryPayload[],
): Promise<QueueJob<NotificationDeliveryPayload>[]> {
  return Promise.all(
    payloads.map((payload) =>
      scheduler.spawnSubJob(NOTIFICATION_JOB_PRIORITY, NOTIFICATION_JOB_NAMES.PUSH, payload),
    ),
  );
}
