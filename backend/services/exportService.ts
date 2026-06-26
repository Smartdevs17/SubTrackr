/**
 * Incremental export pipeline with change data capture (CDC).
 *
 * Replaces full daily snapshots with watermark-based incremental exports:
 *
 *  1. CDC      — mutations are captured in an ordered, append-only log keyed by
 *                LSN (see subscription/subscriptionEventStore.ts).
 *  2. Watermark — each export channel remembers the last LSN it shipped; the next
 *                run fetches only events beyond it (checkpointed per batch).
 *  3. Formats  — pluggable adapters (CSV / JSON / Parquet) with schema evolution.
 *  4. Idempotency — exporting a fixed LSN window is pure and deterministic, so a
 *                re-run produces byte-identical output (same checksum).
 *  5. Conflicts — bidirectional sync resolves against the external system's state
 *                via a configurable strategy.
 *  6. Reliability — delivery retries with exponential backoff; on exhaustion the
 *                watermark stays at the last fully-delivered batch (no data loss,
 *                no duplication on resume thanks to idempotency keys).
 *
 * Edge cases handled: deleted records (tombstones), schema changes mid-stream
 * (schema version travels with the artifact), large logs (bounded batches), and
 * concurrent runs on the same channel (per-channel lock).
 */

import crypto from 'crypto';
import { ApiResponse, fail, ok } from './shared/apiResponse';
import {
  ChangeEvent,
  EventStore,
  SubscriptionSnapshot,
} from './subscription/subscriptionEventStore';
import {
  CURRENT_EXPORT_SCHEMA,
  ExportFormat,
  ExportRecord,
  ExportSchema,
  SerializedArtifact,
} from './billing/accountingExport/types';
import { getAdapter } from './billing/accountingExport';

// ── Watermark store ────────────────────────────────────────────────────────────

export interface WatermarkStore {
  get(channelId: string): Promise<number>;
  set(channelId: string, lsn: number): Promise<void>;
}

/** Reference in-memory store; swap for PostgreSQL/Redis in production. */
export class InMemoryWatermarkStore implements WatermarkStore {
  private readonly watermarks = new Map<string, number>();
  async get(channelId: string): Promise<number> {
    return this.watermarks.get(channelId) ?? 0;
  }
  async set(channelId: string, lsn: number): Promise<void> {
    this.watermarks.set(channelId, lsn);
  }
}

// ── Delivery sink ────────────────────────────────────────────────────────────

export interface ExportBatch {
  channelId: string;
  fromLsn: number;
  toLsn: number;
  format: ExportFormat;
  artifact: SerializedArtifact;
  /** Stable key so the receiver can dedupe a redelivered batch. */
  idempotencyKey: string;
  checksum: string;
  recordCount: number;
}

export interface ExportSink {
  /** Deliver one batch. Throw to signal failure; `transient` errors are retried. */
  deliver(batch: ExportBatch): Promise<void>;
}

// ── Conflict resolution (bidirectional sync) ───────────────────────────────────

export type ConflictStrategy =
  | 'source-wins' // always overwrite external
  | 'external-wins' // never overwrite an existing external record
  | 'version-wins' // apply only when our version is newer
  | 'last-write-wins'; // apply only when our update is more recent

export interface ExternalRecordState {
  id: string;
  version: number;
  updatedAt: string; // ISO 8601
}

const resolveConflict = (
  record: ExportRecord,
  external: ExternalRecordState | undefined,
  strategy: ConflictStrategy
): boolean => {
  if (!external) return true; // no conflict — external doesn't have it yet
  switch (strategy) {
    case 'source-wins':
      return true;
    case 'external-wins':
      return false;
    case 'version-wins':
      return record.version > external.version;
    case 'last-write-wins':
      return (record.updatedAt ?? '') > external.updatedAt;
    default:
      return true;
  }
};

// ── Metrics ──────────────────────────────────────────────────────────────────

export interface ExportMetrics {
  channelId: string;
  fromLsn: number;
  toLsn: number;
  recordsExported: number;
  conflictsSkipped: number;
  batches: number;
  retries: number;
  errors: number;
  bytesExported: number;
  latencyMs: number;
}

export interface ExportRunResult {
  metrics: ExportMetrics;
  watermark: number;
  /** Per-batch checksums — exposed for idempotency assertions / auditing. */
  checksums: string[];
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 4,
  initialDelayMs: 100,
  backoffFactor: 2,
  maxDelayMs: 5_000,
};

export interface ExportRunOptions {
  channelId: string;
  format: ExportFormat;
  /** Max records per batch (bounds memory for very large logs). */
  batchSize?: number;
  conflictStrategy?: ConflictStrategy;
  /** Snapshot of the external system's records for conflict resolution. */
  externalState?: Map<string, ExternalRecordState>;
  schema?: ExportSchema;
  retry?: Partial<RetryPolicy>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const sha256 = (content: string): string =>
  crypto.createHash('sha256').update(content).digest('hex');

const snapshotToRecord = (
  lsn: number,
  operation: ExportRecord['operation'],
  version: number,
  snapshot: SubscriptionSnapshot
): ExportRecord => ({
  lsn,
  operation,
  id: snapshot.id,
  version,
  merchantId: snapshot.merchantId,
  name: snapshot.name,
  price: snapshot.price,
  currency: snapshot.currency,
  billingCycle: snapshot.billingCycle,
  status: snapshot.status,
  nextBillingDate: snapshot.nextBillingDate,
  createdAt: snapshot.createdAt,
  updatedAt: snapshot.updatedAt,
});

/**
 * Collapse a window of change events to the latest state per entity. Multiple
 * mutations to one row in the same window export once (the final state); a row
 * whose last op is a delete becomes a tombstone. Deterministic ordering by LSN.
 */
export const collapseEvents = (events: ChangeEvent[]): ExportRecord[] => {
  const latestByEntity = new Map<string, ChangeEvent>();
  for (const event of events) {
    latestByEntity.set(event.entityId, event); // events are LSN-ordered, last wins
  }
  const records = Array.from(latestByEntity.values()).map((event) => {
    if (event.operation === 'delete' || event.data === null) {
      return { lsn: event.lsn, operation: 'delete' as const, id: event.entityId, version: event.version };
    }
    return snapshotToRecord(event.lsn, event.operation, event.version, event.data);
  });
  return records.sort((a, b) => a.lsn - b.lsn);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── Service ────────────────────────────────────────────────────────────────────

export class ExportService {
  private readonly retry: RetryPolicy;
  private readonly activeChannels = new Set<string>();

  constructor(
    private readonly eventStore: EventStore,
    private readonly watermarkStore: WatermarkStore,
    private readonly sink: ExportSink,
    private readonly deps: {
      sleepImpl?: (ms: number) => Promise<void>;
      now?: () => number;
      retry?: Partial<RetryPolicy>;
    } = {}
  ) {
    this.retry = { ...DEFAULT_RETRY, ...deps.retry };
  }

  /**
   * Pure, side-effect-free serialization of a fixed LSN window. Same window +
   * same format ⇒ byte-identical artifact (the idempotency guarantee). Does not
   * touch watermarks or the sink.
   */
  exportWindow(
    events: ChangeEvent[],
    format: ExportFormat,
    schema: ExportSchema = CURRENT_EXPORT_SCHEMA,
    options: { conflictStrategy?: ConflictStrategy; externalState?: Map<string, ExternalRecordState> } = {}
  ): { artifact: SerializedArtifact; records: ExportRecord[]; conflictsSkipped: number } {
    const collapsed = collapseEvents(events);
    const strategy = options.conflictStrategy ?? 'source-wins';

    let conflictsSkipped = 0;
    const records = collapsed.filter((record) => {
      const apply = resolveConflict(record, options.externalState?.get(record.id), strategy);
      if (!apply) conflictsSkipped += 1;
      return apply;
    });

    const artifact = getAdapter(format).serialize(records, schema);
    return { artifact, records, conflictsSkipped };
  }

  /** Run an incremental export, checkpointing the watermark per delivered batch. */
  async runIncremental(options: ExportRunOptions): Promise<ApiResponse<ExportRunResult>> {
    const { channelId, format } = options;
    const now = this.deps.now ?? Date.now;
    const sleepImpl = this.deps.sleepImpl ?? sleep;
    const schema = options.schema ?? CURRENT_EXPORT_SCHEMA;
    const batchSize = options.batchSize ?? 1000;

    // Concurrent-run guard: two exports on the same channel would race the
    // watermark and risk gaps/duplicates.
    if (this.activeChannels.has(channelId)) {
      return fail('export_in_progress', `Export already running for channel ${channelId}`, {
        retryable: true,
      });
    }
    this.activeChannels.add(channelId);

    const startedAt = now();
    const startWatermark = await this.watermarkStore.get(channelId);
    const metrics: ExportMetrics = {
      channelId,
      fromLsn: startWatermark,
      toLsn: startWatermark,
      recordsExported: 0,
      conflictsSkipped: 0,
      batches: 0,
      retries: 0,
      errors: 0,
      bytesExported: 0,
      latencyMs: 0,
    };
    const checksums: string[] = [];

    try {
      let cursor = startWatermark;
      // Loop bounded batches until the log is drained.
      for (;;) {
        const { events, nextLsn, hasMore } = this.eventStore.read({
          sinceLsn: cursor,
          limit: batchSize,
        });
        if (events.length === 0) break;

        const { artifact, records, conflictsSkipped } = this.exportWindow(events, format, schema, {
          conflictStrategy: options.conflictStrategy,
          externalState: options.externalState,
        });

        const checksum = sha256(artifact.content);
        const batch: ExportBatch = {
          channelId,
          fromLsn: cursor,
          toLsn: nextLsn,
          format,
          artifact,
          idempotencyKey: `${channelId}:${cursor}:${nextLsn}`,
          checksum,
          recordCount: records.length,
        };

        const delivered = await this.deliverWithRetry(batch, sleepImpl, metrics);
        if (!delivered.ok) {
          // Partial failure: keep watermark at last good batch and report.
          metrics.errors += 1;
          metrics.latencyMs = now() - startedAt;
          return fail('export_delivery_failed', delivered.error.message, {
            retryable: true,
            details: { metrics, lastDeliveredLsn: cursor },
          });
        }

        // Checkpoint only after successful delivery so a crash resumes cleanly.
        await this.watermarkStore.set(channelId, nextLsn);
        cursor = nextLsn;

        metrics.batches += 1;
        metrics.recordsExported += records.length;
        metrics.conflictsSkipped += conflictsSkipped;
        metrics.bytesExported += artifact.byteLength;
        metrics.toLsn = nextLsn;
        checksums.push(checksum);

        if (!hasMore) break;
      }

      metrics.latencyMs = now() - startedAt;
      return ok({ metrics, watermark: cursor, checksums });
    } finally {
      this.activeChannels.delete(channelId);
    }
  }

  private async deliverWithRetry(
    batch: ExportBatch,
    sleepImpl: (ms: number) => Promise<void>,
    metrics: ExportMetrics
  ): Promise<ApiResponse<void>> {
    let attempt = 0;
    let lastError = 'unknown error';
    while (attempt <= this.retry.maxRetries) {
      try {
        await this.sink.deliver(batch);
        return ok(undefined);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt === this.retry.maxRetries) break;
        const delay = Math.min(
          this.retry.initialDelayMs * this.retry.backoffFactor ** attempt,
          this.retry.maxDelayMs
        );
        metrics.retries += 1;
        attempt += 1;
        await sleepImpl(delay);
      }
    }
    return fail('delivery_failed', lastError, { retryable: true });
  }
}
