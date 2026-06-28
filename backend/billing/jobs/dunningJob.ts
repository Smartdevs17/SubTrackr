/**
 * Dunning background jobs.
 *
 * Payment recovery and dunning communications — critical priority.
 */

import type { PriorityClass, PriorityQueue, QueueJob, WeightedFairQueue } from '../../shared/queue';

export const DUNNING_JOB_PRIORITY: PriorityClass = 'critical';

export const DUNNING_JOB_NAMES = {
  SEND_REMINDER: 'dunning:send-reminder',
  ESCALATE_STAGE: 'dunning:escalate-stage',
  SUSPEND_SUBSCRIPTION: 'dunning:suspend-subscription',
} as const;

export type DunningJobName = (typeof DUNNING_JOB_NAMES)[keyof typeof DUNNING_JOB_NAMES];

export interface DunningReminderPayload {
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  stage: string;
  failedAttempts: number;
}

export async function enqueueDunningReminder(
  queue: PriorityQueue<DunningReminderPayload>,
  payload: DunningReminderPayload,
): Promise<QueueJob<DunningReminderPayload>> {
  return queue.add(DUNNING_JOB_NAMES.SEND_REMINDER, payload);
}

export async function enqueueDunningEscalation(
  scheduler: WeightedFairQueue,
  payload: DunningReminderPayload,
  parentPriority: PriorityClass = DUNNING_JOB_PRIORITY,
): Promise<QueueJob<DunningReminderPayload>> {
  return scheduler.spawnSubJob(parentPriority, DUNNING_JOB_NAMES.ESCALATE_STAGE, payload);
}
