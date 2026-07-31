# API Performance: Compression & Pagination

## Response Compression

`backend/services/shared/compression.ts`

All API responses are compressed using Brotli-first, gzip-fallback negotiation.

### Encoding Negotiation

The server reads the client's `Accept-Encoding` header and selects the best supported format:

| Priority | Encoding | Notes |
|---|---|---|
| 1 | `br` (Brotli) | Quality 4 by default — fast with ~30% better ratio than gzip |
| 2 | `gzip` | Level 6 by default |
| 3 | `identity` | Used when client doesn't support compression or body < 1 KB |

### ETag Support

Every compressible response receives an `ETag` derived from the SHA-256 of the **uncompressed** body, making the tag encoding-independent.

Clients that send `If-None-Match: <etag>` receive a `304 Not Modified` when the content hasn't changed — saving bandwidth entirely.

### Cache-Control Headers

Plan endpoints include `Cache-Control: public, s-maxage=300, stale-while-revalidate=60` by default. Pass `defaultCacheControl` to `applyCompression` to customise per endpoint.

### Usage

```typescript
import { applyCompression } from '../services/shared/compression';

// In a request handler:
await applyCompression(req, res, JSON.stringify(data), {
  'Content-Type': 'application/json',
}, {
  defaultCacheControl: 'public, s-maxage=60',
});
```

### Metrics

```
GET /metrics/compression
```

Exposes Prometheus counters:

| Metric | Type | Description |
|---|---|---|
| `subtrackr_compression_requests_total` | counter | Total responses processed |
| `subtrackr_compression_compressed_total` | counter | Responses that were compressed |
| `subtrackr_compression_brotli_total` | counter | Compressed with Brotli |
| `subtrackr_compression_gzip_total` | counter | Compressed with gzip |
| `subtrackr_compression_original_bytes_total` | counter | Total uncompressed bytes |
| `subtrackr_compression_compressed_bytes_total` | counter | Total bytes actually sent |
| `subtrackr_compression_avg_ratio` | gauge | Average ratio (lower = better) |

---

## Cursor-Based Pagination

`backend/services/shared/pagination.ts`

### Why Cursor Pagination?

Offset pagination (`OFFSET 100 LIMIT 20`) degrades at scale — the DB scans all prior rows. Cursor pagination uses a stable, ordered bookmark so each page is O(log N) regardless of depth.

### Cursor Format

Cursors are opaque `base64url` strings containing a signed JSON payload. Clients must treat them as opaque — do not parse or construct cursors manually.

```
eyJ2IjoxLCJmaWVsZCI6ImNyZWF0ZWRBdCIsInZhbHVlIjoxNzIyMDAwMDAwMDAwLCJpZCI6...
```

### Query Parameter

```
GET /subscriptions?limit=20&cursor=<opaque>&fields=id,status,amount
```

| Parameter | Description |
|---|---|
| `limit` | Page size (1–100, default 20) |
| `cursor` | Opaque cursor from previous page's `nextCursor` |
| `fields` | Comma-separated field list for projection |

### Response Shape

```json
{
  "success": true,
  "data": [...],
  "meta": {
    "pagination": {
      "cursor": "eyJ2Ij...",
      "hasMore": true,
      "total": 1420
    }
  }
}
```

### Server-Side Integration

```typescript
import { buildCursorClause, buildPage, parseFieldSelection, selectFieldsAll } from '../services/shared/pagination';

// 1. Parse options from query string
const { cursor, limit, fields: fieldsParam } = req.query;
const fieldSet = parseFieldSelection(fieldsParam);

// 2. Build SQL clause
const { where, param, orderBy, limit: pageLimit } = buildCursorClause({ cursor, limit: Number(limit) });

// 3. Query with limit+1 to detect hasMore
const sql = `SELECT * FROM subscriptions ${where ? `WHERE ${where}` : ''} ORDER BY ${orderBy} LIMIT ${pageLimit + 1}`;
const rows = await pool.query(sql, param ? [param] : []);

// 4. Build page
const page = buildPage(rows, pageLimit, (r) => r.createdAt, (r) => r.id);

// 5. Apply field selection
const items = selectFieldsAll(page.items, fieldSet);

return ok(items, requestId, { cursor: page.nextCursor, hasMore: page.hasMore });
```

---

## Response Size Monitoring

The `compressionMetrics` object tracks total bytes before and after compression per process lifetime. The `avgCompressionRatio` metric in Prometheus gives a fleet-wide view of compression effectiveness.

Alert threshold recommendation: if `avgCompressionRatio > 0.9` (less than 10% savings), check that:
1. `Content-Type` headers are set correctly on responses
2. The minimum size threshold isn't set too high
3. Clients are sending `Accept-Encoding: br, gzip`
