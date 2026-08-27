/**
 * Background Job Processing with Priority Queues — SubTrackr
 *
 * In-memory priority queue for background job processing
 * with concurrency control, retry logic, and monitoring.
 */

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';

export type JobPriority = 'critical' | 'high' | 'medium' | 'low' | 'bulk';

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  retryDelayMs: number;
  timeoutMs: number;
  metadata: Record<string, unknown>;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

export interface QueueConfig {
  maxConcurrency: number;
  defaultTimeoutMs: number;
  defaultRetryDelayMs: number;
  maxRetries: number;
  jobTtlMs: number;
}

export interface QueueMetrics {
  totalJobs: number;
  pendingJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageWaitMs: number;
  averageProcessMs: number;
  throughputPerMinute: number;
}

const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
  bulk: 10,
};

const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxConcurrency: 5,
  defaultTimeoutMs: 30000,
  defaultRetryDelayMs: 1000,
  maxRetries: 3,
  jobTtlMs: 24 * 60 * 60 * 1000,
};

let jobCounter = 0;

export class PriorityQueue<T = unknown> {
  private jobs = new Map<string, Job<T>>();
  private waiting: string[] = [];
  private running = new Set<string>();
  private handlers = new Map<string, JobHandler<T>>();
  private config: QueueConfig;
  private processing = false;

  private totalCompleted = 0;
  private totalFailed = 0;
  private waitTimes: number[] = [];
  private processTimes: number[] = [];

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  registerHandler(jobType: string, handler: JobHandler<T>): void {
    this.handlers.set(jobType, handler);
  }

  enqueue(
    type: string,
    payload: T,
    options: {
      priority?: JobPriority;
      maxAttempts?: number;
      timeoutMs?: number;
      retryDelayMs?: number;
      metadata?: Record<string, unknown>;
    } = {},
  ): Job<T> {
    const id = `job_${++jobCounter}_${Date.now().toString(36)}`;
    const job: Job<T> = {
      id,
      type,
      payload,
      priority: options.priority ?? 'medium',
      status: 'pending',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.maxRetries,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      error: null,
      retryDelayMs: options.retryDelayMs ?? this.config.defaultRetryDelayMs,
      timeoutMs: options.timeoutMs ?? this.config.defaultTimeoutMs,
      metadata: options.metadata ?? {},
    };

    this.jobs.set(id, job);
    this.insertByPriority(id, job.priority);
    this.processNext();
    return job;
  }

  private insertByPriority(id: string, priority: JobPriority): void {
    const weight = PRIORITY_WEIGHTS[priority];
    let inserted = false;

    for (let i = 0; i < this.waiting.length; i++) {
      const existing = this.jobs.get(this.waiting[i]);
      if (existing && PRIORITY_WEIGHTS[existing.priority] < weight) {
        this.waiting.splice(i, 0, id);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.waiting.push(id);
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    if (this.running.size >= this.config.maxConcurrency) return;
    if (this.waiting.length === 0) return;

    this.processing = true;

    while (this.waiting.length > 0 && this.running.size < this.config.maxConcurrency) {
      const jobId = this.waiting.shift()!;
      const job = this.jobs.get(jobId);
      if (!job || job.status !== 'pending') continue;

      this.running.add(jobId);
      this.processJob(job).finally(() => {
        this.running.delete(jobId);
        this.processNext();
      });
    }

    this.processing = false;
  }

  private async processJob(job: Job<T>): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = 'failed';
      job.error = `No handler registered for job type: ${job.type}`;
      job.completedAt = Date.now();
      this.totalFailed++;
      return;
    }

    job.status = 'running';
    job.startedAt = Date.now();
    job.attempts += 1;

    const waitTime = job.startedAt - job.createdAt;
    this.waitTimes.push(waitTime);
    if (this.waitTimes.length > 1000) this.waitTimes.shift();

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Job timed out after ${job.timeoutMs}ms`)), job.timeoutMs);
      });

      await Promise.race([handler(job), timeoutPromise]);

      job.status = 'completed';
      job.completedAt = Date.now();
      this.totalCompleted++;

      const processTime = job.completedAt - job.startedAt;
      this.processTimes.push(processTime);
      if (this.processTimes.length > 1000) this.processTimes.shift();
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);

      if (job.attempts < job.maxAttempts) {
        job.status = 'retrying';
        setTimeout(() => {
          job.status = 'pending';
          this.insertByPriority(job.id, job.priority);
          this.processNext();
        }, job.retryDelayMs);
      } else {
        job.status = 'failed';
        job.completedAt = Date.now();
        this.totalFailed++;
      }
    }
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'pending') {
      const idx = this.waiting.indexOf(jobId);
      if (idx !== -1) this.waiting.splice(idx, 1);
    }

    job.status = 'cancelled';
    job.completedAt = Date.now();
    return true;
  }

  getJob(jobId: string): Job<T> | undefined {
    return this.jobs.get(jobId);
  }

  getJobsByStatus(status: JobStatus): Job<T>[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === status);
  }

  getMetrics(): QueueMetrics {
    const pending = this.getJobsByStatus('pending').length + this.getJobsByStatus('retrying').length;
    const running = this.running.size;
    const completed = this.totalCompleted;
    const failed = this.totalFailed;
    const total = pending + running + completed + failed;

    const avgWait = this.waitTimes.length > 0
      ? this.waitTimes.reduce((a, b) => a + b, 0) / this.waitTimes.length
      : 0;
    const avgProcess = this.processTimes.length > 0
      ? this.processTimes.reduce((a, b) => a + b, 0) / this.processTimes.length
      : 0;

    const recentCompleted = this.processTimes.filter(
      (t) => t > Date.now() - 60000,
    ).length;

    return {
      totalJobs: total,
      pendingJobs: pending,
      runningJobs: running,
      completedJobs: completed,
      failedJobs: failed,
      averageWaitMs: Math.round(avgWait),
      averageProcessMs: Math.round(avgProcess),
      throughputPerMinute: recentCompleted,
    };
  }

  purge(): number {
    const before = this.jobs.size;
    for (const [id, job] of this.jobs) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        this.jobs.delete(id);
      }
    }
    return before - this.jobs.size;
  }
}

export const jobQueue = new PriorityQueue();
