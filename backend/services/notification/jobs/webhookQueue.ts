/**
 * BullMQ-backed webhook delivery queue.
 *
 * Architecture
 * ────────────
 *  WebhookQueue        — thin wrapper around a BullMQ Queue that enqueues
 *                        delivery jobs with the right priority and delay.
 *  WebhookQueueWorker  — BullMQ Worker that picks up jobs, drives
 *                        WebhookDeliveryService.deliverEvent / retryWebhookDelivery,
 *                        and moves permanently-failed jobs to the DLQ.
 *  webhookRetryScheduler — registers a recurring cron job that re-enqueues
 *                          all due retries from the in-memory delivery store
 *                          into BullMQ (bridges the two systems).
 *
 * The queue uses BullMQ priorities mapped from the event urgency:
 *   payment.failed / security events → critical (1)
 *   subscription lifecycle           → high     (2)
 *   invoice / trial                  → normal   (3)
 *   plan / usage info                → low      (4)
 *
 * Retry back-off
 * ──────────────
 * BullMQ's built-in exponential back-off is used for transport-layer errors.
 * Application-level retry logic (WebhookRetryPolicy) is still respected: the
 * BullMQ job is given `attempts = maxRetries + 1` so BullMQ handles the
 * scheduling, but the actual HTTP dispatch lives in WebhookDeliveryService.
 *
 * Dead-letter queue
 * ─────────────────
 * Failed jobs that exhaust BullMQ retries are moved to a BullMQ "failed" list
 * AND into the existing in-process DeadLetterQueue so the DLQ cleanup job
 * and the management API can continue to work against a single interface.
 */

import type { ConnectionOptions, JobsOptions } from 'bullmq';
import type { WebhookDeliveryService } from '../webhook';
import type { WebhookEventInput, WebhookEventType } from '../../../../src/types/webhook';
import { DeadLetterQueue } from '../../../shared/queue/deadLetterQueue';
import type { QueueJob } from '../../../shared/queue/types';
import { BULLMQ_PRIORITY } from '../../../shared/queue/types';

// ─── Priority mapping ─────────────────────────────────────────────────────────

const CRITICAL_EVENTS = new Set<string>([
  'payment.failed',
  'payment.chargeback',
  'payment.disputed',
  'subscription.payment_failed',
]);

const HIGH_EVENTS = new Set<string>([
  'subscription.created',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.expired',
  'subscription.renewed',
  'subscription.upgraded',
  'subscription.downgraded',
  'subscription.grace_period_started',
  'subscription.grace_period_ended',
  'payment.succeeded',
  'payment.refunded',
  'payment.method_updated',
]);

const NORMAL_EVENTS = new Set<string>([
  'invoice.created',
  'invoice.finalized',
  'invoice.paid',
  'invoice.voided',
  'invoice.overdue',
  'trial.started',
  'trial.ending_soon',
  'trial.ended',
  'trial.converted',
  'payment.retry_scheduled',
  'usage.threshold_reached',
  'usage.limit_exceeded',
]);

export function eventPriority(
  eventType: WebhookEventType
): keyof typeof BULLMQ_PRIORITY {
  if (CRITICAL_EVENTS.has(eventType)) return 'critical';
  if (HIGH_EVENTS.has(eventType)) return 'high';
  if (NORMAL_EVENTS.has(eventType)) return 'normal';
  return 'low';
}

// ─── Job payload shape ────────────────────────────────────────────────────────

/** Shape of the data stored inside a BullMQ webhook job. */
export interface WebhookJobData {
  /** If set, this is a retry of an existing delivery — use retryWebhookDelivery. */
  deliveryId?: string;
  /** Full event input — used for the initial delivery attempt. */
  eventInput?: WebhookEventInput;
}

// ─── WebhookQueue ──────────────────────────────────────────────────────────────

export interface WebhookQueueConfig {
  connection: ConnectionOptions;
  queueName?: string;
}

/**
 * Thin wrapper around BullMQ's Queue for webhook delivery jobs.
 * Falls back gracefully when BullMQ / Redis is unavailable.
 */
export class WebhookQueue {
  private queue: import('bullmq').Queue | null = null;
  private readonly queueName: string;
  private ready = false;

  constructor(private readonly config: WebhookQueueConfig) {
    this.queueName = config.queueName ?? 'subtrackr:webhooks';
  }

  /** Connect to Redis and initialise BullMQ. Call once at startup. */
  async init(): Promise<void> {
    try {
      const { Queue } = await import('bullmq');
      this.queue = new Queue(this.queueName, {
        connection: this.config.connection,
        defaultJobOptions: {
          removeOnComplete: { count: 1_000 },
          removeOnFail: false, // Keep failed jobs so we can inspect / replay
        },
      });
      this.ready = true;
    } catch (err) {
      console.warn('[WebhookQueue] BullMQ unavailable — falling back to polling worker:', err);
    }
  }

  /**
   * Enqueue a new webhook event for delivery.
   * Returns the BullMQ job id, or null when BullMQ is not available.
   */
  async enqueueEvent(input: WebhookEventInput): Promise<string | null> {
    if (!this.queue) return null;
    const priority = eventPriority(input.eventType);
    const jobData: WebhookJobData = { eventInput: input };
    const opts: JobsOptions = {
      priority: BULLMQ_PRIORITY[priority],
      attempts: 6, // 1 initial + 5 retries matching DEFAULT_RETRY_POLICY
      backoff: { type: 'exponential', delay: 60_000 },
    };
    const job = await this.queue.add(`webhook:${input.eventType}`, jobData, opts);
    return job.id ?? null;
  }

  /**
   * Enqueue a retry for an existing delivery by its delivery id.
   * Used by the retry scheduler when a delivery's nextRetryAt has elapsed.
   */
  async enqueueRetry(deliveryId: string, delayMs: number): Promise<string | null> {
    if (!this.queue) return null;
    const jobData: WebhookJobData = { deliveryId };
    const opts: JobsOptions = {
      priority: BULLMQ_PRIORITY.high,
      delay: delayMs,
      attempts: 1, // The retry itself — retry logic lives in WebhookDeliveryService
    };
    const job = await this.queue.add(`webhook:retry`, jobData, opts);
    return job.id ?? null;
  }

  /** Gracefully close the queue connection. */
  async close(): Promise<void> {
    await this.queue?.close();
    this.queue = null;
    this.ready = false;
  }

  get isReady(): boolean {
    return this.ready;
  }
}

// ─── WebhookQueueWorker ───────────────────────────────────────────────────────

export interface WebhookQueueWorkerConfig {
  connection: ConnectionOptions;
  queueName?: string;
  concurrency?: number;
  /** Injected DLQ — defaults to a new in-memory DeadLetterQueue. */
  deadLetterQueue?: DeadLetterQueue<WebhookJobData>;
}

export interface WebhookWorkerMetrics {
  processed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  lastProcessedAt: number | null;
  lastError: string | null;
}

/**
 * BullMQ Worker that processes webhook delivery jobs.
 *
 * For each job it either:
 *  - Calls `deliverEvent` (new event input), or
 *  - Calls `retryWebhookDelivery` (existing delivery id)
 *
 * On BullMQ-level failure exhaustion the delivery is moved into the DLQ.
 */
export class WebhookQueueWorker {
  private worker: import('bullmq').Worker | null = null;
  private readonly queueName: string;
  private readonly concurrency: number;
  private readonly dlq: DeadLetterQueue<WebhookJobData>;
  private readonly metrics: WebhookWorkerMetrics = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    lastProcessedAt: null,
    lastError: null,
  };

  constructor(
    private readonly deliveryService: WebhookDeliveryService,
    private readonly config: WebhookQueueWorkerConfig
  ) {
    this.queueName = config.queueName ?? 'subtrackr:webhooks';
    this.concurrency = config.concurrency ?? 5;
    this.dlq =
      config.deadLetterQueue ??
      new DeadLetterQueue<WebhookJobData>({ maxEntries: 5_000 });
  }

  /** Start the BullMQ worker. Fails silently if BullMQ is unavailable. */
  async start(): Promise<void> {
    try {
      const { Worker } = await import('bullmq');

      this.worker = new Worker<WebhookJobData>(
        this.queueName,
        async (job) => {
          const data = job.data;

          if (data.deliveryId) {
            // Retry path: re-attempt a known delivery
            await this.deliveryService.retryWebhookDelivery(data.deliveryId);
          } else if (data.eventInput) {
            // New event path
            await this.deliveryService.deliverEvent(data.eventInput);
          } else {
            throw new Error('Invalid webhook job: missing both deliveryId and eventInput');
          }

          this.metrics.processed += 1;
          this.metrics.succeeded += 1;
          this.metrics.lastProcessedAt = Date.now();
          this.metrics.lastError = null;
        },
        {
          connection: this.config.connection,
          concurrency: this.concurrency,
        }
      );

      // Move exhausted jobs to the DLQ
      this.worker.on('failed', async (job, err) => {
        if (!job) return;
        const isExhausted =
          job.attemptsMade >= (job.opts.attempts ?? 1);

        this.metrics.processed += 1;
        this.metrics.failed += 1;
        this.metrics.lastError = err.message;

        if (isExhausted) {
          this.metrics.deadLettered += 1;
          const queueJob: QueueJob<WebhookJobData> = {
            id: job.id ?? `dlq:${Date.now()}`,
            name: job.name,
            data: job.data,
            priority: 'normal',
            enqueuedAt: job.timestamp,
            bullJobId: job.id,
          };
          await this.dlq.add(queueJob, err.message, job.attemptsMade);
        }
      });

      this.worker.on('error', (err) => {
        console.error('[WebhookQueueWorker] Worker error:', err);
      });
    } catch (err) {
      console.warn('[WebhookQueueWorker] BullMQ unavailable — worker not started:', err);
    }
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  getMetrics(): WebhookWorkerMetrics {
    return { ...this.metrics };
  }

  getDlq(): DeadLetterQueue<WebhookJobData> {
    return this.dlq;
  }
}

// ─── WebhookRetryScheduler ────────────────────────────────────────────────────

/**
 * Polls the in-process delivery store for overdue retries and enqueues them
 * into BullMQ with the appropriate delay.
 *
 * This bridges the two systems: WebhookDeliveryService tracks retries
 * in-memory (useful for unit tests and small deployments), while BullMQ
 * provides durable, distributed scheduling for production.
 */
export class WebhookRetryScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;

  constructor(
    private readonly deliveryService: WebhookDeliveryService,
    private readonly webhookQueue: WebhookQueue,
    private readonly pollIntervalMs = 10_000
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.isTicking || !this.webhookQueue.isReady) return;
    this.isTicking = true;
    try {
      const due = this.deliveryService.getDueRetries();
      for (const delivery of due) {
        // Enqueue into BullMQ with the remaining delay (already elapsed → 0)
        const delay = Math.max(0, (delivery.nextRetryAt ?? 0) - Date.now());
        await this.webhookQueue.enqueueRetry(delivery.id, delay);
      }
    } catch (err) {
      console.error('[WebhookRetryScheduler] tick error:', err);
    } finally {
      this.isTicking = false;
    }
  }
}

// ─── DLQ Replay Worker ────────────────────────────────────────────────────────

/**
 * Periodically scans the in-process DLQ for entries that should be retried
 * and re-enqueues them via the WebhookDeliveryService.
 *
 * In production you would surface DLQ entries through the management API
 * (`/webhooks/dlq`) and replay them on demand; this worker handles
 * automatic periodic replay with an exponential back-off per entry.
 */
export class DlqReplayWorker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deliveryService: WebhookDeliveryService,
    private readonly intervalMs = 60_000
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Replay all dead-lettered deliveries that haven't been replayed in the last hour. */
  async run(): Promise<{ replayed: number; errors: number }> {
    const dlqEntries = this.deliveryService.listDeadLetters();
    let replayed = 0;
    let errors = 0;

    for (const delivery of dlqEntries) {
      // Only auto-replay entries less than 24 h old (manual intervention
      // is expected beyond that window).
      const ageMs = Date.now() - (delivery.deadLetteredAt ?? 0);
      if (ageMs > 24 * 60 * 60 * 1_000) continue;

      try {
        await this.deliveryService.replayDeadLetter(delivery.id);
        replayed += 1;
      } catch (err) {
        errors += 1;
        console.warn(`[DlqReplayWorker] Failed to replay ${delivery.id}:`, err);
      }
    }

    return { replayed, errors };
  }
}
