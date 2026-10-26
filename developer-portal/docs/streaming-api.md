# Streaming API Reference

This document describes the streaming endpoints added in **Issue #768** to address memory pressure when working with large datasets.

---

## Overview

SubTrackr exposes three streaming patterns:

| Pattern | Protocol | Endpoint |
|---|---|---|
| **NDJSON list stream** | HTTP chunked transfer | `GET /subscriptions/stream` |
| **Export progress** | Server-Sent Events (SSE) | `GET /exports/stream/:exportId` |
| **File download** | HTTP chunked transfer | `GET /exports/download/:token` |
| **Memory metrics** | JSON | `GET /metrics/memory` |

---

## NDJSON Streaming — `GET /subscriptions/stream`

Returns transaction records as Newline-Delimited JSON (NDJSON). Each line is a self-contained JSON object. The connection uses **chunked transfer encoding** — records are streamed as they are processed without loading the full result into memory.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `merchantId` | string | `"default"` | Filter records by merchant |
| `limit` | integer | `100` | Records per internal chunk (1–500) |
| `cursor` | string | — | Opaque cursor from a previous response for pagination |

### Response

`Content-Type: application/x-ndjson`

One JSON object per line:

```json
{"id":"tx_001","merchantId":"m1","subscriptionId":"sub_1","amount":9.99,...}
{"id":"tx_002","merchantId":"m1","subscriptionId":"sub_2","amount":14.99,...}
```

### Client Example (JavaScript)

```js
const res = await fetch('/subscriptions/stream?limit=100');
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop(); // save incomplete line
  for (const line of lines) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    console.log(record);
  }
}
```

### Client Example (React Native — using `streamNdjson`)

```tsx
import { streamNdjson } from '../services/streamingService';

await streamNdjson('/subscriptions/stream', (record) => {
  // called once per record, never buffers the full response
  dispatch(addRecord(record));
});
```

---

## Export Progress — `GET /exports/stream/:exportId`

Opens a **Server-Sent Events** connection. The server builds the export in the background and emits typed events as each chunk is processed.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `format` | `"json"` \| `"csv"` | `"json"` | Export format |
| `merchantId` | string | `"default"` | Merchant scope |

### SSE Events

All event data is JSON-encoded.

#### `progress`

```
event: progress
data: {"percent":42,"message":"Processing chunk 3","recordsProcessed":2100,"totalRecords":5000}
```

#### `chunk`

```
event: chunk
data: {"payload":"[{\"id\":\"tx_1\",...}]","index":2}
```

#### `complete`

```
event: complete
data: {"downloadUrl":"/exports/download/tok_abc?format=csv","totalRecords":5000,"checksum":"a1b2c3"}
```

#### `error`

```
event: error
data: {"message":"Export failed: connection timeout","code":"TIMEOUT"}
```

### Heartbeat

The server sends `: ping` comments every **15 seconds** to keep the connection alive through proxies.

### Client Example (React Native — using `useExportStream`)

```tsx
import { useExportStream } from '../services/hooks/useExportStream';

function ExportButton({ exportId }: { exportId: string }) {
  const { progress, stage, downloadUrl, startExport } = useExportStream();

  return (
    <>
      <Button title="Export CSV" onPress={() => startExport(exportId, { format: 'csv' })} />
      {stage === 'processing' && <ProgressBar value={progress} />}
      {downloadUrl && <Text>Ready: {downloadUrl}</Text>}
    </>
  );
}
```

---

## Streaming File Download — `GET /exports/download/:token`

Downloads the exported file using **chunked transfer encoding**. No `Content-Length` is set — the client reads until the stream closes.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `format` | `"json"` \| `"csv"` | `"json"` | File format |
| `merchantId` | string | `"default"` | Merchant scope |

### Response Headers

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="export-<token>.csv"
Transfer-Encoding: chunked
Cache-Control: no-store
```

### cURL Example

```bash
curl --no-buffer \
  "http://localhost:3001/exports/download/tok_abc?format=csv" \
  -o export.csv
```

---

## Memory Metrics — `GET /metrics/memory`

Returns current Node.js process memory statistics. Useful for monitoring memory usage during or after large streaming operations.

### Response

```json
{
  "rss": 52428800,
  "heapTotal": 31457280,
  "heapUsed": 21233664,
  "external": 1048576,
  "arrayBuffers": 65536,
  "capturedAt": "2026-07-28T00:00:00.000Z"
}
```

All values are in **bytes**.

---

## Cursor-Based Pagination Protocol

Cursor-paginated endpoints return a `nextCursor` field. Pass it as the `cursor` query parameter to retrieve the next page.

```
GET /subscriptions/stream?limit=100
→ Returns records 1–100, nextCursor: "eyJvZmZzZXQiOjEwMH0"

GET /subscriptions/stream?limit=100&cursor=eyJvZmZzZXQiOjEwMH0
→ Returns records 101–200, nextCursor: "eyJvZmZzZXQiOjIwMH0"

GET /subscriptions/stream?limit=100&cursor=eyJvZmZzZXQiOjIwMH0
→ Returns records 201–250, nextCursor: null  ← last page
```

Cursors are **opaque base64url-encoded tokens**. Do not attempt to parse or construct them manually.

---

## Rate Limiting

Streaming connections count as **one request** against the rate-limit budget. The connection is not throttled per-chunk. See [rate-limiting.md](../rate-limiting.md) for tier limits.

---

## Error Handling

| Scenario | HTTP Status | SSE Event |
|---|---|---|
| Invalid exportId | `400` | — |
| Export failed mid-stream | — | `error` event |
| Client disconnects | Connection closed | — |
| Memory threshold exceeded | Server logs warning | — |
