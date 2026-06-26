/**
 * Webhook DLQ Cleanup Job
 *
 * Nightly housekeeping for the webhook delivery subsystem:
 *  - purges dead-lettered deliveries past their retention window (default 30 days)
 *  - purges expired idempotency keys past the 24h dedup window
 *
 * Mirrors the start/stop + metrics shape used by other backend cron jobs
 * (see backend/analytics/jobs/mvRefreshJob.ts).
 */

import { WebhookDeliveryService, webhookDeliveryService } from '../webhook';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000; // nightly

export interface DlqCleanupMetrics {
  runs: number;
  deadLettersPurged: number;
  idempotencyKeysPurged: number;
  lastRunAt: number | null;
  lastError: string | null;
}

export class DlqCleanupJob {
  private readonly service: WebhookDeliveryService;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private metrics: DlqCleanupMetrics = {
    runs: 0,
    deadLettersPurged: 0,
    idempotencyKeysPurged: 0,
    lastRunAt: null,
    lastError: null,
  };

  constructor(service: WebhookDeliveryService = webhookDeliveryService, intervalMs = DEFAULT_INTERVAL_MS) {
    this.service = service;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    try {
      const deadLettersPurged = this.service.cleanupDeadLetters();
      const idempotencyKeysPurged = this.service.cleanupExpiredIdempotencyKeys();
      this.metrics.runs += 1;
      this.metrics.deadLettersPurged += deadLettersPurged;
      this.metrics.idempotencyKeysPurged += idempotencyKeysPurged;
      this.metrics.lastRunAt = Date.now();
      this.metrics.lastError = null;
    } catch (error) {
      this.metrics.lastError = error instanceof Error ? error.message : 'DLQ cleanup run failed';
    }
  }

  getMetrics(): DlqCleanupMetrics {
    return { ...this.metrics };
  }
}

export const dlqCleanupJob = new DlqCleanupJob();
