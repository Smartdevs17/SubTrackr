/**
 * Job queue priority types and scheduling constants.
 *
 * Priority classes map to BullMQ numeric priorities (lower = higher urgency).
 * Weights drive weighted fair queuing across worker capacity.
 */

export type PriorityClass = 'critical' | 'high' | 'normal' | 'low';

/** Descending urgency — used for backpressure (pause lowest first). */
export const PRIORITY_ORDER: readonly PriorityClass[] = ['critical', 'high', 'normal', 'low'];

/** Default WFQ capacity shares (must sum to 100). */
export const DEFAULT_PRIORITY_WEIGHTS: Record<PriorityClass, number> = {
  critical: 50,
  high: 25,
  normal: 15,
  low: 10,
};

/** Minimum guaranteed capacity for low-priority jobs under load (1%). */
export const LOW_PRIORITY_MIN_CAPACITY_PERCENT = 1;

/** Latency SLO thresholds in milliseconds. */
export const LATENCY_SLO_MS: Record<PriorityClass, number> = {
  critical: 30_000,
  high: 120_000,
  normal: 600_000,
  low: Infinity,
};

/**
 * BullMQ priority values — lower number means higher priority.
 * @see https://docs.bullmq.io/guide/jobs/prioritized
 */
export const BULLMQ_PRIORITY: Record<PriorityClass, number> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export interface EnqueueOptions {
  /** Inherit parent job priority when spawning sub-jobs. */
  parentPriority?: PriorityClass;
  delay?: number;
  jobId?: string;
}

export interface QueueJob<T = unknown> {
  id: string;
  name: string;
  data: T;
  priority: PriorityClass;
  enqueuedAt: number;
  /** BullMQ job id — used to remove from Redis when dequeued by WFQ. */
  bullJobId?: string;
}

export interface PriorityQueueStats {
  depth: number;
  paused: boolean;
  maxSize: number;
  totalEnqueued: number;
  totalProcessed: number;
  totalWaitTimeMs: number;
  totalProcessingTimeMs: number;
  sloViolations: number;
  lastWaitTimeMs: number;
  lastProcessingTimeMs: number;
}

export type PriorityStatsMap = Record<PriorityClass, PriorityQueueStats>;

export function createEmptyStats(maxSize = 10_000): PriorityStatsMap {
  const empty = (): PriorityQueueStats => ({
    depth: 0,
    paused: false,
    maxSize,
    totalEnqueued: 0,
    totalProcessed: 0,
    totalWaitTimeMs: 0,
    totalProcessingTimeMs: 0,
    sloViolations: 0,
    lastWaitTimeMs: 0,
    lastProcessingTimeMs: 0,
  });

  return {
    critical: empty(),
    high: empty(),
    normal: empty(),
    low: empty(),
  };
}
