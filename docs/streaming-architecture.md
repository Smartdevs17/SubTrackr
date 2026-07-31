# Streaming Architecture (Issue #768)

Internal engineering reference for the streaming infrastructure added in issue #768.

---

## Problem Statement

Before this change, all list/export endpoints loaded entire result sets into memory before sending a response. For large merchant datasets (10k+ transaction records) this caused:

- RSS spikes exceeding 500 MB
- GC pressure and latency during export requests
- Mobile clients holding large JSON arrays in JavaScript heap

## Solution Overview

```
┌─────────────────────────┐      NDJSON (chunked)      ┌───────────────────────┐
│  GET /subscriptions/    │ ─────────────────────────► │  streamNdjson()       │
│  stream?limit=100       │                             │  (line-by-line parse) │
└─────────────────────────┘                             └───────────────────────┘

┌─────────────────────────┐        SSE stream          ┌───────────────────────┐
│  GET /exports/stream/   │ ─────────────────────────► │  useExportStream()    │
│  :exportId              │  progress/chunk/complete   │  progress % + URL     │
└─────────────────────────┘                             └───────────────────────┘

┌─────────────────────────┐    Chunked file download   ┌───────────────────────┐
│  GET /exports/download/ │ ─────────────────────────► │  fetch() → save file  │
│  :token                 │                             │                       │
└─────────────────────────┘                             └───────────────────────┘
```

---

## Key Components

### `backend/services/shared/streaming.ts`

Core primitives:

| Export | Purpose |
|---|---|
| `createCursorStream<T>` | Async generator wrapping any `PageFetcher<T>` |
| `collectStream<T>` | Convenience: collect all pages (small datasets only) |
| `encodeOpaqueCursor` | base64url-encode a JSON payload into a cursor token |
| `decodeOpaqueCursor` | Decode a cursor token back to its payload |
| `MemoryMonitor` | Check RSS/heap between chunks; fire callback on threshold |
| `toNdjsonLine` | Serialise one value to `JSON\n` |
| `parseNdjsonBuffer` | Split a string buffer into typed records |

### `backend/services/shared/sseEmitter.ts`

`SseEmitter` wraps `http.ServerResponse` and provides:
- `send(event, data)` — typed SSE event emission
- `progress(data)` / `chunk(data)` / `complete(data)` / `error(data)` — typed helpers
- `ping()` — heartbeat comment to keep proxies alive
- `close()` — graceful stream termination
- Client disconnect handled via `req.on('close', …)`

### Cursor Encoding Scheme

Cursors are `base64url(JSON.stringify(payload))` where `payload` is store-specific:

| Store | Payload |
|---|---|
| In-memory array | `{ offset: number }` |
| PostgreSQL (future) | `{ id: string, createdAt: number }` (keyset) |

The `encodeOpaqueCursor` / `decodeOpaqueCursor` helpers are store-agnostic — swap the payload without changing the HTTP contract.

---

## Memory Budget

| Metric | Target | Monitored by |
|---|---|---|
| Server RSS | ≤ 500 MB | `MemoryMonitor` (warn) |
| Server heap used | ≤ 256 MB | `MemoryMonitor` (warn) |
| Chunk size | 500 records (default) | `chunkSize` option |
| Client JS heap | ≤ platform limit | `getClientMemoryStats()` |

Between each chunk, `setImmediate` is called to yield to the event loop and allow the GC to collect short-lived chunk buffers.

---

## Performance Benchmarks (target)

Benchmarks should be measured with the existing `npm run performance:ci` pipeline.

| Scenario | Target p95 |
|---|---|
| NDJSON stream (10k records, 500/chunk) | < 1 200 ms first byte |
| SSE export progress (5k records) | < 250 ms first `progress` event |
| Chunked download (10k records, CSV) | < 2 000 ms total |
| Memory delta after 10k stream | < 50 MB RSS |

---

## SSE Reconnection Behaviour

- The server sends `retry: 3000` at connection open — browsers/clients will retry after 3 s.
- The server sends `: ping` heartbeats every 15 s to prevent proxy timeouts.
- Each SSE event includes an `id:` field for safe reconnect (client can resume from last seen event in future).
- React Native's `subscribeToSse` in `streamingService.ts` does **not** auto-reconnect — callers are expected to call `startExport()` again if needed.

---

## Testing Strategy

### Unit tests

| File | What is tested |
|---|---|
| `streaming.test.ts` | Cursor encode/decode, async generator page count, MemoryMonitor thresholds, NDJSON helpers |
| `accountingExportService.streaming.test.ts` | `streamExportAsync` JSON/CSV correctness, `streamExportNdjson` per-line, `streamExportWithProgress` monotonic progress |
| `streamingService.test.ts` | `fetchCursorPage` URL construction, `collectAllPages` multi-page, `streamNdjson` line parse + malformed skip, `subscribeToSse` error path |
| `useStreamingList.test.ts` | Idle state, autoLoad, pagination, hasMore guard, error, reset, double-fetch prevention |

### Integration / manual

```bash
# Start server
npm run server:start

# Confirm NDJSON stream
curl --no-buffer "http://localhost:3001/subscriptions/stream?limit=10"

# Watch memory metrics during stream
curl "http://localhost:3001/metrics/memory"

# Confirm SSE events
curl -N "http://localhost:3001/exports/stream/exp_test?format=csv"

# Download export
curl --no-buffer "http://localhost:3001/exports/download/tok_test?format=csv" -o /tmp/test.csv
```

---

## Future Work

- [ ] Replace stub `getTransactionRecordsForMerchant()` in `server.ts` with real Postgres keyset query
- [ ] Keyset cursor payload for Postgres: `{ id: lastId, createdAt: lastCreatedAt }`
- [ ] Persistent export jobs with job ID (queue-backed, resumable SSE)
- [ ] Backpressure: pause generator when the response write buffer is full
- [ ] Rate-limit streaming connections separately from regular requests
