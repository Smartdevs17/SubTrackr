/**
 * Notification retry service with backoff and dead-lettering (#1753)
 *
 * Notification sends (push, email, SMS, in-app) used to be fire-and-forget:
 * a transport that threw was logged and dropped. This service wraps a
 * transport with exponential backoff retries, a dead-letter queue for
 * permanent failures, and a metrics snapshot so dashboards can surface the
 * failure patterns that used to be invisible.
 *
 * It reuses the shared `RetryPolicy` (full-jitter exponential backoff) and
 * `DeadLetterQueue` from `backend/shared/queue` so behaviour matches the rest
 * of the platform's job pipeline.
 *
 * Usage
 * ─────
 *   const retryService = new NotificationRetryService(emailTransport, {
 *     channel: 'email',
 *     retryPolicy: new RetryPolicy({ maxAttempts: { normal: 5 } }),
 *   });
 *   const result = await retryService.send({ recipient, subject, body });
 *   if (result.status === 'dead_lettered') { /* alert ops *\/ }
 *   const metrics = retryService.getMetrics();
 */

import { RetryPolicy } from '../../shared/queue/retryPolicy';
import { DeadLetterQueue } from '../../shared/queue/deadLetterQueue';
import type { PriorityClass } from '../../shared/queue/types';

/** A message handed to a channel transport. Mirrors ChannelTransport's payload. */
export interface NotificationMessage {
  recipient: string;
  subject?: string;
  body: string;
  /** Arbitrary metadata for tracing / correlation. */
  metadata?: Record<string, string>;
}

export type NotificationChannel = 'push' | 'email' | 'sms' | 'in_app';

/**
 * A transport sends one message on one channel and resolves to `true` when
 * the downstream provider accepted it. Resolving `false` or throwing counts
 * as a failure eligible for retry.
 */
export type NotificationTransport = (message: NotificationMessage) => Promise<boolean>;

export type SendOutcome = 'delivered' | 'failed' | 'dead_lettered';

export interface SendResult {
  status: SendOutcome;
  attempts: number;
  /** Total wall-clock time spent on the send, including backoff sleeps. */
  elapsedMs: number;
  /** Present when the send failed or was dead-lettered. */
  error?: string;
  /** DLQ entry id when `status === 'dead_lettered'`. */
  deadLetterEntryId?: string;
}

export interface NotificationRetryMetrics {
  channel: NotificationChannel;
  totalSendAttempts: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  retryCount: number;
  /** Average attempts across all send calls (1 = first-try success). */
  avgAttempts: number;
  lastDeliveredAt: number | null;
  lastFailedAt: number | null;
  lastError: string | null;
  dlqDepth: number;
}

export interface NotificationRetryConfig {
  channel: NotificationChannel;
  /** Defaults to a fresh RetryPolicy. */
  retryPolicy?: RetryPolicy;
  /** Priority class used to look up max attempts. Default: 'normal'. */
  priority?: PriorityClass;
  /** Defaults to a new in-memory DeadLetterQueue. */
  deadLetterQueue?: DeadLetterQueue;
  /** Injected sleep for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected clock for tests. Defaults to Date.now. */
  now?: () => number;
}

const DEFAULT_SLEEP: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class NotificationRetryService {
  private readonly transport: NotificationTransport;
  private readonly channel: NotificationChannel;
  private readonly retryPolicy: RetryPolicy;
  private readonly priority: PriorityClass;
  private readonly dlq: DeadLetterQueue;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  // Metrics counters
  private totalSendAttempts = 0;
  private delivered = 0;
  private failed = 0;
  private deadLettered = 0;
  private retryCount = 0;
  private totalAttemptsAcrossSends = 0;
  private lastDeliveredAt: number | null = null;
  private lastFailedAt: number | null = null;
  private lastError: string | null = null;

  constructor(transport: NotificationTransport, config: NotificationRetryConfig) {
    this.transport = transport;
    this.channel = config.channel;
    this.retryPolicy = config.retryPolicy ?? new RetryPolicy();
    this.priority = config.priority ?? 'normal';
    this.dlq = config.deadLetterQueue ?? new DeadLetterQueue({ maxEntries: 2_000 });
    this.sleep = config.sleep ?? DEFAULT_SLEEP;
    this.now = config.now ?? Date.now;
  }

  /**
   * Send a notification, retrying transient failures with exponential backoff.
   * Permanent failures (after exhausting retries) are dead-lettered.
   */
  async send(message: NotificationMessage): Promise<SendResult> {
    const startedAt = this.now();
    let attempt = 0;
    let lastError: string | undefined;

    // attempt = number of attempts already made (0-indexed for RetryPolicy.decide)
    while (true) {
      attempt += 1;
      this.totalSendAttempts += 1;
      this.totalAttemptsAcrossSends += 1;

      try {
        const accepted = await this.transport(message);
        if (accepted) {
          this.delivered += 1;
          this.lastDeliveredAt = this.now();
          this.lastError = null;
          return {
            status: 'delivered',
            attempts: attempt,
            elapsedMs: this.now() - startedAt,
          };
        }
        // Transport resolved false — treat as a recoverable failure.
        lastError = 'Transport rejected the message';
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Notification transport threw';
      }

      // Ask the retry policy whether to retry and how long to wait.
      // `attempt` here is the number of attempts already made, which is what
      // RetryPolicy.decide expects (0 = first failure).
      const decision = this.retryPolicy.decide(this.priority, attempt, new Error(lastError));
      if (!decision.shouldRetry) {
        // Permanently failed — dead-letter it.
        const entry = await this.dlq.add(
          {
            id: `notif:${this.channel}:${startedAt}:${Math.random().toString(36).slice(2, 8)}`,
            name: `notification:${this.channel}`,
            data: { message, lastError },
            priority: this.priority,
            enqueuedAt: startedAt,
          },
          lastError,
          attempt,
        );
        this.failed += 1;
        this.deadLettered += 1;
        this.lastFailedAt = this.now();
        this.lastError = lastError;
        return {
          status: 'dead_lettered',
          attempts: attempt,
          elapsedMs: this.now() - startedAt,
          error: lastError,
          deadLetterEntryId: entry.id,
        };
      }

      // Backoff before the next attempt.
      this.retryCount += 1;
      await this.sleep(decision.delayMs);
    }
  }

  /** Snapshot of delivery metrics for dashboards and alerting. */
  getMetrics(): NotificationRetryMetrics {
    const totalSends = this.delivered + this.failed;
    return {
      channel: this.channel,
      totalSendAttempts: this.totalSendAttempts,
      delivered: this.delivered,
      failed: this.failed,
      deadLettered: this.deadLettered,
      retryCount: this.retryCount,
      avgAttempts: totalSends > 0 ? this.totalAttemptsAcrossSends / totalSends : 0,
      lastDeliveredAt: this.lastDeliveredAt,
      lastFailedAt: this.lastFailedAt,
      lastError: this.lastError,
      dlqDepth: this.dlq.depth,
    };
  }

  /** Expose the DLQ for inspection / manual replay. */
  getDeadLetterQueue(): DeadLetterQueue {
    return this.dlq;
  }

  /** List dead-lettered entries for this channel's dashboard. */
  listDeadLetters() {
    return this.dlq.getEntries();
  }

  /** Reset all counters (useful for tests). Does not clear the DLQ. */
  resetMetrics(): void {
    this.totalSendAttempts = 0;
    this.delivered = 0;
    this.failed = 0;
    this.deadLettered = 0;
    this.retryCount = 0;
    this.totalAttemptsAcrossSends = 0;
    this.lastDeliveredAt = null;
    this.lastFailedAt = null;
    this.lastError = null;
  }
}
