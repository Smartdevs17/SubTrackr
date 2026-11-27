# Offline-first subscription edits (Issue #1987)

Subscription edits made offline are written to a persisted outbox and pushed
when the engine runs. Each edit carries the server version it was made against.
The server applies it only if that version is still current. Otherwise the
edit is a conflict and is held for the user, not overwritten.

## Usage

```ts
import { SyncEngine, SyncOutbox, createConsoleSyncTelemetry } from '../sync';

const outbox = await SyncOutbox.load(storage); // storage must throw on read failure
const engine = new SyncEngine({
  outbox,
  transport, // implements SyncTransport.pushUpdate
  telemetry: createConsoleSyncTelemetry(),
});

// baseVersion = the version of the record the user was looking at
await engine.enqueueUpdate('sub-1', baseVersion, { price: 12 });

// call on network regain, app foreground, or after an enqueue
const summary = await engine.flush(); // { applied, conflicted, rejected, deferred }

engine.status(); // { state, pending, held, lastError }
```

The caller owns scheduling. Retry delay and backoff are not built in: when
`summary.deferred` is true, call `flush()` again later.

## Conflict policy

Rule: versioned optimistic concurrency with a server-authoritative winner.

- A write made against version N is applied only if the server is at version N.
- Any other server version is a conflict. The server state stays. The local
  edit is held as `version_conflict` with the remote record attached.
- The user then chooses `discardHeld(heldId)` to keep the server state, or
  `reapplyHeld(heldId)` to re-apply the edit on top of it.
- While a record has an unresolved conflict, `enqueueUpdate` for that record
  throws `RecordConflictedError`.

Why not last-writer-wins by device clock: mobile clocks skew and drift while
offline, so "later" is not reliably "newer". LWW also overwrites the other
device's change without a trace. The existing field-level LWW CRDT in
`src/services/cache/crdt.ts` uses this clock-based rule and is not reused here.

Consequence: edits to different fields of one record still conflict if the
version moved. This is a deliberate false positive that never drops a change.

## Behaviour

- **Ordering:** FIFO. A transient failure stops the pass, so later entries wait
  behind it. A version conflict or rejection removes only its own record's
  entries and does not block other records.
- **Coalescing:** a new edit for a record merges into its last pending entry and
  keeps the earliest `baseVersion`. It never merges into an entry that is in
  flight.
- **Rebase:** after an applied push at version V, remaining pending entries for
  the same record with the old base are rebased to V.
- **Retries:** errors use `isRetryableQueryError` from `../queries`. Transport
  errors, 408, 429 and 5xx are transient. Other 4xx are rejected immediately.
  Transient failures are held as `rejected` after `maxAttempts` (default 5).
- **Timeout:** each push gets an `AbortSignal` that fires after 10 s by default.
- **Single flight:** concurrent `flush()` calls share one pass.
- **Protocol checks:** an `applied` version must exceed `baseVersion`. A
  `conflict` must name the same id and a different version. A violation is
  treated as a transient failure, never as success.

## Persistence

- One JSON document under `subtrackr.sync.outbox.v1`.
- Each change is computed on a copy, written, and then committed. A failed
  write leaves memory and storage unchanged.
- `load` throws `OutboxCorruptError` on unreadable data and never overwrites it.
- The in-flight marker is not persisted. After a restart, the entry is pushed
  again. If the server had already applied it, the server reports a conflict
  against the same content, and the user decides.

## Observability

`SyncTelemetry.emit(event)` receives `enqueued`, `push_start`, `push_success`,
`push_conflict`, `push_error`, `held` and `held_resolved`. Each event carries
ids, versions, attempt counts and durations only. Patch values are never
included, because they contain subscription names and prices.
`createConsoleSyncTelemetry()` writes one JSON line per event. `logger.warn`
receives conflicts, rejections and failed pushes.

## Not implemented

- The HTTP write adapter. The query layer's `createHttpSubscriptionApi` is
  GET-only, so no transport exists yet.
- A server contract for versions. The backend subscription mutation handlers
  have no per-record `version` and no `If-Match` or 409 response, so the server
  side is missing.
- Wiring to `NetworkMonitor` or app lifecycle. The `useOfflineSync` hook is
  under `src/hooks`, not `mobile/`, and is not connected.
- Conflict-resolution UI.
- A throwing `SyncStorage` adapter. `asyncStorageAdapter` in
  `src/utils/storage.ts` swallows read errors and returns null, which would make
  an unreadable outbox look empty.

## Tests

```bash
npx jest mobile/src/sync
```

The tests use an in-memory storage and a scripted transport. They cover the
conflict policy, outbox persistence and rebase rules, and the engine's failure
paths: conflict, rejection, transient retry, max attempts, timeout, protocol
violations, single flight, and in-flight coalescing.
