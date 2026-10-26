"""ETL pipeline orchestration for ML feature engineering."""

import time
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

from .config import ETLConfig
from .extractors import BaseExtractor, EXTRACTORS
from .transformers import BaseTransformer, TRANSFORMERS
from .loaders import BaseFeatureStore, create_feature_store
from .monitoring import ETLMonitor

logger = logging.getLogger(__name__)


@dataclass
class PipelineResult:
    """Result of a pipeline execution."""
    success: bool
    records_extracted: int = 0
    records_transformed: int = 0
    records_loaded: int = 0
    duration_ms: float = 0.0
    errors: List[str] = field(default_factory=list)
    feature_sets_updated: List[str] = field(default_factory=list)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


class ETLPipeline:
    """Main ETL pipeline orchestrator.

    Coordinates extraction, transformation, and loading of ML features.
    Supports configurable pipeline stages, monitoring, and error handling.
    """

    def __init__(self, config: Optional[ETLConfig] = None):
        self.config = config or ETLConfig()
        self._extractors: Dict[str, BaseExtractor] = {}
        self._transformers: List[BaseTransformer] = []
        self._feature_store: Optional[BaseFeatureStore] = None
        self._monitor = ETLMonitor(self.config.monitoring)
        self._hooks: Dict[str, List[Callable]] = {
            "before_extract": [],
            "after_extract": [],
            "before_transform": [],
            "after_transform": [],
            "before_load": [],
            "after_load": [],
            "on_error": [],
        }

        self._init_default_extractors()
        self._init_feature_store()

    def _init_default_extractors(self):
        for source_name, extractor_cls in EXTRACTORS.items():
            self._extractors[source_name] = extractor_cls()

    def _init_feature_store(self):
        store_cfg = self.config.feature_store
        kwargs = {"connection_string": store_cfg.connection_string} if store_cfg.connection_string else {}
        if store_cfg.project_id:
            kwargs["project_id"] = store_cfg.project_id
            kwargs["dataset_id"] = store_cfg.dataset_id
        self._feature_store = create_feature_store(store_cfg.store_type.value, **kwargs)

    def register_extractor(self, name: str, extractor: BaseExtractor):
        self._extractors[name] = extractor

    def add_transformer(self, transformer: BaseTransformer):
        self._transformers.append(transformer)

    def hook(self, event: str, callback: Callable):
        if event in self._hooks:
            self._hooks[event].append(callback)

    def _fire_hooks(self, event: str, data: Any):
        for callback in self._hooks.get(event, []):
            try:
                callback(data)
            except Exception as e:
                logger.warning(f"Hook {event} callback failed: {e}")

    def run(self, source_data: Optional[Dict[str, Any]] = None) -> PipelineResult:
        """Execute the full ETL pipeline."""
        start_time = time.time()
        result = PipelineResult(success=False)

        try:
            self._monitor.record_pipeline_start()
            self._fire_hooks("before_extract", source_data)

            # Extract
            all_features = []
            for source_name in self.config.feature_sources:
                if source_name not in self._extractors:
                    result.errors.append(f"No extractor for source: {source_name}")
                    continue

                extractor = self._extractors[source_name]
                source_cfg = source_data or {}
                raw_data = extractor.extract({source_name: source_cfg.get(source_name, [])})

                if not extractor.validate(raw_data):
                    result.errors.append(f"Validation failed for source: {source_name}")
                    continue

                all_features.extend(raw_data)

            result.records_extracted = len(all_features)
            self._fire_hooks("after_extract", all_features)

            # Transform
            self._fire_hooks("before_transform", all_features)
            transformed = all_features
            for transformer in self._transformers:
                transformed = transformer.transform(transformed)

            result.records_transformed = len(transformed)
            self._fire_hooks("after_transform", transformed)

            # Load
            self._fire_hooks("before_load", transformed)
            loaded_count = self._load_features(transformed)
            result.records_loaded = loaded_count
            result.feature_sets_updated = list(set(
                f.get("feature_set", "default") for f in transformed
            ))
            self._fire_hooks("after_load", loaded_count)

            result.success = len(result.errors) == 0

        except Exception as e:
            result.errors.append(str(e))
            self._fire_hooks("on_error", e)
            logger.error(f"Pipeline execution failed: {e}")

        finally:
            result.duration_ms = (time.time() - start_time) * 1000
            self._monitor.record_pipeline_end(result)
            self._monitor.log_pipeline_result(result)

        return result

    def _load_features(self, features: List[Dict[str, Any]]) -> int:
        if self._feature_store is None:
            return 0

        grouped: Dict[str, List[Dict[str, Any]]] = {}
        for feature in features:
            feature_set = feature.pop("feature_set", "default")
            grouped.setdefault(feature_set, []).append(feature)

        total_loaded = 0
        for feature_set, feature_list in grouped.items():
            total_loaded += self._feature_store.write_features(feature_set, feature_list)

        return total_loaded

    def get_feature_store(self) -> Optional[BaseFeatureStore]:
        return self._feature_store

    def get_monitor(self) -> ETLMonitor:
        return self._monitor
