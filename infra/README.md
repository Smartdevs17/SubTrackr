# Observability Infrastructure

Local OpenTelemetry stack for SubTrackr distributed tracing.

## Components

- `otel-collector-config.yaml` — OTLP receiver → PII redaction → tail sampling →
  Tempo exporter.
- `tempo.yaml` — Grafana Tempo trace storage.
- `docker-compose.observability.yml` — collector + Tempo + Grafana.

## Usage

```bash
docker compose -f docker-compose.observability.yml up
```

Point every service at the collector:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

- OTLP HTTP: `:4318`, gRPC: `:4317`
- Collector health: `:13133`
- Grafana (flame graphs): `http://localhost:3000` → Explore → Tempo

See [../docs/distributed-tracing.md](../docs/distributed-tracing.md) for the full
propagation contract and per-language usage.
