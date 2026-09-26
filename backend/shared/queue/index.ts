export {
  BULLMQ_PRIORITY,
  DEFAULT_PRIORITY_WEIGHTS,
  LATENCY_SLO_MS,
  LOW_PRIORITY_MIN_CAPACITY_PERCENT,
  PRIORITY_ORDER,
  createEmptyStats,
} from './types';
export type {
  EnqueueOptions,
  PriorityClass,
  PriorityQueueStats,
  PriorityStatsMap,
  QueueJob,
} from './types';

export { PriorityQueue } from './priorityQueue';
export type { BullJobLike, BullQueueLike, PriorityQueueConfig } from './priorityQueue';

export {
  WeightedFairQueue,
  computeEffectiveWeights,
  selectNextPriority,
  resolveBackpressure,
} from './weightedFairQueue';
export type {
  JobHandler,
  JobHandlerMap,
  SchedulerSnapshot,
  WeightedFairQueueConfig,
} from './weightedFairQueue';

export { createJobQueueSystem } from './queueFactory';
export type { JobQueueSystem, JobQueueSystemConfig } from './queueFactory';

// ── Priority management additions ─────────────────────────────────────────────

export {
  RetryPolicy,
  defaultRetryPolicy,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
} from './retryPolicy';
export type { RetryPolicyConfig, RetryDecision } from './retryPolicy';

export { DeadLetterQueue } from './deadLetterQueue';
export type { DeadLetterEntry, DeadLetterQueueConfig } from './deadLetterQueue';

export {
  JobRateLimiter,
  createDefaultJobRateLimiter,
} from './jobRateLimiter';
export type { RateLimitConfig, RateLimitDecision, RateLimitStats } from './jobRateLimiter';

export { JobScheduler } from './jobScheduler';
export type { CronJobDefinition, ScheduledJobStatus, JobSchedulerOptions } from './jobScheduler';

export { JobMonitoringDashboard } from './jobMonitoringDashboard';
export type {
  QueueHealthSummary,
  DlqSummary,
  JobDashboardSnapshot,
  JobMonitoringDashboardConfig,
} from './jobMonitoringDashboard';
