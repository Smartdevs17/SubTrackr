# API Response Compression & Pagination Optimization

This document covers the two performance subsystems for issue #987:

- **Compression** — `backend/services/shared/compression.ts`
- **Pagination** — `backend/services/shared/pagination.ts`

---

## Compression

### Overview

All JSON and text HTTP responses are compressed using **Brotli-first, gzip-fallback** negotiation. Compression is applied transparently — handlers write plain bodies and `applyCompression()` handles encoding, ETags, and conditional GETs.

### Quick start

```ts
import { applyCompression } from '../services/shared/compression';

async function handler(req, res) {
  const data = await fetchSubscriptions();
  await applyCompression(req, res, JSON.stringify(data), {
    'Content-Type': 'application/json',
  });
}
```

### Configuration

```ts
await applyCompression(req, res, body, headers, {
  minSize: 1024,           // bytes — skip compression below this (default: 1024)
  brotliQuality: 4,        // 0–11, default 4 (fast + good ratio)
  gzipLevel: 6,            // 1–9, default 6
  etag: true,              // attach ETag for conditional GETs (default: true)
  defaultCacheControl: 'public, max-age=300',
  compressibleTypes: /^(text\/|application\/json|application\/javascript)/,
});
```

### How it works

1. **Encoding negotiation** — `negotiateEncoding()` parses `Accept-Encoding` respecting `q`-values. Priority: `br` > `gzip` > `identity`.
2. **Size threshold** — bodies below `minSize` (default 1 024 bytes) are sent uncompressed.
3. **Content-type filter** — only `text/*`, `application/json`, and `application/javascript` are compressed.
4. **ETag** — SHA-256 of the **uncompressed** body, making ETags encoding-independent. Conditional GET returns `304 Not Modified` when `If-None-Match` matches.
5. **Vary header** — always `Accept-Encoding` on compressed responses for correct CDN caching.
6. **Fallback** — if compression throws, the uncompressed body is sent transparently.

### Compression ratio benchmarks

Tested with realistic SubTrackr payloads:

| Payload | Algorithm | Compressed / original | Size reduction |
|---|---|---|---|
| JSON (100 subscriptions, ~6 KB) | gzip | ~0.12 | **88 %** |
| JSON (100 subscriptions, ~6 KB) | brotli | ~0.09 | **91 %** |
| CSV (100 rows, ~3 KB) | gzip | ~0.08 | **92 %** |

Performance targets enforced by tests:

| Test | Target |
|---|---|
| JSON ≥ 70 % compression (gzip) | ratio < 0.30 |
| JSON ≥ 70 % compression (brotli) | ratio < 0.30 |
| CSV ≥ 80 % compression (gzip) | ratio < 0.20 |

### Metrics

```ts
import { compressionMetrics, compressionPrometheusMetrics } from '../services/shared/compression';

// Runtime snapshot
const m = compressionMetrics.snapshot();
// { totalRequests, compressed, skipped, brotliUsed, gzipUsed,
//   totalOriginalBytes, totalCompressedBytes, avgCompressionRatio }

// Prometheus exposition
app.get('/metrics', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.end(compressionPrometheusMetrics());
});

// Reset counters (tests / dashboards)
compressionMetrics.reset();
```

---

## Pagination

### Overview

All list endpoints use **cursor-based (keyset) pagination** with tamper-evident HMAC-signed cursors and optional field selection via `?fields=id,name,status`.

### Quick start

```ts
import { buildCursorClause, buildPage, parseFieldSelection, selectFieldsAll }
  from '../services/shared/pagination';

async function listSubscriptions(req) {
  const { cursor, limit, fields } = req.query;

  const { where, param, orderBy, limit: n } = buildCursorClause({
    cursor,
    limit: Number(limit) || 20,
    sortField: 'createdAt',
    direction: 'asc',
  });

  const sql = `SELECT * FROM subscriptions
               ${where ? `WHERE ${where}` : ''}
               ORDER BY ${orderBy}
               LIMIT ${n + 1}`;                // fetch one extra to detect hasMore

  const rows = await db.query(sql, param ? [param] : []);

  const page = buildPage(rows, n, (r) => r.createdAt, (r) => r.id, 'asc', 'createdAt');

  return {
    items: selectFieldsAll(page.items, parseFieldSelection(fields)),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}
```

### Cursor encoding

Cursors are HMAC-SHA256 signed and base64url-encoded — they cannot be forged or replayed across field/direction changes. Set `CURSOR_HMAC_SECRET` in production environment.

```ts
import { encodeCursor, decodeCursor } from '../services/shared/pagination';

const token = encodeCursor({
  field: 'createdAt',
  value: '2025-06-01T00:00:00Z',
  id: 'sub_123',
  dir: 'asc',
});

const payload = decodeCursor(token);
// { v: 1, field: 'createdAt', value: '2025-06-01T00:00:00Z', id: 'sub_123', dir: 'asc' }

decodeCursor('tampered-or-invalid') // → null (never throws)
```

### Limit clamping

| Parameter | Default | Hard cap |
|---|---|---|
| `limit` | 20 | 100 (override via `maxLimit`) |

### Field selection

```ts
const fields = parseFieldSelection('status,amount');
// → Set { 'status', 'amount' }   (null when param is absent — return all fields)

// id is always included regardless of the fields set
const slim    = selectFields(subscription, fields);
// { id: 'sub_001', status: 'active', amount: 9.99 }

const slimAll = selectFieldsAll(subscriptions, fields);
```

### API response envelope

```json
{
  "items": [
    { "id": "sub_001", "status": "active", "amount": 9.99 },
    { "id": "sub_002", "status": "active", "amount": 14.99 }
  ],
  "nextCursor": "eyJ2IjoxLCJmaWVsZCI6ImNyZWF0ZWRBdCIs...",
  "hasMore": true
}
```

### Why cursor over offset?

Cursor-based pagination provides stable traversal even when rows are inserted or deleted mid-traversal — offset pagination can skip or repeat rows in those conditions.

---

## Running the tests

```bash
# Unit tests — compression
npx jest --config jest.backend.config.js \
  backend/services/shared/__tests__/compression.test.ts

# Unit tests — pagination
npx jest --config jest.backend.config.js \
  backend/services/shared/__tests__/pagination.test.ts

# Integration test (real HTTP server, compression ratios)
npx jest --config jest.backend.config.js \
  backend/tests/integration/compression.test.ts

# All three together with coverage
npx jest --config jest.backend.config.js --coverage \
  backend/services/shared/__tests__/compression.test.ts \
  backend/services/shared/__tests__/pagination.test.ts \
  backend/tests/integration/compression.test.ts
```
