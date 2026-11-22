/**
 * Weighted Fair Queue scheduler.
 *
 * Implements deficit round robin across priority classes with:
 *   - configurable weights (default 50/25/15/10)
 *   - dynamic reweighting when higher queues are idle
 *   - starvation prevention (low guaranteed ≥ 1% capacity)
 *   - backpressure (pause lowest priority first when all queues full)
 */

import { PriorityQueue } from './priorityQueue';
import {
  DEFAULT_PRIORITY_WEIGHTS,
  LOW_PRIORITY_MIN_CAPACITY_PERCENT,
  PRIORITY_ORDER,
  type EnqueueOptions,
  type PriorityClass,
  type PriorityStatsMap,
  type QueueJob,
  createEmptyStats,
} from './types';

export interface WeightedFairQueueConfig {
  weights?: Record<PriorityClass, number>;
  maxQueueSize?: number;
}

export type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<void>;
export type JobHandlerMap = Record<string, JobHandler>;

export interface SchedulerSnapshot {
  effectiveWeights: Record<PriorityClass, number>;
  deficits: Record<PriorityClass, number>;
  depths: Record<PriorityClass, number>;
  paused: PriorityClass[];
}

/**
 * Pure scheduling functions — exported for unit testing.
 */

export function computeEffectiveWeights(
  baseWeights: Record<PriorityClass, number>,
  depths: Record<PriorityClass, number>,
  paused: ReadonlySet<PriorityClass>,
): Record<PriorityClass, number> {
  const effective: Record<PriorityClass, number> = { ...baseWeights };

  // Zero out paused or empty queues and collect redistributable capacity.
  let redistributable = 0;
  for (const p of PRIORITY_ORDER) {
    if (paused.has(p) || depths[p] === 0) {
      redistributable += effective[p];
      effective[p] = 0;
    }
  }

  // Dynamic reweighting — share idle capacity among queues that have work.
  const active = PRIORITY_ORDER.filter((p) => !paused.has(p) && depths[p] > 0);
  if (active.length > 0 && redistributable > 0) {
    const activeWeightSum = active.reduce((sum, p) => sum + baseWeights[p], 0);
    for (const p of active) {
      effective[p] += redistributable * (baseWeights[p] / activeWeightSum);
    }
  }

  // Starvation prevention — low always gets at least 1% when it has jobs.
  if (!paused.has('low') && depths.low > 0) {
    const total = PRIORITY_ORDER.reduce((sum, p) => sum + effective[p], 0);
    const minLow = (LOW_PRIORITY_MIN_CAPACITY_PERCENT / 100) * Math.max(total, 100);
    if (effective.low < minLow) {
      const deficit = minLow - effective.low;
      const donors = PRIORITY_ORDER.filter(
        (p) => p !== 'low' && effective[p] > minLow,
      );
      let remaining = deficit;
      for (const donor of donors) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, effective[donor] - minLow);
        effective[donor] -= take;
        effective.low += take;
        remaining -= take;
      }
    }
  }

  return effective;
}

export function selectNextPriority(
  deficits: Record<PriorityClass, number>,
  depths: Record<PriorityClass, number>,
  effectiveWeights: Record<PriorityClass, number>,
  paused: ReadonlySet<PriorityClass>,
): PriorityClass | null {
  let best: PriorityClass | null = null;
  let bestDeficit = -Infinity;

  for (const p of PRIORITY_ORDER) {
    if (paused.has(p) || depths[p] === 0) continue;
    deficits[p] += effectiveWeights[p];
    if (deficits[p] > bestDeficit) {
      bestDeficit = deficits[p];
      best = p;
    }
  }

  if (best === null) return null;

  const weightSum = PRIORITY_ORDER.reduce(
    (sum, p) => sum + (depths[p] > 0 && !paused.has(p) ? effectiveWeights[p] : 0),
    0,
  );
  deficits[best] -= weightSum > 0 ? weightSum : effectiveWeights[best];
  return best;
}

export function resolveBackpressure(
  depths: Record<PriorityClass, number>,
  maxSize: number,
  currentlyPaused: ReadonlySet<PriorityClass>,
): PriorityClass | null {
  const allFull = PRIORITY_ORDER.every(
    (p) => currentlyPaused.has(p) || depths[p] >= maxSize,
  );
  if (!allFull) return null;

  // Pause lowest priority first (never pause critical).
  for (let i = PRIORITY_ORDER.length - 1; i >= 1; i--) {
    const p = PRIORITY_ORDER[i];
    if (!currentlyPaused.has(p)) return p;
  }
  return null;
}

// ── WeightedFairQueue ─────────────────────────────────────────────────────────

export class WeightedFairQueue {
  private readonly queues: Record<PriorityClass, PriorityQueue>;
  private readonly weights: Record<PriorityClass, number>;
  private readonly maxSize: number;
  private readonly deficits: Record<PriorityClass, number> = {
    critical: 0,
    high: 0,
    normal: 0,
    low: 0,
  };
  private readonly paused = new Set<PriorityClass>();

  constructor(queues: Record<PriorityClass, PriorityQueue>, config: WeightedFairQueueConfig = {}) {
    this.queues = queues;
    this.weights = { ...DEFAULT_PRIORITY_WEIGHTS, ...config.weights };
    this.maxSize = config.maxQueueSize ?? 10_000;
  }

  getQueue(priority: PriorityClass): PriorityQueue {
    return this.queues[priority];
  }

  getDepths(): Record<PriorityClass, number> {
    return {
      critical: this.queues.critical.depth,
      high: this.queues.high.depth,
      normal: this.queues.normal.depth,
      low: this.queues.low.depth,
    };
  }

  getSnapshot(): SchedulerSnapshot {
    const depths = this.getDepths();
    return {
      effectiveWeights: computeEffectiveWeights(this.weights, depths, this.paused),
      deficits: { ...this.deficits },
      depths,
      paused: [...this.paused],
    };
  }

  getStats(): PriorityStatsMap {
    return {
      critical: this.queues.critical.getStats(),
      high: this.queues.high.getStats(),
      normal: this.queues.normal.getStats(),
      low: this.queues.low.getStats(),
    };
  }

  /** Apply backpressure — pause lowest-priority non-empty queue when all are full. */
  async applyBackpressure(): Promise<PriorityClass | null> {
    const toPause = resolveBackpressure(this.getDepths(), this.maxSize, this.paused);
    if (toPause) {
      await this.queues[toPause].pause();
      this.paused.add(toPause);
    }
    return toPause;
  }

  /**
   * Enqueue a job with automatic backpressure handling.
   * Preferred entry point over calling PriorityQueue.add() directly.
   */
  async enqueue<T>(
    priority: PriorityClass,
    name: string,
    data: T,
    opts: EnqueueOptions = {},
  ): Promise<QueueJob<T>> {
    await this.applyBackpressure();
    if (this.paused.has(priority) || this.queues[priority].isPaused) {
      throw new Error(`Cannot enqueue to paused priority class "${priority}"`);
    }
    return this.queues[priority].add(name, data, opts) as Promise<QueueJob<T>>;
  }

  /**
   * Priority inheritance — routes sub-jobs to the parent's priority queue.
   */
  async spawnSubJob<T>(
    parentPriority: PriorityClass,
    name: string,
    data: T,
  ): Promise<QueueJob<T>> {
    return this.enqueue(parentPriority, name, data, { parentPriority });
  }

  /**
   * Select the next job using weighted fair queuing.
   * Returns null when no work is available.
   */
  async scheduleNext(): Promise<{ priority: PriorityClass; job: QueueJob } | null> {
    const depths = this.getDepths();
    const effectiveWeights = computeEffectiveWeights(this.weights, depths, this.paused);
    const priority = selectNextPriority(this.deficits, depths, effectiveWeights, this.paused);
    if (!priority) return null;

    const job = await this.queues[priority].dequeue();
    if (!job) return null;

    return { priority, job };
  }

  /**
   * Process a single job: schedule → execute handler → record metrics.
   * Returns false when no job was available.
   */
  async processNext(handlers: JobHandlerMap): Promise<boolean> {
    const next = await this.scheduleNext();
    if (!next) return false;

    const start = Date.now();
    const handler = handlers[next.job.name];
    if (!handler) {
      throw new Error(`No handler registered for job "${next.job.name}"`);
    }

    try {
      await handler(next.job);
    } finally {
      this.recordCompletion(next.priority, next.job, Date.now() - start);
    }

    return true;
  }

  private workerTimer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  /** Start a polling worker loop that processes jobs via registered handlers. */
  startProcessing(handlers: JobHandlerMap, intervalMs = 50): void {
    if (this.workerTimer) return;
    this.workerTimer = setInterval(() => {
      if (this.processing) return;
      this.processing = true;
      void this.processNext(handlers)
        .catch((err) => console.error('[WeightedFairQueue] Worker error:', err))
        .finally(() => {
          this.processing = false;
        });
    }, intervalMs);
  }

  stopProcessing(): void {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  isProcessing(): boolean {
    return this.workerTimer !== null;
  }

  /**
   * Record job completion metrics on the originating priority queue.
   */
  recordCompletion(
    queuePriority: PriorityClass,
    job: QueueJob,
    processingTimeMs: number,
  ): void {
    const waitTimeMs = Date.now() - job.enqueuedAt;
    this.queues[queuePriority].recordProcessed(waitTimeMs, processingTimeMs, job.priority);
  }

  async resumeAll(): Promise<void> {
    for (const p of this.paused) {
      await this.queues[p].resume();
    }
    this.paused.clear();
  }

  async close(): Promise<void> {
    this.stopProcessing();
    await Promise.all(PRIORITY_ORDER.map((p) => this.queues[p].close()));
  }
}

export { createEmptyStats };
