/**
 * Dead Letter Queue (DLQ).
 *
 * Stores jobs that have exhausted all retry attempts so they can be:
 *   - Inspected and replayed manually
 *   - Alerted on (via onDeadLetter callback)
 *   - Purged after a configurable retention window
 *
 * The DLQ is an in-memory ring-buffer backed by BullMQ for durable persistence.
 * Use `getEntries()` for dashboards and `replay()` to re-enqueue a job.
 */

import type { Queue, ConnectionOptions, JobsOptions } from 'bullmq';
import type { PriorityClass, QueueJob } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeadLetterEntry<T = unknown> {
  id: string;
  job: QueueJob<T>;
  failureReason: string;
  attempts: number;
  failedAt: number;
  /** How long (ms) the job was in the queue before being dead-lettered. */
  totalWaitMs: number;
}

export interface DeadLetterQueueConfig {
  /** Max entries to retain in memory. Older entries are evicted. Default: 1000. */
  maxEntries?: number;
  /** Retention period in ms. Entries older than this are pruned. Default: 7 days. */
  retentionMs?: number;
  /** Called whenever a job lands in the DLQ. Use for alerting. */
  onDeadLetter?: (entry: DeadLetterEntry) => void;
  /** Optional BullMQ connection for durable persistence. */
  connection?: ConnectionOptions;
  /** BullMQ queue name for DLQ persistence. Default: 'subtrackr:dlq'. */
  queueName?: string;
  /** Inject mock queue for tests. */
  queueFactory?: (name: string, opts: { connection: ConnectionOptions }) => Pick<Queue, 'add' | 'close'>;
}

// ── DeadLetterQueue ───────────────────────────────────────────────────────────

export class DeadLetterQueue<T = unknown> {
  private readonly entries: DeadLetterEntry<T>[] = [];
  private readonly maxEntries: number;
  private readonly retentionMs: number;
  private readonly onDeadLetter?: (entry: DeadLetterEntry<T>) => void;
  private bullQueue?: Pick<Queue, 'add' | 'close'> | null = null;

  constructor(config: DeadLetterQueueConfig = {}) {
    this.maxEntries = config.maxEntries ?? 1_000;
    this.retentionMs = config.retentionMs ?? 7 * 24 * 60 * 60_000; // 7 days
    this.onDeadLetter = config.onDeadLetter as ((entry: DeadLetterEntry<T>) => void) | undefined;

    if (config.connection) {
      const name = config.queueName ?? 'subtrackr:dlq';
      const factory = config.queueFactory;
      if (factory) {
        this.bullQueue = factory(name, { connection: config.connection });
      } else {
        // Lazy import so this doesn't blow up in non-BullMQ environments
        import('bullmq')
          .then(({ Queue }) => {
            this.bullQueue = new Queue(name, { connection: config.connection! });
          })
          .catch(() => {
            // BullMQ unavailable — DLQ runs in-memory only
          });
      }
    }
  }

  /**
   * Add a failed job to the dead letter queue.
   */
  async add(
    job: QueueJob<T>,
    failureReason: string,
    attempts: number,
  ): Promise<DeadLetterEntry<T>> {
    const entry: DeadLetterEntry<T> = {
      id: `dlq:${job.id}:${Date.now()}`,
      job,
      failureReason,
      attempts,
      failedAt: Date.now(),
      totalWaitMs: Date.now() - job.enqueuedAt,
    };

    // Enforce ring buffer
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Persist to BullMQ if available
    if (this.bullQueue) {
      try {
        await this.bullQueue.add(
          `dlq:${job.name}`,
          { ...entry, jobData: job.data },
          { removeOnComplete: false, removeOnFail: false } as JobsOptions,
        );
      } catch {
        // BullMQ persistence failure is non-fatal for DLQ
      }
    }

    this.onDeadLetter?.(entry);
    return entry;
  }

  /** Get all DLQ entries (most recent last). */
  getEntries(): DeadLetterEntry<T>[] {
    this.pruneStale();
    return [...this.entries];
  }

  /** Get entries filtered by priority class. */
  getEntriesByPriority(priority: PriorityClass): DeadLetterEntry<T>[] {
    return this.getEntries().filter((e) => e.job.priority === priority);
  }

  /** Get entry count. */
  get depth(): number {
    this.pruneStale();
    return this.entries.length;
  }

  /**
   * Remove a DLQ entry by id and return it so it can be re-enqueued.
   * Returns null if not found.
   */
  remove(entryId: string): DeadLetterEntry<T> | null {
    const idx = this.entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return null;
    return this.entries.splice(idx, 1)[0] ?? null;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.length = 0;
  }

  async close(): Promise<void> {
    if (this.bullQueue) {
      await this.bullQueue.close();
    }
  }

  private pruneStale(): void {
    const cutoff = Date.now() - this.retentionMs;
    let i = 0;
    while (i < this.entries.length && (this.entries[i]?.failedAt ?? 0) < cutoff) {
      i++;
    }
    if (i > 0) this.entries.splice(0, i);
  }
}
