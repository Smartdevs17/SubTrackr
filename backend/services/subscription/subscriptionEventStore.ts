/**
 * Change Data Capture (CDC) log for subscription mutations.
 *
 * Every insert/update/delete is appended as an immutable event with a strictly
 * increasing **log sequence number (LSN)**. The LSN is the watermark primitive:
 * incremental exports remember the last LSN they consumed and fetch only events
 * with a higher LSN, so we never re-scan the whole table.
 *
 * Key properties:
 *  - Ordered & immutable — events are append-only and totally ordered by LSN, so
 *    reading "since watermark" is deterministic and replayable (idempotency).
 *  - Tombstones — deletes are recorded as events (data = null) so downstream
 *    systems can remove the record instead of silently missing it.
 *  - Versioned rows — each entity carries a monotonically increasing version for
 *    optimistic concurrency / bidirectional conflict resolution.
 *  - Schema-versioned — every event stamps the schema version it was written
 *    with, enabling schema evolution mid-stream.
 *
 * The in-memory implementation is the reference; the `EventStore` interface lets
 * a PostgreSQL logical-replication or outbox-table backend drop in unchanged.
 */

export type ChangeOperation = 'insert' | 'update' | 'delete';

/** Serializable snapshot of a subscription row at the time of the change. */
export interface SubscriptionSnapshot {
  id: string;
  merchantId: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
  status: string;
  nextBillingDate: string; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  [extra: string]: string | number | boolean | null | undefined;
}

export interface ChangeEvent {
  /** Strictly increasing, globally ordered log sequence number. */
  lsn: number;
  operation: ChangeOperation;
  entityId: string;
  occurredAt: number; // epoch ms — set once at append, never mutated
  /** Row snapshot after the change; null for deletes (tombstone). */
  data: SubscriptionSnapshot | null;
  /** Monotonic per-entity version for conflict resolution. */
  version: number;
  /** Schema version the event was written with (for schema evolution). */
  schemaVersion: number;
}

export interface AppendInput {
  operation: ChangeOperation;
  entityId: string;
  occurredAt: number;
  data: SubscriptionSnapshot | null;
}

export interface ReadOptions {
  /** Exclusive lower bound — return events with lsn > sinceLsn. */
  sinceLsn: number;
  /** Max events to return; enables bounded batches over very large logs. */
  limit?: number;
}

export interface ReadResult {
  events: ChangeEvent[];
  /** Highest LSN in this batch — the next watermark. Equals sinceLsn if empty. */
  nextLsn: number;
  /** True when more events exist beyond this batch (limit was hit). */
  hasMore: boolean;
}

export interface EventStore {
  append(input: AppendInput): ChangeEvent;
  read(options: ReadOptions): ReadResult;
  /** Highest LSN currently in the log (0 when empty). */
  headLsn(): number;
}

export const CURRENT_SCHEMA_VERSION = 1;

export class InMemorySubscriptionEventStore implements EventStore {
  private readonly events: ChangeEvent[] = [];
  private lsnCounter = 0;
  private readonly versions = new Map<string, number>();

  append(input: AppendInput): ChangeEvent {
    this.lsnCounter += 1;
    const version = (this.versions.get(input.entityId) ?? 0) + 1;
    this.versions.set(input.entityId, version);

    const event: ChangeEvent = {
      lsn: this.lsnCounter,
      operation: input.operation,
      entityId: input.entityId,
      occurredAt: input.occurredAt,
      data: input.data,
      version,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    this.events.push(event);
    return event;
  }

  read(options: ReadOptions): ReadResult {
    const { sinceLsn, limit } = options;
    // Events are appended in LSN order, so a filtered slice is already ordered.
    const matching = this.events.filter((e) => e.lsn > sinceLsn);
    const bounded = limit !== undefined ? matching.slice(0, Math.max(0, limit)) : matching;
    const hasMore = bounded.length < matching.length;
    const nextLsn = bounded.length > 0 ? bounded[bounded.length - 1].lsn : sinceLsn;
    return { events: bounded, nextLsn, hasMore };
  }

  headLsn(): number {
    return this.lsnCounter;
  }
}
