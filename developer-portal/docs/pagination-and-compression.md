# Pagination, Field Selection & Response Compression

## Compressed Responses

The SubTrackr API compresses all JSON responses using **Brotli** (preferred) or **gzip** depending on your client's `Accept-Encoding` header.

### Request Headers

```http
Accept-Encoding: br, gzip, deflate
```

### Response Headers

```http
Content-Encoding: br
ETag: "abc123def456"
Vary: Accept-Encoding
Cache-Control: public, s-maxage=300, stale-while-revalidate=60
Content-Length: 842
```

### Conditional Requests (304 Not Modified)

Cache the `ETag` from the first response and send it on subsequent requests:

```http
If-None-Match: "abc123def456"
```

If the resource hasn't changed, the server returns `304 Not Modified` with an empty body — saving bandwidth entirely.

---

## Cursor-Based Pagination

All list endpoints use cursor pagination. Do **not** use offset-based pagination — it is not supported.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `20` | Records per page. Max: `100` |
| `cursor` | string | — | Opaque token from previous response's `meta.pagination.cursor` |
| `fields` | string | — | Comma-separated fields to include (see Field Selection) |

### Example Request

```http
GET /subscriptions?limit=20&fields=id,status,planId,amount
```

### Example Response

```json
{
  "success": true,
  "data": [
    { "id": "sub_abc", "status": "active", "planId": "plan_pro", "amount": 29.99 },
    ...
  ],
  "meta": {
    "timestamp": "2026-07-27T10:00:00.000Z",
    "requestId": "req_xyz",
    "apiVersion": 1,
    "pagination": {
      "cursor": "eyJ2IjoxLCJmaWVsZ...",
      "hasMore": true,
      "total": 1420
    }
  }
}
```

### Fetching the Next Page

Pass the `cursor` from `meta.pagination.cursor` to the next request:

```http
GET /subscriptions?limit=20&cursor=eyJ2IjoxLCJmaWVsZ...&fields=id,status,planId,amount
```

When `meta.pagination.hasMore` is `false`, you have reached the last page.

### Important Notes

- Cursors are **opaque** — do not attempt to parse, modify, or construct them
- Cursors are **tamper-evident** — invalid cursors fall back to the first page
- Cursors are **directional** — they encode the sort direction and field
- Cursors are **not permanent** — do not store them for long-term use

---

## Field Selection

Reduce response payload size by requesting only the fields you need.

```http
GET /subscriptions?fields=id,status,amount,currency
```

The `id` field is always included even if not specified — it is required for resource identity.

### Example: Full response vs projected

Without field selection — ~800 bytes:
```json
{ "id": "sub_abc", "status": "active", "planId": "plan_pro", "amount": 29.99,
  "currency": "USD", "billingCycle": "monthly", "nextBillingDate": 1727000000000,
  "userId": "user_123", "createdAt": "2026-01-01T00:00:00.000Z", "... more fields" }
```

With `?fields=id,status,amount` — ~120 bytes:
```json
{ "id": "sub_abc", "status": "active", "amount": 29.99 }
```

Combined with Brotli compression, field selection can reduce typical list response sizes by 80–95%.
