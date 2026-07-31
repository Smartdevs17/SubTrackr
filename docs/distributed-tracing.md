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

### Backend (TypeScript) — `backend/services/shared`

```ts
import { startServerSpan, traceDbQuery, traceExternalCall } from './shared/monitoring';

async function handleCharge(req) {
  const { span, downstreamHeaders } = startServerSpan('POST /v1/charges', req.headers);
  try {
    const sub = await traceDbQuery('select subscription', span.context, () => db.query(...));
    await traceExternalCall('ml-service', span.context, (_s, headers) =>
      fetch(ML_URL, { headers }) // headers already carry traceparent
    );
    span.setStatus('ok');
  } catch (e) {
    span.recordException(e);
    throw e;
  } finally {
    span.end();
  }
}
```

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
