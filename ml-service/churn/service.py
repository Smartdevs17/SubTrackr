"""Orchestration around the pure renewal pre-flight policy."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from .policy import (
    ChurnPredictionView,
    PreflightDecision,
    PreflightPolicy,
    RenewalContext,
    build_idempotency_key,
    evaluate_renewal_preflight,
    reason_from_prediction_failure,
)
from .predictor import ChurnFeaturesInput, Predictor


@dataclass(frozen=True)
class RenewalPreflightRequest:
    context: RenewalContext
    features: ChurnFeaturesInput


class PreflightTelemetry(Protocol):
    def counter(self, name: str, **labels: Any) -> None:
        ...

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        ...


class StructuredTelemetry:
    """JSON log sink that works without a metrics agent installed."""

    def __init__(self, logger_name: str = "churn.preflight") -> None:
        self._logger = logging.getLogger(logger_name)

    def _emit(self, kind: str, name: str, **labels: Any) -> None:
        self._logger.info(
            json.dumps({"kind": kind, "metric": name, **labels}, default=str, sort_keys=True)
        )

    def counter(self, name: str, **labels: Any) -> None:
        self._emit("counter", name, **labels)

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        self._emit("gauge", name, value=value, **labels)


class RenewalPreflightService:
    """Runs prediction + policy with idempotency and structured telemetry."""

    def __init__(
        self,
        predictor: Predictor,
        policy: PreflightPolicy | None = None,
        telemetry: PreflightTelemetry | None = None,
        now: Any = None,
        idempotency_ttl_seconds: int = 300,
    ) -> None:
        self.predictor = predictor
        self.policy = policy or PreflightPolicy()
        self.telemetry = telemetry or StructuredTelemetry()
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._ttl = timedelta(seconds=max(1, idempotency_ttl_seconds))
        self._cache: dict[str, tuple[datetime, PreflightDecision]] = {}

    def evaluate(
        self, request: RenewalPreflightRequest, *, force: bool = False
    ) -> PreflightDecision:
        now = self._now()
        key = build_idempotency_key(request.context)
        self._prune(now)

        if not force and key in self._cache:
            cached = self._cache[key][1]
            self.telemetry.counter(
                "renewal_preflight_cache_hit",
                action=cached.action.value,
                subscription_id=request.context.subscription_id,
            )
            return replace(cached, cache_hit=True)

        prediction: ChurnPredictionView | None = None
        prediction_error: BaseException | None = None
        try:
            prediction = self.predictor.predict(request.context.subscriber, request.features)
        except Exception as exc:  # policy must still produce a safe decision
            prediction_error = exc

        decision = evaluate_renewal_preflight(prediction, request.context, self.policy, now)
        if prediction_error is not None:
            decision = replace(
                decision,
                reason=reason_from_prediction_failure(prediction_error),
                model_version=prediction.model_version if prediction else "unknown",
            )
            self.telemetry.counter(
                "renewal_preflight_prediction_failed",
                error_type=type(prediction_error).__name__,
                subscription_id=request.context.subscription_id,
            )

        self._cache[key] = (now, decision)
        self.telemetry.counter(
            "renewal_preflight_decision",
            action=decision.action.value,
            reason=decision.reason.value,
            risk_level=decision.risk_level.value,
            subscription_id=request.context.subscription_id,
        )
        probability = decision.churn_probability
        self.telemetry.gauge(
            "renewal_preflight_churn_probability",
            float(probability) if probability is not None else -1,
            subscription_id=request.context.subscription_id,
        )
        return decision

    def clear_cache(self) -> None:
        self._cache.clear()

    def _prune(self, now: datetime) -> None:
        expired = [key for key, (stored_at, _) in self._cache.items() if now - stored_at > self._ttl]
        for key in expired:
            self._cache.pop(key, None)
