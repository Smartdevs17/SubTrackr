"""Adapter from the existing churn model to the renewal pre-flight policy."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol

from .policy import ChurnPredictionView


class ChurnPredictionError(RuntimeError):
    """Raised when the churn model cannot produce a usable probability."""


@dataclass(frozen=True)
class ChurnFeaturesInput:
    """Caller-supplied signals; names match the inference API contract."""

    recent_payment_failures: int = 0
    baseline_logins_per_month: float = 10
    recent_logins: float = 10
    open_support_tickets: int = 0
    price_sensitivity_index: float = 0.5

    def __post_init__(self) -> None:
        if self.recent_payment_failures < 0:
            raise ValueError("recent_payment_failures must not be negative")
        if self.baseline_logins_per_month <= 0:
            raise ValueError("baseline_logins_per_month must be positive")
        if self.recent_logins < 0:
            raise ValueError("recent_logins must not be negative")
        if self.open_support_tickets < 0:
            raise ValueError("open_support_tickets must not be negative")
        if not 0 <= self.price_sensitivity_index <= 1:
            raise ValueError("price_sensitivity_index must be between 0 and 1")

    def to_dict(self) -> dict[str, Any]:
        return {
            "recent_payment_failures": self.recent_payment_failures,
            "baseline_logins_per_month": self.baseline_logins_per_month,
            "recent_logins": self.recent_logins,
            "open_support_tickets": self.open_support_tickets,
            "price_sensitivity_index": self.price_sensitivity_index,
        }


class Predictor(Protocol):
    def predict(self, subscriber: str, features: ChurnFeaturesInput) -> ChurnPredictionView:
        ...


class ModelChurnPredictor:
    """Runs the repository's heuristic churn model behind a typed interface."""

    def __init__(self, model: Any = None, model_version: str = "v1.1") -> None:
        self.model_version = model_version
        self._model = model
        if self._model is None:
            # Imported lazily so importing the policy package never requires the
            # rest of the ML service to be importable (e.g. in pure unit tests).
            from models import ChurnPredictionModel

            self._model = ChurnPredictionModel()

    def predict(self, subscriber: str, features: ChurnFeaturesInput) -> ChurnPredictionView:
        try:
            raw: Mapping[str, Any] = self._model.predict_churn(subscriber, features.to_dict())
        except Exception as exc:  # model failures must become a review decision
            raise ChurnPredictionError(str(exc)) from exc

        probability = raw.get("churn_probability")
        try:
            parsed_probability = None if probability is None else float(probability)
        except (TypeError, ValueError) as exc:
            raise ChurnPredictionError("churn model returned a non-numeric probability") from exc

        risk_factors = raw.get("risk_factors", ())
        if not isinstance(risk_factors, (list, tuple)):
            risk_factors = ()

        return ChurnPredictionView(
            probability=parsed_probability,
            model_version=self.model_version,
            risk_level=str(raw["risk_level"]) if raw.get("risk_level") else None,
            predicted_at=datetime.now(timezone.utc),
            risk_factors=tuple(risk_factors),
            recommended_action=(
                str(raw["recommended_action"]) if raw.get("recommended_action") else None
            ),
        )
