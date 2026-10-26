/**
 * PriorityQueue — wraps BullMQ with priority-class semantics.
 *
 * Scheduling source of truth: the in-memory pending list consumed by
 * WeightedFairQueue. BullMQ is the durable persistence layer; jobs are
 * removed from Redis when the WFQ scheduler dequeues them.
 */

import { Queue, type ConnectionOptions, type JobsOptions, type QueueOptions } from 'bullmq';
import {
  BULLMQ_PRIORITY,
  LATENCY_SLO_MS,
  type EnqueueOptions,
  type PriorityClass,
  type PriorityQueueStats,
  type QueueJob,
} from './types';

// ── Adapter for test doubles ──────────────────────────────────────────────────

export interface BullJobLike {
  remove(): Promise<void>;
}

export interface BullQueueLike {
  add(name: string, data: unknown, opts?: JobsOptions): Promise<{ id?: string }>;
  getJob(id: string): Promise<BullJobLike | undefined>;
  getWaitingCount(): Promise<number>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface PriorityQueueConfig {
  connection: ConnectionOptions;
  baseQueueName: string;
  priority: PriorityClass;
  maxSize?: number;
  /** Inject a mock queue in tests. */
  queueFactory?: (name: string, opts: QueueOptions) => BullQueueLike;
}

// ── PriorityQueue ─────────────────────────────────────────────────────────────

export class PriorityQueue<T = unknown> {
  readonly priority: PriorityClass;
  private readonly queue: BullQueueLike;
  private readonly maxSize: number;
  private readonly pending: QueueJob<T>[] = [];
  private paused = false;
  private stats: PriorityQueueStats;

  constructor(config: PriorityQueueConfig) {
    this.priority = config.priority;
    this.maxSize = config.maxSize ?? 10_000;
    const queueName = `${config.baseQueueName}:${config.priority}`;
    const factory = config.queueFactory ?? ((name, opts) => new Queue(name, opts) as unknown as BullQueueLike);
    this.queue = factory(queueName, { connection: config.connection });
    this.stats = {
      depth: 0,
      paused: false,
      maxSize: this.maxSize,
      totalEnqueued: 0,
      totalProcessed: 0,
      totalWaitTimeMs: 0,
      totalProcessingTimeMs: 0,
      sloViolations: 0,
      lastWaitTimeMs: 0,
      lastProcessingTimeMs: 0,
    };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get depth(): number {
    return this.pending.length;
  }

  get isFull(): boolean {
    return this.pending.length >= this.maxSize;
  }

  getStats(): PriorityQueueStats {
    return { ...this.stats, depth: this.pending.length, paused: this.paused };
  }

  /**
   * Enqueue a job at this queue's priority class.
   * Persists to BullMQ and adds to the in-memory scheduling buffer.
   */
  async add(name: string, data: T, opts: EnqueueOptions = {}): Promise<QueueJob<T>> {
    if (this.paused) {
      throw new Error(`PriorityQueue [${this.priority}] is paused — cannot accept new jobs`);
    }
    if (this.isFull) {
      throw new Error(`PriorityQueue [${this.priority}] is at capacity (${this.maxSize})`);
    }

    const effectivePriority = opts.parentPriority ?? this.priority;
    const enqueuedAt = Date.now();
    const bullOpts: JobsOptions = {
      priority: BULLMQ_PRIORITY[effectivePriority],
      delay: opts.delay,
      jobId: opts.jobId,
    };

    const result = await this.queue.add(name, data, bullOpts);
    const bullJobId = result.id ?? opts.jobId;
    const job: QueueJob<T> = {
      id: bullJobId ?? `${name}_${enqueuedAt}`,
      name,
      data,
      priority: effectivePriority,
      enqueuedAt,
      bullJobId,
    };

    this.pending.push(job);
    this.stats.totalEnqueued += 1;
    this.stats.depth = this.pending.length;
    return job;
  }

  /**
   * Spawn a sub-job at the same priority as this queue.
   * For cross-priority inheritance use WeightedFairQueue.spawnSubJob().
   */
  async spawnSubJob(name: string, data: T, parentPriority: PriorityClass): Promise<QueueJob<T>> {
    if (parentPriority !== this.priority) {
      throw new Error(
        `spawnSubJob: parent priority "${parentPriority}" does not match queue "${this.priority}". ` +
          'Use WeightedFairQueue.spawnSubJob() to route sub-jobs to the correct priority class.',
      );
    }
    return this.add(name, data, { parentPriority });
  }

  /** Dequeue the next job and remove it from BullMQ (WFQ scheduling). */
  async dequeue(): Promise<QueueJob<T> | undefined> {
    if (this.paused || this.pending.length === 0) return undefined;

    const job = this.pending.shift();
    if (!job) return undefined;

    if (job.bullJobId) {
      const bullJob = await this.queue.getJob(job.bullJobId);
      await bullJob?.remove();
    }

    this.stats.depth = this.pending.length;
    return job;
  }

  /** Peek without removing. */
  peek(): QueueJob<T> | undefined {
    return this.pending[0];
  }

  /** Record processing completion and check SLO. */
  recordProcessed(waitTimeMs: number, processingTimeMs: number, jobPriority: PriorityClass): void {
    this.stats.totalProcessed += 1;
    this.stats.totalWaitTimeMs += waitTimeMs;
    this.stats.totalProcessingTimeMs += processingTimeMs;
    this.stats.lastWaitTimeMs = waitTimeMs;
    this.stats.lastProcessingTimeMs = processingTimeMs;

    const slo = LATENCY_SLO_MS[jobPriority];
    if (Number.isFinite(slo) && waitTimeMs > slo) {
      this.stats.sloViolations += 1;
    }
  }

  async pause(): Promise<void> {
    this.paused = true;
    this.stats.paused = true;
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    this.paused = false;
    this.stats.paused = false;
    await this.queue.resume();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
