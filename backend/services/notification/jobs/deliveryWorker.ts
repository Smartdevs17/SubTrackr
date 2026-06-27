/**
 * Webhook Delivery Worker
 *
 * Polls the webhook delivery retry queue and re-attempts any delivery whose
 * `nextRetryAt` has elapsed (1min, 5min, 15min, 1h, 6h schedule by default).
 * Runs on a fixed interval; safe to call `tick()` concurrently — it dedupes
 * against in-flight retries via the underlying delivery's `nextRetryAt`.
 */

import { WebhookDeliveryService, webhookDeliveryService } from '../webhook';

const DEFAULT_POLL_INTERVAL_MS = 15_000;

export interface DeliveryWorkerMetrics {
  ticks: number;
  retriesProcessed: number;
  lastTickAt: number | null;
  lastError: string | null;
}

export class DeliveryWorker {
  private readonly service: WebhookDeliveryService;
  private readonly pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTicking = false;
  private metrics: DeliveryWorkerMetrics = {
    ticks: 0,
    retriesProcessed: 0,
    lastTickAt: null,
    lastError: null,
  };

  constructor(service: WebhookDeliveryService = webhookDeliveryService, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
    this.service = service;
    this.pollIntervalMs = pollIntervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Processes one batch of due retries. Skips overlapping ticks. */
  async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const results = await this.service.processDueRetries();
      this.metrics.ticks += 1;
      this.metrics.retriesProcessed += results.length;
      this.metrics.lastTickAt = Date.now();
      this.metrics.lastError = null;
    } catch (error) {
      this.metrics.lastError = error instanceof Error ? error.message : 'Delivery worker tick failed';
    } finally {
      this.isTicking = false;
    }
  }

  getMetrics(): DeliveryWorkerMetrics {
    return { ...this.metrics };
  }
}

export const deliveryWorker = new DeliveryWorker();
