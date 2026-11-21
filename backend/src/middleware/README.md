# Gateway compression middleware (issue #2080)

`compression.ts` negotiates `Content-Encoding` for API responses in the gateway.
The former `backend/shared/middleware/compression.ts` path now re-exports this
implementation so there is a single compression middleware.

## Behavior

- Parses `Accept-Encoding` with q-values via the shared `negotiateEncoding()`
  helper: Brotli (`br`) is preferred, gzip is the fallback, `identity` is used
  when the client rejects both.
- Compresses only when all of the following hold: the path is not in the
  compression skip list, the method is not `HEAD`, the status is not
  1xx/204/304, no `Content-Encoding` is already set, `Cache-Control` does not
  contain `no-transform`, the `Content-Type` is compressible, and the body is at
  least the resolved threshold (default 1 KB).
- Streams compressed bytes through `zlib` instead of buffering the full
  response. The first `threshold` bytes are buffered to decide whether the
  payload is worth compressing.
- Appends `Vary: Accept-Encoding` without overwriting existing values.
- Removes stale `Content-Length` when compressing and recomputes it for
  identity responses.
- Per-route level/threshold overrides come from `backend/config/compression.ts`;
  a route can also set `X-Compression-Level` before sending the body.

## Failure modes

A zlib error logs a warning, removes the `Content-Encoding` header, flushes the
already-buffered raw bytes and reports a `fallback` event. Clients never receive
a truncated encoded payload.

## Observability

`onMetrics` receives one `CompressionEvent` per response with path, negotiated
encoding, outcome (`compressed` / `identity` / `fallback`), skip reason, byte
counts and duration. Counters are also mirrored into the existing
`compressionMetrics` store used by `/metrics/compression`, and exposed
separately via `gatewayCompressionPrometheusMetrics()`.
