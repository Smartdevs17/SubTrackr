import argparse
import json
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable

from feature_store import FeatureRecord, FeatureStoreUnavailable, RedisFeatureStore
from features.churn import FEATURE_SET_NAME, compute_features, feature_set_hash


def _date_range(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _example_rows(day: date) -> Iterable[Dict]:
    # Replace with warehouse reads in production. This keeps the backfill command
    # runnable and gives progress accounting even before a warehouse adapter lands.
    yield {
        "subscriber": f"backfill-{day.isoformat()}",
        "user_data": {
            "recent_payment_failures": 0,
            "baseline_logins_per_month": 10,
            "recent_logins": 10,
            "open_support_tickets": 0,
            "price_sensitivity_index": 0.5,
        },
    }


def run_backfill(start: date, end: date) -> Dict:
    store = RedisFeatureStore()
    transform_hash = feature_set_hash()
    processed = 0
    failed = 0
    total_days = (end - start).days + 1

    for index, day in enumerate(_date_range(start, end), start=1):
        for row in _example_rows(day):
            record = FeatureRecord(
                feature_set=FEATURE_SET_NAME,
                entity_id=row["subscriber"],
                transform_hash=transform_hash,
                features=compute_features(row["user_data"]),
                computed_at=datetime.now(timezone.utc).isoformat(),
            )
            try:
                store.set(record, ttl_seconds=24 * 60 * 60)
                processed += 1
            except FeatureStoreUnavailable:
                failed += 1
        print(json.dumps({"day": day.isoformat(), "day_index": index, "total_days": total_days, "processed": processed, "failed": failed}))

    return {"processed": processed, "failed": failed, "transform_hash": transform_hash}


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill SubTrackr feature store records.")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    args = parser.parse_args()

    start = datetime.strptime(args.start_date, "%Y-%m-%d").date()
    end = datetime.strptime(args.end_date, "%Y-%m-%d").date()
    if end < start:
        raise SystemExit("--end-date must be on or after --start-date")

    print(json.dumps({"summary": run_backfill(start, end)}))


if __name__ == "__main__":
    main()
