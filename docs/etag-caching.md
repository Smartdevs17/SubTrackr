# ETag Caching

SubTrackr's ETag middleware adds conditional request support to the backend API,
reducing bandwidth and improving response times for unchanged resources.

## How It Works

```
Client                          Server
  │── GET /plans ─────────────────→ │
  │                                 │  ETag: "abc123…"
  │← 200 OK + ETag header ──────── │

  │── GET /plans ─────────────────→ │
  │   If-None-Match: "abc123…"      │
  │                                 │  body unchanged → ETag matches
  │← 304 Not Modified ─────────────│  (no body, 0 bytes transferred)
```

## Files

| File | Purpose |
|---|---|
| `backend/shared/middleware/etagMiddleware.ts` | Core ETag logic, 304 handling, Cache-Control |
| `backend/shared/middleware/index.ts` | Barrel export |
| `backend/server.ts` | `applyETagToRawHandler` wired into raw HTTP server |

## ETag Generation

ETags are **strong entity tags** computed as a truncated SHA-256 hex digest of
the response body:

```
ETag: "d4f1a3b2c8e09f7..."   (32-char hex, double-quoted per RFC 7232)
```

Strong ETags guarantee byte-for-byte equivalence. Weak ETags (`W/"…"`) are not
used — the body is always fully buffered before the hash is computed.

**Collision resistance:** SHA-256 has negligible collision probability for the
body sizes used in this API (< 64 KB per response). Tests in
`backend/shared/middleware/__tests__/etagMiddleware.test.ts` verify collision
detection with known body pairs.

## Conditional Request Handling (`If-None-Match` → 304)

The middleware:
1. Buffers the response body.
2. Computes ETag from the buffer.
3. Compares against `If-None-Match` request header.
4. If they match, responds `304 Not Modified` with no body.
5. If they don't match, responds normally with `ETag` header attached.

The `If-None-Match` header supports:
- Exact match: `"abc123"`
- Wildcard: `*` (always matches)
- List: `"abc123", "def456"` (comma-separated)

## Cache-Control Headers per Endpoint

Default TTLs by path prefix (see `PATH_TTL_OVERRIDES` in `etagMiddleware.ts`):

| Path | Cache-Control | Notes |
|---|---|---|
| `/plans` | `public, s-maxage=300, max-age=300, stale-while-revalidate=60` | 5 min edge + 60 s SWR |
| `/pricing` | `public, s-maxage=300, …` | 5 min |
| `/features` | `public, s-maxage=600, …` | 10 min |
| `/public/*` | `public, s-maxage=3600, …` | 1 hour |
| `/graphql` | `no-store` | Mutations; no caching |
| `/health` | `no-store` | Always fresh |
| `/metrics` | `no-store` | Always fresh |

Override per-request by setting `res.locals.cacheTtl` before the handler runs:
```ts
res.locals.cacheTtl = 600;            // 10 min for this response
res.locals.cacheScope = 'private';    // skip CDN; browser-only
```

## Stale-While-Revalidate

Public responses include `stale-while-revalidate=60` in Cache-Control.
This instructs the CDN to serve a stale cached response (up to 60 seconds old)
while fetching a fresh one in the background, eliminating cache-miss latency
spikes after TTL expiry.

## Cache Bypass for Authenticated Requests

When `bypassForAuth: true` (the default), requests carrying an `Authorization`
header or `Cookie` are served with `Cache-Control: private, max-age=<ttl>` and
no `ETag` logic — private data is never stored at the CDN edge.

Change the default:
```ts
applyETagToRawHandler(req, res, { bypassForAuth: false });
```

## Usage

### Raw HTTP server (default in `backend/server.ts`)

```ts
import { applyETagToRawHandler } from './shared/middleware/etagMiddleware';

const server = http.createServer(async (req, res) => {
  applyETagToRawHandler(req, res);
  // … handler logic …
});
```

### Express

```ts
import { etagMiddleware } from './backend/shared/middleware/etagMiddleware';

app.use(etagMiddleware({
  defaultTtlSeconds: 300,
  staleWhileRevalidateSeconds: 60,
  bypassForAuth: true,
}));
```

## API Reference

### `computeETag(body: Buffer | string): string`
Returns a strong ETag string (`"<sha256-32>"`) from a body.

### `etagMatches(requestEtag, responseEtag): boolean`
Evaluates the `If-None-Match` header against a response ETag.
Handles `*`, comma-separated lists, and exact match.

### `resolveTtlForPath(path): number`
Returns the TTL (seconds) for a given path using the longest-prefix-match rule.
Returns `0` for no-store paths.

### `buildCacheControlValue(ttl, scope, swr): string`
Builds a Cache-Control header value string.

### `applyETagToRawHandler(req, res, options?): void`
Applies ETag interception to a raw `http.IncomingMessage` / `http.ServerResponse` pair.

### `etagMiddleware(options?): ExpressMiddleware`
Returns an Express-compatible middleware function.
