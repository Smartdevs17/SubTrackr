import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None


FEATURE_PIPELINE_PATH = os.getenv(
    "FEATURE_PIPELINE_PATH",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "services", "feature-pipeline")),
)
if FEATURE_PIPELINE_PATH not in sys.path:
    sys.path.insert(0, FEATURE_PIPELINE_PATH)

from features.churn import FEATURE_SET_NAME, compute_features, drift_report, feature_set_hash


class FeatureStoreUnavailable(RuntimeError):
    pass


@dataclass
class FeatureResult:
    features: Dict[str, float]
    feature_set: str
    feature_set_hash: str
    source: str
    store_available: bool
    computed_at: str
    drift: Dict


class FeatureStoreClient:
    def __init__(self):
        self.url = os.getenv("FEATURE_STORE_URL", "redis://localhost:6379/0")
        self.ttl_seconds = int(os.getenv("FEATURE_TTL_SECONDS", "7200"))
        self._client = None

    @property
    def client(self):
        if redis is None:
            raise FeatureStoreUnavailable("redis package is not installed")
        if self._client is None:
            self._client = redis.Redis.from_url(self.url, decode_responses=True)
        return self._client

    @staticmethod
    def key(feature_set: str, entity_id: str, transform_hash: str) -> str:
        return f"features:{feature_set}:{transform_hash}:{entity_id}"

    def get(self, feature_set: str, entity_id: str, transform_hash: str) -> Optional[Dict]:
        try:
            raw = self.client.get(self.key(feature_set, entity_id, transform_hash))
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc
        return json.loads(raw) if raw else None

    def set(self, feature_set: str, entity_id: str, transform_hash: str, features: Dict[str, float]) -> None:
        payload = {
            "feature_set": feature_set,
            "entity_id": entity_id,
            "transform_hash": transform_hash,
            "features": features,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            self.client.setex(self.key(feature_set, entity_id, transform_hash), self.ttl_seconds, json.dumps(payload))
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc


class ChurnFeatureProvider:
    def __init__(self, store: FeatureStoreClient | None = None):
        self.store = store or FeatureStoreClient()

    def get_or_compute(self, subscriber: str, user_data: Dict) -> FeatureResult:
        transform_hash = feature_set_hash()
        try:
            cached = self.store.get(FEATURE_SET_NAME, subscriber, transform_hash)
            if cached:
                features = cached["features"]
                return FeatureResult(
                    features=features,
                    feature_set=FEATURE_SET_NAME,
                    feature_set_hash=transform_hash,
                    source="feature_store",
                    store_available=True,
                    computed_at=cached["computed_at"],
                    drift=drift_report([features]),
                )
        except FeatureStoreUnavailable:
            features = compute_features(user_data)
            store_available = False
            source = "online_store_unavailable"
            try:
                self.store.set(FEATURE_SET_NAME, subscriber, transform_hash, features)
                store_available = True
                source = "online_store_recovered"
            except FeatureStoreUnavailable:
                store_available = False
            return FeatureResult(
                features=features,
                feature_set=FEATURE_SET_NAME,
                feature_set_hash=transform_hash,
                source=source,
                store_available=store_available,
                computed_at=datetime.now(timezone.utc).isoformat(),
                drift=drift_report([features]),
            )

        features = compute_features(user_data)
        store_available = True
        source = "online_cache_miss"
        try:
            self.store.set(FEATURE_SET_NAME, subscriber, transform_hash, features)
        except FeatureStoreUnavailable:
            store_available = False
            source = "online_store_unavailable"

        return FeatureResult(
            features=features,
            feature_set=FEATURE_SET_NAME,
            feature_set_hash=transform_hash,
            source=source,
            store_available=store_available,
            computed_at=datetime.now(timezone.utc).isoformat(),
            drift=drift_report([features]),
        )
