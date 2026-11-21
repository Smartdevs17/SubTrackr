# Soroban event indexer (Issue #2086)

Batched, checkpoint-based scanning of Soroban events. The scanner reduces RPC
tail latency by requesting bounded pages (`batchSize`, default 200) and by
never re-scanning the whole stream after a failure: the durable checkpoint only
advances **after** `onEvents` has persisted the current page.

## Usage

```ts
import { createSorobanEventScanner } from './src/indexer';
import { logger } from './utils/logger';

const scanner = createSorobanEventScanner({
  scanEvents: (cursor, limit) => sorobanRpc.getEvents({ cursor, limit }),
  onEvents: async (events, checkpoint) => {
    await repository.insertEvents(events, checkpoint.cursor);
  },
  checkpointStore: {
    load: () => repository.loadIndexerCheckpoint(),
    save: (checkpoint) => repository.saveIndexerCheckpoint(checkpoint),
  },
  batchSize: 200,
  logger: logger.child('soroban-indexer'),
  onMetrics: (metrics) => promRegistry.set('subtrackr_indexer', metrics),
});

await scanner.start(() => sorobanRpc.getLatestLedger(), 2000);
```

Call `scanner.stop()` on SIGTERM and `scanner.close()` during shutdown.

## Guarantees and failure modes

- **At-least-once delivery.** `onEvents` must be idempotent (keyed by
  `SorobanEvent.id`). A failure after persistence but before the checkpoint
  write replays the same page; the scanner's bounded de-duplication window
  suppresses duplicates within a process, while event ids handle restarts.
- **Retry with backoff.** Each batch gets `maxRetries` attempts with
  exponential delays. Exhausted retries throw `EventScannerError` with a
  `code` of `SCAN_FAILED`, `PERSIST_FAILED`, `CHECKPOINT_FAILED`, or `CLOSED`.
- **Opaque cursors.** Cursors are treated as strings; `encodeCursor` /
  `decodeCursor` / `compareCursors` exist for callers that need ordering.
  The RPC adapter must treat the resume cursor as exclusive.
- **Observability.** Every batch emits debug logs, failures emit warn/error
  logs, and `onMetrics` receives `IndexerMetrics` (batch counts, retries,
  events, de-duplication, lag in ledgers, running state).
