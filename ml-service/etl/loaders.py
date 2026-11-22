"""Feature loading into feature store backends."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional


class BaseFeatureStore(ABC):
    """Base class for feature store backends."""

    @abstractmethod
    def write_features(self, feature_set: str, features: List[Dict[str, Any]]) -> int:
        """Write features to the store. Returns count of features written."""
        ...

    @abstractmethod
    def read_features(self, feature_set: str, keys: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Read features from the store."""
        ...

    @abstractmethod
    def delete_features(self, feature_set: str, keys: List[str]) -> int:
        """Delete features from the store. Returns count deleted."""
        ...

    @abstractmethod
    def list_feature_sets(self) -> List[str]:
        """List all available feature sets."""
        ...


class InMemoryFeatureStore(BaseFeatureStore):
    """In-memory feature store for development and testing."""

    def __init__(self):
        self._store: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def write_features(self, feature_set: str, features: List[Dict[str, Any]]) -> int:
        if feature_set not in self._store:
            self._store[feature_set] = {}

        count = 0
        for feature in features:
            key = feature.get("subscriber") or feature.get("id") or str(count)
            self._store[feature_set][key] = {
                **feature,
                "_loaded_at": datetime.now().isoformat(),
            }
            count += 1
        return count

    def read_features(self, feature_set: str, keys: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        if feature_set not in self._store:
            return []

        store = self._store[feature_set]
        if keys is None:
            return list(store.values())
        return [store[k] for k in keys if k in store]

    def delete_features(self, feature_set: str, keys: List[str]) -> int:
        if feature_set not in self._store:
            return 0
        count = 0
        for key in keys:
            if key in self._store[feature_set]:
                del self._store[feature_set][key]
                count += 1
        return count

    def list_feature_sets(self) -> List[str]:
        return list(self._store.keys())


class BigQueryFeatureStore(BaseFeatureStore):
    """BigQuery feature store backend (stub for production use)."""

    def __init__(self, project_id: str, dataset_id: str = "subtrackr_features"):
        self.project_id = project_id
        self.dataset_id = dataset_id

    def write_features(self, feature_set: str, features: List[Dict[str, Any]]) -> int:
        table_id = f"{self.dataset_id}.{feature_set}"
        # In production: use google.cloud.bigquery client to insert rows
        # client.insert_rows_json(table_id, features)
        return len(features)

    def read_features(self, feature_set: str, keys: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        # In production: query BigQuery table
        # query = f"SELECT * FROM `{table_id}`"
        return []

    def delete_features(self, feature_set: str, keys: List[str]) -> int:
        return 0

    def list_feature_sets(self) -> List[str]:
        return []


class RedisFeatureStore(BaseFeatureStore):
    """Redis feature store backend for low-latency feature serving."""

    def __init__(self, connection_string: str = "redis://localhost:6379"):
        self.connection_string = connection_string
        self._client = None

    def _get_client(self):
        if self._client is None:
            # In production: import redis; self._client = redis.from_url(self.connection_string)
            pass
        return self._client

    def write_features(self, feature_set: str, features: List[Dict[str, Any]]) -> int:
        client = self._get_client()
        if client is None:
            return 0
        count = 0
        for feature in features:
            key = feature.get("subscriber") or feature.get("id") or str(count)
            hash_key = f"features:{feature_set}:{key}"
            # client.hset(hash_key, mapping={k: str(v) for k, v in feature.items()})
            count += 1
        return count

    def read_features(self, feature_set: str, keys: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        return []

    def delete_features(self, feature_set: str, keys: List[str]) -> int:
        return 0

    def list_feature_sets(self) -> List[str]:
        return []


STORE_REGISTRY = {
    "inmemory": InMemoryFeatureStore,
    "bigquery": BigQueryFeatureStore,
    "redis": RedisFeatureStore,
}


def create_feature_store(store_type: str = "inmemory", **kwargs) -> BaseFeatureStore:
    """Factory to create feature store instances."""
    store_class = STORE_REGISTRY.get(store_type)
    if store_class is None:
        raise ValueError(f"Unknown feature store type: {store_type}")
    return store_class(**kwargs)
