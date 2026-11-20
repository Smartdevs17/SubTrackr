# Shared worker Postgres pool (Issue #2089)

`WorkerPoolManager` creates **one** `pg` pool per process and hands the same
instance to every registered worker. Previously each worker module called
`createPool()` itself, so an N-worker process could open N × `max` connections
and exhaust Postgres during bursts.

## Usage

```ts
import { WorkerPoolManager } from './src/workers';

const pools = new WorkerPoolManager({ maxWorkers: 32, drainTimeoutMs: 5000 });

pools.registerWorker('billing-sweeper');
pools.registerWorker('webhook-retry');

await pools.withClient(async (client) => {
  await client.query('SELECT 1');
});

// On SIGTERM: stop accepting work, then let in-flight workers finish.
await Promise.all(workers.map((worker) => worker.stop()));
await pools.close();
```

`getWorkerPoolManager()` / `closeWorkerPoolManager()` provide the process-wide
singleton for callers that do not need dependency injection.

## Guarantees and failure modes

- **Single instance.** Concurrent `getPool()` callers share one creation
  promise; a failed creation clears it so the next call can retry.
- **Bounded registration.** `registerWorker` is idempotent per id and throws
  `WORKER_LIMIT` above `maxWorkers` (default 64).
- **Guaranteed release.** `withClient` always calls `client.release()` in a
  `finally` block and counts acquisitions/releases.
- **Graceful drain.** `close()` waits up to `drainTimeoutMs` for workers to
  unregister, logs a warning on timeout, then calls `pool.end()` exactly once.
- **Observability.** `pool:created`, `worker:registered`,
  `worker:unregistered`, `drain:start`, `error` and `closed` events are emitted,
  and `onMetrics` / `stats()` expose worker counts plus pool saturation.
