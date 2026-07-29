# ML Service - ETL Module

Standalone ETL (Extract-Transform-Load) module for ML feature pipeline engineering, extracted from the ML service as a reusable component.

## Architecture

```
ml-service/
  etl/
    __init__.py          - Package exports
    config.py            - ETL configuration (feature store, monitoring, schedules)
    extractors.py        - Feature extractors (subscriptions, payments, usage, churn)
    transformers.py      - Feature transformers (normalization, aggregation, derivation)
    loaders.py           - Feature store backends (InMemory, BigQuery, Redis)
    pipeline.py          - Main ETL pipeline orchestrator
    monitoring.py        - Pipeline monitoring and alerting
    tests/
      test_pipeline.py   - Unit tests
  dags/
    feature_pipeline_dag.py  - Airflow DAG for scheduled execution
  benchmarks/
    etl_benchmark.py     - Performance benchmarks
```

## Usage

```python
from ml_service.etl import ETLPipeline, ETLConfig

config = ETLConfig(feature_sources=["subscriptions", "payments"])
pipeline = ETLPipeline(config)

result = pipeline.run({
    "subscriptions": [...],
    "payments": [...],
})

print(result.records_loaded)  # Number of features loaded
```

## Feature Store Backends

- **InMemory**: Development and testing (default)
- **BigQuery**: Production Google Cloud integration
- **Redis**: Low-latency feature serving

## Pipeline Orchestration

The Airflow DAG (`dags/feature_pipeline_dag.py`) runs daily and executes:
1. Extract features from all configured sources
2. Transform with normalization and feature derivation
3. Load into the configured feature store

## Monitoring

Pipeline metrics include:
- Execution duration
- Records processed per stage
- Error rates and alerts
- Throughput benchmarks

## Testing

```bash
cd ml-service
python -m pytest etl/tests/
python benchmarks/etl_benchmark.py
```
