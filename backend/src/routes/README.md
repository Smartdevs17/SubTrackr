# Admin list routes — keyset pagination (issue #2079)

`GET /admin/:resource` serves the heavy admin lists (`users`, `subscriptions`,
`transactions`, `audit-events`) with `(created_at, id)` keyset cursors instead
of `OFFSET`. No `COUNT(*)` is issued for page metadata.

## Why keyset

`OFFSET n` makes Postgres walk and discard `n` rows on every request, and a
write between requests can duplicate or skip records. A keyset predicate walks
directly from the last row of the previous page. The `id` tie-breaker makes
ordering deterministic when many rows share a `created_at` value.

## Request contract

| Param | Default | Description |
|---|---|---|
| `cursor` | none | Opaque v1 token returned as `nextCursor`/`prevCursor`. |
| `after` | none | Alias for `cursor` that implies `direction=forward`. |
| `before` | none | Alias for `cursor` that implies `direction=backward`. |
| `direction` | inferred | `forward` or `backward`. Explicit value wins over aliases. |
| `limit` | `25` | Clamped to `1..100`. Invalid values fall back to `25`. |

```http
GET /admin/transactions?limit=50
GET /admin/transactions?cursor=v1.eyJ...&limit=50&direction=forward
GET /admin/transactions?before=v1.eyJ...&limit=50
```

## Response contract

```json
{
  "success": true,
  "data": {
    "resource": "transactions",
    "items": [{ "id": "tx_123", "createdAt": "2026-01-05T00:00:00.000Z" }],
    "pageInfo": {
      "hasNextPage": true,
      "hasPreviousPage": false,
      "startCursor": "v1....",
      "endCursor": "v1...."
    },
    "nextCursor": "v1....",
    "prevCursor": null
  }
}
```

Every page is returned newest-first, including backward pages. `hasNextPage`
and `hasPreviousPage` are derived by fetching `limit + 1` rows; the extra row
is never returned to the client.

## Repository implementation

Fetchers receive `fetchLimit = limit + 1` and a validated cursor. Use the SQL
from `buildKeysetClause()`:

```ts
const { whereSql, orderSql, limitPlaceholder, params } = buildKeysetClause(query);
const rows = await db.query(
  `SELECT id, created_at, ... FROM admin_users ${whereSql ? `WHERE ${whereSql}` : ''}
   ${orderSql} LIMIT ${limitPlaceholder}`,
  params,
);
```

Identifiers in the generated clause are fixed; all client values are bound
parameters. Never interpolate a raw cursor into SQL. For in-memory or cached
lists, `paginateRows()` applies the same comparison and tie-breaking rules.

## Failure modes and observability

- Bad cursor/direction → `400 INVALID_CURSOR` / `400 INVALID_PAGINATION`, before
  the fetcher runs.
- Unsupported resource → `400 UNSUPPORTED_RESOURCE`.
- Fetcher failure → `500 INTERNAL_SERVER_ERROR`; the underlying error is logged
  but never returned to the client.

`logger.warn/info/error` record invalid input, successful pages and failures.
`onMetrics` receives one `AdminListMetricsEvent` per request with resource,
outcome, direction, limit, item count, `hasMore` and duration in milliseconds.
