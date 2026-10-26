/**
 * Background Job Queue — SubTrackr
 *
 * Priority-based job queue for background processing (email, billing, analytics).
 */

export type JobPriority = 'critical' | 'high' | 'medium' | 'low';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  nextRetryAt?: number;
}

export type JobHandler = (job: Job) => Promise<void>;

export interface QueueConfig {
  maxConcurrent: number;
  maxRetries: number;
  retryDelayMs: number;
  processIntervalMs: number;
}

interface QueueMetrics {
  totalProcessed: number;
  totalFailed: number;
  avgProcessingTimeMs: number;
  currentlyProcessing: number;
}

const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

export class PriorityQueue {
  private queues: Map<JobPriority, Job[]> = new Map();
  private handlers: Map<string, JobHandler> = new Map();
  private processing = new Set<string>();
  private config: QueueConfig;
  private metrics: QueueMetrics = {
    totalProcessed: 0,
    totalFailed: 0,
    avgProcessingTimeMs: 0,
    currentlyProcessing: 0,
  };
  private timer?: ReturnType<typeof setInterval>;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 5,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      processIntervalMs: config.processIntervalMs ?? 100,
    };

    for (const priority of Object.keys(PRIORITY_WEIGHTS) as JobPriority[]) {
      this.queues.set(priority, []);
    }
  }

  registerHandler(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  enqueue(type: string, payload: Record<string, unknown>, priority: JobPriority = 'medium'): Job {
    const job: Job = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.config.maxRetries,
      createdAt: Date.now(),
    };

    this.queues.get(priority)!.push(job);
    return job;
  }

  private dequeue(): Job | undefined {
    const sortedPriorities = (Object.keys(PRIORITY_WEIGHTS) as JobPriority[]).sort(
      (a, b) => PRIORITY_WEIGHTS[b] - PRIORITY_WEIGHTS[a],
    );

    for (const priority of sortedPriorities) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift();
      }
    }
    return undefined;
  }

  async processNext(): Promise<boolean> {
    if (this.processing.size >= this.config.maxConcurrent) return false;

    const job = this.dequeue();
    if (!job) return false;

    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      this.metrics.totalFailed++;
      return false;
    }

    job.status = 'processing';
    job.startedAt = Date.now();
    job.attempts++;
    this.processing.add(job.id);
    this.metrics.currentlyProcessing = this.processing.size;

    try {
      await handler(job);
      job.status = 'completed';
      job.completedAt = Date.now();
      this.metrics.totalProcessed++;

      const duration = job.completedAt - job.startedAt;
      this.metrics.avgProcessingTimeMs =
        (this.metrics.avgProcessingTimeMs * (this.metrics.totalProcessed - 1) + duration) /
        this.metrics.totalProcessed;
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);

      if (job.attempts < job.maxAttempts) {
        job.status = 'retrying';
        job.nextRetryAt = Date.now() + this.config.retryDelayMs * job.attempts;
        this.queues.get(job.priority)!.push(job);
      } else {
        job.status = 'failed';
        this.metrics.totalFailed++;
      }
    } finally {
      this.processing.delete(job.id);
      this.metrics.currentlyProcessing = this.processing.size;
    }

    return true;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.processNext();
    }, this.config.processIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  getPendingCount(): number {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.length;
    }
    return count;
  }

  getJob(id: string): Job | undefined {
    for (const queue of this.queues.values()) {
      const job = queue.find((j) => j.id === id);
      if (job) return job;
    }
    return undefined;
  }
}

export const jobQueue = new PriorityQueue();
