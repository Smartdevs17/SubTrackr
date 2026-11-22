"""Pure renewal decision policy.

The churn model produces a probability; this module turns that number into a
user-safe auto-renewal decision. It has no FastAPI, Redis or network imports so
every branch can be tested deterministically.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Mapping


class PreflightAction(str, Enum):
    RENEW = "renew"
    REVIEW = "review"
    DEFER = "defer"
    BLOCK = "block"


class PreflightReason(str, Enum):
    LOW_RISK = "LOW_RISK"
    ELEVATED_RISK = "ELEVATED_RISK"
    HIGH_RISK = "HIGH_RISK"
    CRITICAL_RISK = "CRITICAL_RISK"
    DEFER_LIMIT_REACHED = "DEFER_LIMIT_REACHED"
    INVALID_PROBABILITY = "INVALID_PROBABILITY"
    STALE_PREDICTION = "STALE_PREDICTION"
    PREDICTION_FAILED = "PREDICTION_FAILED"
    PAYMENT_METHOD_MISSING = "PAYMENT_METHOD_MISSING"
    PAYMENT_METHOD_EXPIRED = "PAYMENT_METHOD_EXPIRED"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class RenewalContext:
    subscription_id: str
    subscriber: str
    renewal_at: datetime
    amount_minor: int
    currency: str
    attempt: int = 1
    payment_method_available: bool = True
    payment_method_expired: bool = False
    previous_decision: PreflightAction | None = None

    def __post_init__(self) -> None:
        if not self.subscription_id.strip():
            raise ValueError("subscription_id must not be empty")
        if not self.subscriber.strip():
            raise ValueError("subscriber must not be empty")
        if not isinstance(self.amount_minor, int) or self.amount_minor <= 0:
            raise ValueError("amount_minor must be a positive integer")
        if not isinstance(self.currency, str) or len(self.currency.strip()) != 3:
            raise ValueError("currency must be a three-letter ISO code")
        if not isinstance(self.attempt, int) or self.attempt < 1:
            raise ValueError("attempt must be a positive integer")
        if not isinstance(self.renewal_at, datetime):
            raise ValueError("renewal_at must be a datetime")


@dataclass(frozen=True)
class ChurnPredictionView:
    probability: float | None
    model_version: str = "unknown"
    risk_level: str | None = None
    predicted_at: datetime | None = None
    risk_factors: tuple[Mapping[str, Any], ...] = ()
    recommended_action: str | None = None


@dataclass(frozen=True)
class PreflightPolicy:
    review_threshold: float = 0.40
    defer_threshold: float = 0.70
    block_threshold: float = 0.90
    max_prediction_age_seconds: int = 24 * 60 * 60
    max_defer_attempts: int = 2
    defer_seconds: int = 15 * 60

    def __post_init__(self) -> None:
        thresholds = (self.review_threshold, self.defer_threshold, self.block_threshold)
        if any(not math.isfinite(threshold) for threshold in thresholds):
            raise ValueError("thresholds must be finite numbers")
        if not 0 <= self.review_threshold < self.defer_threshold < self.block_threshold <= 1:
            raise ValueError("thresholds must satisfy 0 <= review < defer < block <= 1")
        if self.max_prediction_age_seconds < 1:
            raise ValueError("max_prediction_age_seconds must be positive")
        if self.max_defer_attempts < 0:
            raise ValueError("max_defer_attempts must not be negative")
        if self.defer_seconds < 0:
            raise ValueError("defer_seconds must not be negative")


@dataclass(frozen=True)
class PreflightDecision:
    subscription_id: str
    subscriber: str
    action: PreflightAction
    reason: PreflightReason
    risk_level: RiskLevel
    churn_probability: float | None
    model_version: str
    idempotency_key: str
    evaluated_at: datetime
    retry_after_seconds: int | None = None
    recommended_action: str | None = None
    cache_hit: bool = False

    def to_dict(self) -> dict[str, Any]:
        probability = self.churn_probability
        return {
            "subscription_id": self.subscription_id,
            "subscriber": self.subscriber,
            "action": self.action.value,
            "reason": self.reason.value,
            "risk_level": self.risk_level.value,
            "churn_probability": None if probability is None else round(probability, 4),
            "model_version": self.model_version,
            "idempotency_key": self.idempotency_key,
            "evaluated_at": _iso(self.evaluated_at),
            "retry_after_seconds": self.retry_after_seconds,
            "recommended_action": self.recommended_action,
            "cache_hit": self.cache_hit,
        }


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return _as_utc(value).isoformat().replace("+00:00", "Z")


def build_idempotency_key(context: RenewalContext, salt: str = "") -> str:
    """Stable key for one subscription/renewal/attempt combination."""
    payload = "|".join(
        [
            context.subscription_id,
            _iso(context.renewal_at),
            str(context.attempt),
            salt,
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def reason_from_prediction_failure(error: BaseException | None) -> PreflightReason:
    """Translate predictor exceptions into a stable reason code."""
    if isinstance(error, ValueError):
        return PreflightReason.INVALID_PROBABILITY
    return PreflightReason.PREDICTION_FAILED


def _is_valid_probability(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(float(value)) and 0 <= float(value) <= 1


def _recommended_action(
    reason: PreflightReason, prediction: ChurnPredictionView | None
) -> str | None:
    if prediction and prediction.recommended_action and reason in {
        PreflightReason.ELEVATED_RISK,
        PreflightReason.HIGH_RISK,
        PreflightReason.CRITICAL_RISK,
    }:
        return prediction.recommended_action
    return {
        PreflightReason.LOW_RISK: "Proceed with the scheduled renewal.",
        PreflightReason.ELEVATED_RISK: "Surface a retention nudge before charging.",
        PreflightReason.HIGH_RISK: "Pause renewal and offer a retention incentive.",
        PreflightReason.CRITICAL_RISK: "Require explicit confirmation before charging.",
        PreflightReason.DEFER_LIMIT_REACHED: "Escalate to a human instead of deferring again.",
        PreflightReason.INVALID_PROBABILITY: "Check the churn model output before renewing.",
        PreflightReason.STALE_PREDICTION: "Refresh the churn prediction before renewing.",
        PreflightReason.PREDICTION_FAILED: "Retry the pre-flight before renewing.",
        PreflightReason.PAYMENT_METHOD_MISSING: "Ask the subscriber to add a payment method.",
        PreflightReason.PAYMENT_METHOD_EXPIRED: "Ask the subscriber to update the payment method.",
    }[reason]


def evaluate_renewal_preflight(
    prediction: ChurnPredictionView | None,
    context: RenewalContext,
    policy: PreflightPolicy | None = None,
    now: datetime | None = None,
) -> PreflightDecision:
    """Return a deterministic decision for one renewal attempt."""
    policy = policy or PreflightPolicy()
    evaluated_at = _as_utc(now or datetime.now(timezone.utc))
    key = build_idempotency_key(context)
    probability = prediction.probability if prediction else None

    def decision(
        action: PreflightAction,
        reason: PreflightReason,
        risk: RiskLevel,
        *,
        probability_value: float | None = probability,
        retry_after: int | None = None,
        model_version: str | None = None,
    ) -> PreflightDecision:
        return PreflightDecision(
            subscription_id=context.subscription_id,
            subscriber=context.subscriber,
            action=action,
            reason=reason,
            risk_level=risk,
            churn_probability=probability_value,
            model_version=(model_version or (prediction.model_version if prediction else "unknown")),
            idempotency_key=key,
            evaluated_at=evaluated_at,
            retry_after_seconds=retry_after,
            recommended_action=_recommended_action(reason, prediction),
        )

    if not context.payment_method_available:
        return decision(
            PreflightAction.BLOCK,
            PreflightReason.PAYMENT_METHOD_MISSING,
            RiskLevel.UNKNOWN,
            probability_value=None,
        )
    if context.payment_method_expired:
        return decision(
            PreflightAction.BLOCK,
            PreflightReason.PAYMENT_METHOD_EXPIRED,
            RiskLevel.UNKNOWN,
            probability_value=None,
        )
    if prediction is None:
        return decision(
            PreflightAction.REVIEW,
            PreflightReason.PREDICTION_FAILED,
            RiskLevel.UNKNOWN,
            probability_value=None,
        )
    if not _is_valid_probability(probability):
        return decision(
            PreflightAction.REVIEW,
            PreflightReason.INVALID_PROBABILITY,
            RiskLevel.UNKNOWN,
            probability_value=None,
        )

    score = float(probability)
    if prediction.predicted_at is not None:
        age_seconds = (evaluated_at - _as_utc(prediction.predicted_at)).total_seconds()
        if age_seconds > policy.max_prediction_age_seconds:
            return decision(
                PreflightAction.REVIEW,
                PreflightReason.STALE_PREDICTION,
                RiskLevel.UNKNOWN,
            )

    if score >= policy.block_threshold:
        return decision(
            PreflightAction.BLOCK,
            PreflightReason.CRITICAL_RISK,
            RiskLevel.CRITICAL,
        )
    if score >= policy.defer_threshold:
        if context.attempt > policy.max_defer_attempts:
            return decision(
                PreflightAction.REVIEW,
                PreflightReason.DEFER_LIMIT_REACHED,
                RiskLevel.HIGH,
            )
        return decision(
            PreflightAction.DEFER,
            PreflightReason.HIGH_RISK,
            RiskLevel.HIGH,
            retry_after=policy.defer_seconds,
        )
    if score >= policy.review_threshold:
        return decision(
            PreflightAction.REVIEW,
            PreflightReason.ELEVATED_RISK,
            RiskLevel.MEDIUM,
        )
    return decision(
        PreflightAction.RENEW,
        PreflightReason.LOW_RISK,
        RiskLevel.LOW,
    )
