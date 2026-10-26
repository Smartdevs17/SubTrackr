from datetime import datetime, timezone
from typing import Dict, List

from fastapi import FastAPI
from pydantic import BaseModel, Field

from feature_store import FeatureRecord, FeatureStoreUnavailable, RedisFeatureStore
from features.churn import FEATURE_SET_NAME, REFERENCE_DISTRIBUTION, compute_features, drift_report, feature_set_hash
from jobs.scheduler import CRON_SCHEDULES, daily_historical_aggregate_refresh, hourly_real_time_refresh


app = FastAPI(title="SubTrackr Feature Pipeline", version="1.0.0")
store = RedisFeatureStore()


class ChurnUserData(BaseModel):
    recent_payment_failures: int = 0
    baseline_logins_per_month: int = 10
    recent_logins: int = 10
    open_support_tickets: int = 0
    app_crashes: int = 0
    price_sensitivity_index: float = Field(0.5, ge=0.0, le=1.0)


class ChurnFeatureRequest(BaseModel):
    subscriber: str
    user_data: ChurnUserData


class ChurnFeatureBatchRequest(BaseModel):
    items: List[ChurnFeatureRequest] = Field(default_factory=list)


class DriftRequest(BaseModel):
    rows: List[Dict[str, float]]
    alpha: float = Field(0.05, gt=0.0, lt=1.0)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/health")
def health():
    try:
        store.ping()
        store_status = "available"
    except FeatureStoreUnavailable:
        store_status = "unavailable"
    return {
        "ok": True,
        "feature_store": store_status,
        "feature_sets": {FEATURE_SET_NAME: feature_set_hash()},
        "cron": CRON_SCHEDULES,
    }


@app.post("/v1/features/churn/compute")
def compute_churn(req: ChurnFeatureRequest):
    transform_hash = feature_set_hash()
    features = compute_features(req.user_data.model_dump())
    record = FeatureRecord(
        feature_set=FEATURE_SET_NAME,
        entity_id=req.subscriber,
        transform_hash=transform_hash,
        features=features,
        computed_at=_now_iso(),
    )
    cached = False
    try:
        store.set(record)
        cached = True
    except FeatureStoreUnavailable:
        cached = False
    return {**record.__dict__, "cached": cached}


@app.post("/v1/jobs/refresh/realtime")
def refresh_realtime(req: ChurnFeatureBatchRequest = ChurnFeatureBatchRequest()):
    return hourly_real_time_refresh([item.model_dump() for item in req.items])


@app.post("/v1/jobs/refresh/historical")
def refresh_historical(req: ChurnFeatureBatchRequest = ChurnFeatureBatchRequest()):
    return daily_historical_aggregate_refresh([item.model_dump() for item in req.items])


@app.post("/v1/features/churn/drift")
def detect_churn_drift(req: DriftRequest):
    return drift_report(req.rows, alpha=req.alpha)


@app.post("/v1/features/churn/reference")
def seed_churn_reference_distribution():
    transform_hash = feature_set_hash()
    store.put_reference_distribution(FEATURE_SET_NAME, transform_hash, REFERENCE_DISTRIBUTION)
    return {"feature_set": FEATURE_SET_NAME, "transform_hash": transform_hash, "seeded": True}
