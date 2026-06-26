# SubTrackr ML Service

FastAPI inference service (churn / recommendations) instrumented with
OpenTelemetry distributed tracing. It is a hop in the end-to-end trace — see
[../docs/distributed-tracing.md](../docs/distributed-tracing.md).

## Run

```bash
pip install -r requirements.txt
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
uvicorn main:app --port 8200
```

## Tracing

- Adopts the incoming W3C `traceparent` so requests join the caller's trace.
- Emits child spans for the three phases: `ml.model.load`, `ml.feature.compute`,
  `ml.inference`.
- Uses `ParentBased(TraceIdRatioBased)` sampling so the upstream decision is
  honored and root traces fall back to `OTEL_TRACES_SAMPLER_RATIO`.

## Endpoints

- `POST /v1/predict/churn` — returns churn probability + the `trace_id`.
- `GET /health` — liveness probe.
