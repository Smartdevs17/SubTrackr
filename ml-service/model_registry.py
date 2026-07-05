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
