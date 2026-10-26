# SubTrackr Feature Pipeline

Standalone ETL service for precomputing ML features before inference.

## Feature store

Features are written to Redis-compatible storage with TTL expiration. Cache keys
include the feature set hash, so transformation changes automatically invalidate
old feature vectors.

## Jobs

- Real-time churn features: `0 * * * *`
- Historical aggregate refresh: `0 2 * * *`

Airflow can call the refresh endpoints with `jobs/airflow_dag.py`.

## Backfill

```bash
python backfill.py --start-date 2026-06-01 --end-date 2026-06-07
```

The command prints JSON progress records for every processed day.
