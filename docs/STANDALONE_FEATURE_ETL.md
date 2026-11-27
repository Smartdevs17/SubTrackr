# Standalone ML feature ETL (#2202)

Feature engineering is packaged as a dependency-free ETL module in
`ml-service/etl/`. It can run as a CLI, a cron job, an Airflow task or inside a
container without importing the FastAPI inference service or the SubTrackr
backend.

## Layout

| Module | Responsibility |
| --- | --- |
| `etl/extractors.py` | Normalises subscription, payment, usage and churn-signal records. |
| `etl/transformers.py` | Normalisation, aggregation, derivation and deduplication. |
| `etl/loaders.py` | In-memory, Redis and BigQuery feature-store adapters. |
| `etl/pipeline.py` | Orchestration, retries hooks, monitoring and grouped feature-set writes. |
| `etl/monitoring.py` | Run metrics, latency/error thresholds and alert summaries. |
| `etl/config.py` | Sources, batching, schedule, feature store and monitoring configuration. |
| `etl/cli.py` | Stable command-line entry point and JSON run reports. |

The engine uses only the Python standard library. Production store clients and
Airflow are declared as optional extras in `ml-service/pyproject.toml`, so a
minimal ETL worker image does not install the inference stack.

## Install and run

```bash
cd ml-service
pip install -e .

subtrackr-etl --input snapshot.json --output run-report.json
# or
python -m etl.cli --input snapshot.json
```

`--input` is a JSON object keyed by source name, for example:

```json
{
  "subscriptions": [{ "id": "sub_1", "subscriber": "0xABC", "price": 9.99 }],
  "payments": [{ "subscriber": "0xABC", "amount": 9.99, "status": "success" }]
}
```

Use `--source` (repeatable) or `SUBTRACKR_ETL_SOURCES` to pick sources,
`--store` or `SUBTRACKR_ETL_STORE` to pick a feature store, and `--config` to
load the remaining `ETLConfig` fields from JSON. The run report contains row
counts per stage, updated feature sets, timing and errors; the process exits
`0` on success, `1` on a run with errors and `2` on invalid configuration.

## Orchestration

`ml-service/dags/feature_pipeline_dag.py` calls the same extractors,
transformers and loader modules through the stable `etl.*` import path, and
`ml-service/benchmarks/etl_benchmark.py` exercises the same engine. `services/
feature-pipeline` remains the low-latency serving API that reads from the
feature store; it is a consumer of this ETL, not a second source of truth.

Unit tests: `ml-service/etl/tests/test_pipeline.py` and
`ml-service/etl/tests/test_cli.py` (`python -m unittest discover -s etl/tests`).
