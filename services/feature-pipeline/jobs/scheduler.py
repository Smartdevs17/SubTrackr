from datetime import datetime, timezone
from typing import Dict, Iterable

from feature_store import FeatureRecord, FeatureStoreUnavailable, RedisFeatureStore
from features.churn import FEATURE_SET_NAME, compute_features, feature_set_hash


CRON_SCHEDULES = {
    "real_time_features": "0 * * * *",
    "historical_aggregates": "0 2 * * *",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def refresh_churn_features(
    rows: Iterable[Dict],
    store: RedisFeatureStore | None = None,
    ttl_seconds: int | None = None,
) -> Dict:
    store = store or RedisFeatureStore()
    transform_hash = feature_set_hash()
    processed = 0
    failed = 0

    for row in rows:
        subscriber = row["subscriber"]
        user_data = row.get("user_data", {})
        record = FeatureRecord(
            feature_set=FEATURE_SET_NAME,
            entity_id=subscriber,
            transform_hash=transform_hash,
            features=compute_features(user_data),
            computed_at=_now_iso(),
        )
        try:
            store.set(record, ttl_seconds=ttl_seconds)
            processed += 1
        except FeatureStoreUnavailable:
            failed += 1

    return {
        "job": "churn_feature_refresh",
        "transform_hash": transform_hash,
        "processed": processed,
        "failed": failed,
        "ran_at": _now_iso(),
    }


def hourly_real_time_refresh(rows: Iterable[Dict]) -> Dict:
    return refresh_churn_features(rows)


def daily_historical_aggregate_refresh(rows: Iterable[Dict]) -> Dict:
    return refresh_churn_features(rows, ttl_seconds=24 * 60 * 60)
