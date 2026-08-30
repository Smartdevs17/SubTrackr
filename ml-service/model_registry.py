"""
SubTrackr Model Registry

Provides persistent model metadata and weight storage backed by a JSON file
on the local filesystem.  In a production deployment this can be swapped for
an S3-backed or database-backed registry without changing callers.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class _ModelMeta:
    """In-memory counters for a live model instance."""

    def __init__(self, version: str) -> None:
        self.version = version
        self._predictions = 0
        self._errors = 0
        self._lock = Lock()

    def record_prediction(self) -> None:
        with self._lock:
            self._predictions += 1

    def record_error(self) -> None:
        with self._lock:
            self._errors += 1

    def stats(self) -> Dict[str, int]:
        return {"predictions": self._predictions, "errors": self._errors}


class ModelRegistry:
    """
    JSON file-backed model registry.

    Layout on disk::

        {storage_dir}/
            {model_id}.json   – weights + metadata snapshot
    """

    def __init__(self, storage_dir: str = "./models") -> None:
        self.storage_dir = storage_dir
        os.makedirs(self.storage_dir, exist_ok=True)
        self._meta: Dict[str, _ModelMeta] = {}
        self._lock = Lock()

        # Ensure default version exists
        if not os.path.exists(self._path("v1.0")):
            self.save_model(
                "v1.0",
                {
                    "version": "v1.0",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "feature_weights": {
                        "payment_failures": 0.40,
                        "login_frequency_drop": 0.25,
                        "support_tickets": 0.15,
                        "app_crashes": 0.10,
                        "price_sensitivity": 0.10,
                    },
                    "training_metrics": {},
                },
            )

    # ── Low-level helpers ──────────────────────────────────────────────────────

    def _path(self, model_id: str) -> str:
        # Sanitise model_id to prevent path traversal
        safe_id = "".join(c for c in model_id if c.isalnum() or c in "-_.")
        return os.path.join(self.storage_dir, f"{safe_id}.json")

    # ── Public API ─────────────────────────────────────────────────────────────

    def save_model(self, model_id: str, model_data: Dict[str, Any]) -> None:
        """Persist model data to disk."""
        model_data.setdefault("version", model_id)
        model_data.setdefault("saved_at", datetime.now(timezone.utc).isoformat())
        path = self._path(model_id)
        with self._lock:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(model_data, fh, indent=2)
        logger.info("Model %s saved to %s", model_id, path)

    def load_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Load model data from disk; returns ``None`` if not found."""
        path = self._path(model_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as exc:
            logger.warning("Failed to load model %s: %s", model_id, exc)
            return None

    def list_models(self) -> List[str]:
        """Return all persisted model IDs, sorted newest-first by filename."""
        try:
            names = [
                os.path.splitext(f)[0]
                for f in sorted(os.listdir(self.storage_dir), reverse=True)
                if f.endswith(".json")
            ]
            return names
        except OSError:
            return []

    def latest_version(self) -> Optional[str]:
        """Return the most recently saved model ID."""
        models = self.list_models()
        return models[0] if models else None

    def retrain_model(
        self,
        new_data: List[Dict[str, Any]],
        base_version: str = "v1.0",
    ) -> str:
        """
        Simulate (or perform) a retraining pipeline.

        If ``new_data`` is non-empty and scikit-learn is available the method
        trains a real GBM and persists the resulting weights.  Otherwise it
        bumps the feature weights heuristically and saves a new version.

        Returns the new version string.
        """
        from datetime import datetime, timezone  # local import to avoid circular

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        new_version = f"v{timestamp}"

        updated_weights = {
            "payment_failures": 0.45,
            "login_frequency_drop": 0.22,
            "support_tickets": 0.15,
            "app_crashes": 0.10,
            "price_sensitivity": 0.08,
        }
        training_metrics: Dict[str, Any] = {"sample_count": len(new_data)}

        if new_data:
            try:
                from models import ChurnPredictionModel

                tmp_model = ChurnPredictionModel()
                metrics = tmp_model.train(new_data)
                updated_weights = tmp_model.feature_weights
                training_metrics.update(metrics)
                logger.info("Real GBM training completed; %d samples", len(new_data))
            except Exception as exc:
                logger.warning("GBM training failed (%s), using heuristic bump", exc)

        self.save_model(
            new_version,
            {
                "version": new_version,
                "base_version": base_version,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "feature_weights": updated_weights,
                "training_metrics": training_metrics,
            },
        )

        return new_version

    # ── Runtime metadata (in-memory) ───────────────────────────────────────────

    def meta(self, model_name: str) -> _ModelMeta:
        """Return (creating if needed) the runtime metadata tracker for a model."""
        if model_name not in self._meta:
            with self._lock:
                if model_name not in self._meta:
                    self._meta[model_name] = _ModelMeta(model_name)
        return self._meta[model_name]

    def get(self, model_name: str):
        """Convenience accessor – returns the ChurnPredictionModel singleton."""
        # The router modules call registry.get("churn") to stay compatible.
        from models import ChurnPredictionModel, RevenueForecastModel  # lazy import

        _MODEL_MAP = {
            "churn": ChurnPredictionModel,
            "revenue_forecast": RevenueForecastModel,
        }
        cls = _MODEL_MAP.get(model_name)
        if cls is None:
            raise KeyError(f"Unknown model name: {model_name!r}")
        # Return a new instance; callers in main.py use module-level singletons
        return cls()


# Module-level singleton kept for backward-compat with existing code
registry = ModelRegistry()
