# Sync engine (`backend/sync`)

Server side of offline sync for the CRDT types in `shared/types/crdt.ts`.

## Design

The engine is event-sourced. Every operation and client snapshot a device sends
is appended to a `SyncEventLog` (`eventLog.ts`). Entity state is never stored
directly. `EntityProjection` (`projection.ts`) folds it from the log and caches
the result per entity, so any entity can be rebuilt with `replay()`.

| File | Role |
| --- | --- |
| `eventLog.ts` | `SyncEventLog` interface and `InMemorySyncEventLog` |
| `projection.ts` | Pure reducers (`applyOperation`, `mergeEntityStates`), `replay`, `EntityProjection` |
| `crdtMergeService.ts` | `SyncEngine`, `processSyncRequest`, `handleSyncRequest` |

## Protocol

```
POST body: CRDTSyncRequest  { nodeId, operations, entityStates, since? }
response:  CRDTSyncResponse { remoteOperations, mergedStates, conflicts, syncedAt, cursor }
```

- **Idempotent:** operations are deduplicated by `id`, so a retried batch does
  not double-count counters or duplicate set tags.
- **Catch-up:** store `cursor` from each response and send it back as `since`.
  `remoteOperations` then contains every operation from *other* nodes appended
  after that cursor. Clients that omit `since` instead get the operations on the
  entities they sent that their snapshot clock has not seen.
- **Validation:** `handleSyncRequest` throws `InvalidSyncRequestError` for a
  malformed body or operation. Map it to HTTP 400.

## Observability

- Each request logs `sync.processed` through the PII-safe backend logger, with
  `nodeId`, `opsApplied`, `duplicateOps`, `snapshotsMerged`, `conflicts`,
  `remoteOperations`, `since`, `cursor` and `durationMs`.
- `engine.stats()` returns the running totals.

## Persistence

The process-wide engine uses `InMemorySyncEventLog`, so history is lost on
restart and is not shared across instances. For production, implement
`SyncEventLog` on a database table and pass it to
`createSyncEngine({ log })`. The table needs a monotonic `seq` and a unique
index on the operation id.

## Tests

```bash
npx jest --config jest.backend.config.js backend/sync
```
