# Distributed Tracing

SubTrackr spans mobile, backend, ML, webhooks and smart contracts. End-to-end
tracing stitches a single user action into one trace so latency and errors can be
attributed to a specific service hop instead of correlated by hand across logs.

## Architecture

```
Mobile app ──traceparent──▶ Backend API ──traceparent──▶ ML service
   │                            │                            
   │ apiClient.ts               │ shared/monitoring.ts        ml-service/main.py
   │ (client span)              │ (server/db/external spans)  (server/inference spans)
   │                            │
   │                            └──traceparent──▶ Webhook receiver
   │                                              webhook.ts (producer span)
   ▼
 OTLP/HTTP  ─────────────────▶ OTel Collector ──▶ Tempo ──▶ Grafana (flame graphs)
```

Every hop propagates **W3C Trace Context** (`traceparent` / `tracestate`) so the
trace id is shared and parent/child span linkage is preserved.

## Propagation contract

- Header: `traceparent: 00-<32-hex trace-id>-<16-hex span-id>-<2-hex flags>`.
- The low bit of flags is the **sampled** flag.
- A receiver adopts the incoming context as the parent of its server span; if no
  header is present it starts a new root trace.
- Decisions are **consistent across services**: sampling is derived from the
  trace id and a parent's decision is always honored, so traces are never partial.

## Per-language usage

### Backend (TypeScript) — `backend/shared/middleware/requestObservability.ts`

Both backend HTTP servers (`backend/server.ts` and the Express app in
`backend/server/createApiServer.ts`) run every request through
`createRequestObservability`. It:

- continues the caller's `traceparent` (or starts a new trace) with a `server`
  span named `<METHOD> <path>`;
- records `http.method`, `http.target` (path only), `http.status_code` and
  `request.id`; 5xx responses and aborted requests get status `error`;
- exports the span through the tracer built by `createTracerFromEnv`
  (`backend/services/shared/tracing.ts`): OTLP/HTTP to
  `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces` when set, otherwise an in-memory
  buffer.

Service names: `subtrackr-backend` (`server.ts`) and `subtrackr-api`
(`createApiServer.ts`).

To propagate a context to a downstream call, add the headers from
`injectContext(span.context)` to the outgoing request.

### Correlating traces and logs

The middleware also sets `X-Request-Id` (kept from the caller when it is a safe
token, otherwise a UUID) and runs the handler in the logger's correlation
context. So:

- every log written while serving the request has `correlationId` = request id;
- the `http.request` access log line carries `requestId`, `traceId` and
  `spanId`;
- the server span carries the `request.id` attribute.

From a log line, search Tempo by `traceId`; from a trace, filter logs by
`correlationId` = the span's `request.id`. See [api-logging.md](api-logging.md).

### Mobile (TypeScript) — `src/services/network/apiClient.ts`

```ts
import { apiClient } from './services/network/apiClient';
const res = await apiClient.post('/v1/charges', body); // injects traceparent, spans the call
```

### ML service (Python) — `ml-service/main.py`

Spans are emitted for `ml.model.load`, `ml.feature.compute` and `ml.inference`,
all children of a server span rooted in the incoming context.

### Webhooks — `backend/services/webhook.ts`

`deliverEvent(input, parentContext)` opens a producer span and injects
`traceparent` into the delivery headers so receivers can correlate.

## Sampling strategy

Configurable via env, consistent across JS and Python services:

| Variable                      | Meaning                                  | Default |
| ----------------------------- | ---------------------------------------- | ------- |
| `OTEL_TRACES_SAMPLER_RATIO`   | head sampling probability [0,1]          | `0.1`   |
| `OTEL_TRACES_SAMPLE_ERRORS`   | always keep errored traces (`false` off) | `true`  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | collector base URL                        | —       |
| `OTEL_SERVICE_NAME`           | logical service name on spans            | per svc |

Three strategies are supported and compose:

- **Rate-based** — `defaultRatio` / `OTEL_TRACES_SAMPLER_RATIO`.
- **Endpoint-based** — `endpointRatios` per route (e.g. always sample `POST /v1/charges`).
- **Error-based** — head-dropped traces that error are force-kept; the collector
  additionally tail-samples errors and slow (>1s) traces.

## Collector + visualization

Bring up the local stack and point services at it:

```bash
docker compose -f infra/docker-compose.observability.yml up
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Open Grafana (`http://localhost:3000`) → Explore → Tempo → search by trace id or
service to see the flame graph. The collector config
(`infra/otel-collector-config.yaml`) redacts PII attributes and applies tail
sampling before export.

## Privacy / overhead

- **PII** — span attributes are scrubbed of likely-sensitive keys
  (`authorization`, `email`, `wallet`, …) before export, both in-process
  (`scrubAttributes`) and again at the collector.
- **Header size** — only `traceparent` (+ optional `tracestate`) are propagated.
- **Overhead** — spans are plain objects; export is async and best-effort
  (failures are swallowed), keeping the instrumentation within the <2% p95 budget.
- **Retries** — propagation is per-attempt, so a retried request still carries a
  valid context.
