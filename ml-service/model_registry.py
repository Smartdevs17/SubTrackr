import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import logging

logger = logging.getLogger(__name__)

REGISTRY_FILE = os.path.join(os.path.dirname(__file__), "model_versions.json")


@dataclass
class ModelMeta:
    name: str
    version: str
    loaded_at: float = field(default_factory=time.time)
    prediction_count: int = 0
    error_count: int = 0
    # Running accuracy tracking for drift detection
    accuracy_window: list = field(default_factory=list)

    def record_prediction(self):
        self.prediction_count += 1

    def record_error(self):
        self.error_count += 1

    def record_accuracy(self, correct: bool):
        self.accuracy_window.append(1 if correct else 0)
        if len(self.accuracy_window) > 500:
            self.accuracy_window.pop(0)

    @property
    def recent_accuracy(self) -> Optional[float]:
        if not self.accuracy_window:
            return None
        return round(sum(self.accuracy_window) / len(self.accuracy_window), 4)

    @property
    def drift_detected(self) -> bool:
        acc = self.recent_accuracy
        return acc is not None and acc < 0.70


class ModelRegistry:
    def __init__(self):
        self._models: Dict[str, Any] = {}
        self._meta: Dict[str, ModelMeta] = {}
        self._versions = self._load_version_file()
        # Explanation storage and aggregates
        self._explanations_file = os.path.join(os.path.dirname(__file__), "explanations.json")
        # in-memory aggregates: {model_name: {feature: {"sum_abs": float, "count": int}}}
        self._explanation_aggregates: Dict[str, Dict[str, Dict[str, float]]] = {}
        # segment profiles: {model_name: {segment_key: {feature: avg_value}}}
        self._segment_profiles: Dict[str, Dict[str, Dict[str, float]]] = {}

    def _load_version_file(self) -> Dict:
        if os.path.exists(REGISTRY_FILE):
            with open(REGISTRY_FILE) as f:
                return json.load(f)
        return {
            "churn": "1.0.0",
            "recommendations": "1.0.0",
            "pricing": "1.0.0",
        }

    def load_all(self):
        from backend.ml.churnModel import ChurnPredictionModel, RevenueForecastModel
        from backend.ml.recommendationModel import RecommendationEngine
        from backend.ml.pricingModel import PricingOptimizationEngine

        self._models["churn"] = ChurnPredictionModel()
        self._models["revenue_forecast"] = RevenueForecastModel()
        self._models["recommendations"] = RecommendationEngine()
        self._models["pricing"] = PricingOptimizationEngine()

        for name in ["churn", "recommendations", "pricing"]:
            self._meta[name] = ModelMeta(name=name, version=self._versions.get(name, "1.0.0"))

        logger.info(f"Loaded models: {list(self._models.keys())}")

    def _append_explanation_file(self, record: Dict):
        try:
            data = []
            if os.path.exists(self._explanations_file):
                with open(self._explanations_file, "r") as f:
                    try:
                        data = json.load(f)
                    except Exception:
                        data = []
            data.append(record)
            with open(self._explanations_file, "w") as f:
                json.dump(data, f)
        except Exception as e:
            logger.exception("Failed to write explanation record: %s", e)

    def record_explanation(self, model_name: str, subscriber: str, input_features: Dict, attributions: Dict, segment: Optional[str] = None):
        """Store an explanation audit record and update aggregates and segment profiles."""
        ts = time.time()
        record = {
            "timestamp": ts,
            "model": model_name,
            "subscriber": subscriber,
            "segment": segment,
            "input_features": input_features,
            "attributions": attributions,
        }
        # append to file (audit trail)
        self._append_explanation_file(record)

        # update aggregates
        agg = self._explanation_aggregates.setdefault(model_name, {})
        for feat, val in (attributions or {}).items():
            entry = agg.setdefault(feat, {"sum_abs": 0.0, "count": 0})
            entry["sum_abs"] += abs(float(val))
            entry["count"] += 1

        # update segment profiles (simple running avg of attributions)
        if segment:
            segmap = self._segment_profiles.setdefault(model_name, {})
            profile = segmap.setdefault(segment, {})
            for feat, val in (attributions or {}).items():
                prev = profile.get(feat, {"sum": 0.0, "count": 0})
                prev["sum"] += float(val)
                prev["count"] += 1
                profile[feat] = prev

    def get_global_feature_importance(self, model_name: str) -> Dict[str, float]:
        """Return average absolute attribution per feature for a model."""
        agg = self._explanation_aggregates.get(model_name, {})
        out = {}
        for feat, v in agg.items():
            if v["count"]:
                out[feat] = round(v["sum_abs"] / v["count"], 6)
        return out

    def get_segment_profile(self, model_name: str, segment: str) -> Dict[str, float]:
        segmap = self._segment_profiles.get(model_name, {})
        profile = segmap.get(segment, {})
        return {feat: round(vals["sum"] / vals["count"], 6) for feat, vals in profile.items() if vals["count"]}

    def get(self, name: str) -> Any:
        model = self._models.get(name)
        if model is None:
            raise KeyError(f"Model '{name}' not found in registry")
        return model

    def meta(self, name: str) -> ModelMeta:
        return self._meta.get(name, ModelMeta(name=name, version="unknown"))

    def all_meta(self) -> Dict[str, dict]:
        return {
            name: {
                "version": m.version,
                "prediction_count": m.prediction_count,
                "error_count": m.error_count,
                "recent_accuracy": m.recent_accuracy,
                "drift_detected": m.drift_detected,
            }
            for name, m in self._meta.items()
        }
