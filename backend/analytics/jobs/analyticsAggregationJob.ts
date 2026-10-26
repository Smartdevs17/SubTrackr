/**
 * Analytics aggregation background jobs.
 *
 * Heavy aggregation and reporting — low priority.
 */

import type { PriorityClass, PriorityQueue, QueueJob, WeightedFairQueue } from '../../shared/queue';

export const ANALYTICS_JOB_PRIORITY: PriorityClass = 'low';

export const ANALYTICS_JOB_NAMES = {
  AGGREGATE_DAILY: 'analytics:aggregate-daily',
  AGGREGATE_HOURLY: 'analytics:aggregate-hourly',
  MAINTENANCE_CLEANUP: 'analytics:maintenance-cleanup',
} as const;

export type AnalyticsJobName = (typeof ANALYTICS_JOB_NAMES)[keyof typeof ANALYTICS_JOB_NAMES];

export interface AnalyticsAggregationPayload {
  reportType: string;
  merchantId?: string;
  dateRange: { start: string; end: string };
}

export async function enqueueAnalyticsAggregation(
  queue: PriorityQueue<AnalyticsAggregationPayload>,
  payload: AnalyticsAggregationPayload,
): Promise<QueueJob<AnalyticsAggregationPayload>> {
  return queue.add(ANALYTICS_JOB_NAMES.AGGREGATE_DAILY, payload);
}

export async function enqueueMaintenanceCleanup(
  scheduler: WeightedFairQueue,
  olderThanDays: number,
): Promise<QueueJob<{ olderThanDays: number }>> {
  return scheduler.spawnSubJob(ANALYTICS_JOB_PRIORITY, ANALYTICS_JOB_NAMES.MAINTENANCE_CLEANUP, {
    olderThanDays,
  });
}
