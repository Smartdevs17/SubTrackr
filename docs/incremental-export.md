# Incremental Export Pipeline (CDC)

Enterprise integrations (ERP / CRM / accounting) need a steady stream of *changes*
rather than a full daily dump. The export pipeline captures subscription
mutations in an ordered CDC log and ships only what changed since the last
checkpoint, with pluggable formats, idempotency, retries and bidirectional
conflict resolution.

## Pieces

| Concern          | Module                                                        |
| ---------------- | ------------------------------------------------------------- |
| Change capture   | `backend/services/subscription/subscriptionEventStore.ts`     |
| Watermark store  | `backend/services/exportService.ts` (`WatermarkStore`)        |
| Format adapters  | `backend/services/billing/accountingExport/`                  |
| Orchestration    | `backend/services/exportService.ts` (`ExportService`)         |
| Response envelope| `backend/services/shared/apiResponse.ts`                      |

## Change Data Capture

Every insert/update/delete is appended to an append-only log with a strictly
increasing **log sequence number (LSN)**:

```ts
store.append({ operation: 'update', entityId: 's1', occurredAt, data: snapshot });
```

- **Ordered & immutable** — replayable, so reads are deterministic.
- **Tombstones** — deletes are events with `data: null`, so consumers can remove
  records instead of missing them.
- **Versioned** — each entity carries a monotonic `version` for conflict
  resolution.
- **Schema-versioned** — events stamp the schema version for evolution.

The in-memory store is the reference; the `EventStore` interface lets a Postgres
logical-replication / outbox-table backend drop in unchanged.

## Watermarks & incremental runs

Each export channel remembers the last LSN it shipped. A run reads only
`lsn > watermark` and **checkpoints per batch**, so a crash resumes from the last
fully-delivered batch:

```ts
const service = new ExportService(eventStore, watermarkStore, sink);
const result = await service.runIncremental({ channelId: 'erp', format: 'parquet' });
```

Multiple changes to one row in a window collapse to its final state (one record);
a row whose last op is delete becomes a tombstone.

## Formats & schema evolution

Pluggable adapters via a registry (`getAdapter(format)`):

- **CSV** — header row = schema fields (diff to detect evolution).
- **JSON** — self-describing envelope with `schemaVersion`.
- **Parquet** — deterministic columnar layout with typed schema; swap in
  `parquetjs` for true binary output without touching callers.

Adapters are **pure** (no clocks/RNG), which is what makes exports idempotent.

## Idempotency

`exportWindow(events, format)` is side-effect-free: the same LSN window + format
produces a **byte-identical** artifact (verified by sha256 checksum). Batches
carry an `idempotencyKey` (`channel:fromLsn:toLsn`) so a redelivered batch is
deduped by the receiver.

## Conflict resolution (bidirectional sync)

When the external system also mutates synced records, supply a snapshot of its
state and pick a strategy:

| Strategy           | Behavior                                   |
| ------------------ | ------------------------------------------ |
| `source-wins`      | always overwrite external                  |
| `external-wins`    | never overwrite an existing external record|
| `version-wins`     | apply only when our `version` is newer     |
| `last-write-wins`  | apply only when our `updatedAt` is newer   |

Skipped records are counted in `metrics.conflictsSkipped`.

## Reliability & metrics

- **Retry** — delivery retries with exponential backoff (`initialDelayMs`,
  `backoffFactor`, `maxDelayMs`). On exhaustion the run returns a retryable
  failure and the watermark stays at the last good batch — no loss, no dupes.
- **Concurrency** — a per-channel lock rejects overlapping runs
  (`export_in_progress`).
- **Metrics** — every run returns records exported, conflicts skipped, batches,
  retries, errors, bytes, and latency for a dashboard.

## Edge cases covered

Deleted records (tombstones), schema changes mid-stream (version travels with the
artifact), very large logs (bounded `batchSize` batches), and concurrent runs
(per-channel lock). See `backend/services/__tests__/exportService.test.ts` for
executable specs against a mock external sink.
