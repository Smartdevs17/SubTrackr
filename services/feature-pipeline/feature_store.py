import json
from dataclasses import dataclass
from typing import Dict, Iterable, Optional

from config import FEATURE_STORE_URL, FEATURE_TTL_SECONDS, REFERENCE_TTL_SECONDS

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None


class FeatureStoreUnavailable(RuntimeError):
    pass


@dataclass
class FeatureRecord:
    feature_set: str
    entity_id: str
    transform_hash: str
    features: Dict[str, float]
    computed_at: str


class RedisFeatureStore:
    def __init__(self, url: str = FEATURE_STORE_URL, ttl_seconds: int = FEATURE_TTL_SECONDS):
        self.url = url
        self.ttl_seconds = ttl_seconds
        self._client = None

    @property
    def client(self):
        if redis is None:
            raise FeatureStoreUnavailable("redis package is not installed")
        if self._client is None:
            self._client = redis.Redis.from_url(self.url, decode_responses=True)
        return self._client

    def ping(self) -> bool:
        try:
            return bool(self.client.ping())
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc

    @staticmethod
    def key(feature_set: str, entity_id: str, transform_hash: str) -> str:
        return f"features:{feature_set}:{transform_hash}:{entity_id}"

    @staticmethod
    def reference_key(feature_set: str, transform_hash: str, feature_name: str) -> str:
        return f"features:reference:{feature_set}:{transform_hash}:{feature_name}"

    def get(self, feature_set: str, entity_id: str, transform_hash: str) -> Optional[FeatureRecord]:
        key = self.key(feature_set, entity_id, transform_hash)
        try:
            raw = self.client.get(key)
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc
        if not raw:
            return None
        return FeatureRecord(**json.loads(raw))

    def set(self, record: FeatureRecord, ttl_seconds: Optional[int] = None) -> None:
        key = self.key(record.feature_set, record.entity_id, record.transform_hash)
        try:
            self.client.setex(key, ttl_seconds or self.ttl_seconds, json.dumps(record.__dict__))
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc

    def put_reference_distribution(
        self,
        feature_set: str,
        transform_hash: str,
        distributions: Dict[str, Iterable[float]],
    ) -> None:
        try:
            pipe = self.client.pipeline()
            for feature_name, values in distributions.items():
                pipe.setex(
                    self.reference_key(feature_set, transform_hash, feature_name),
                    REFERENCE_TTL_SECONDS,
                    json.dumps([float(value) for value in values]),
                )
            pipe.execute()
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc

    def get_reference_distribution(
        self,
        feature_set: str,
        transform_hash: str,
        feature_name: str,
    ) -> Optional[list[float]]:
        try:
            raw = self.client.get(self.reference_key(feature_set, transform_hash, feature_name))
        except Exception as exc:
            raise FeatureStoreUnavailable(str(exc)) from exc
        return json.loads(raw) if raw else None
