"""Auto-renewal pre-flight driven by the churn model.

The package exposes a small, dependency-light policy engine plus an optional
FastAPI surface. Keeping the policy separate from the HTTP layer lets both the
ML service and its tests reason about renewal decisions without booting a
server.
"""

from .policy import (
    ChurnPredictionView,
    PreflightAction,
    PreflightDecision,
    PreflightPolicy,
    PreflightReason,
    RenewalContext,
    RiskLevel,
    build_idempotency_key,
    evaluate_renewal_preflight,
    reason_from_prediction_failure,
)
from .predictor import ChurnFeaturesInput, ChurnPredictionError, ModelChurnPredictor, Predictor
from .service import (
    PreflightTelemetry,
    RenewalPreflightRequest,
    RenewalPreflightService,
    StructuredTelemetry,
)

__all__ = [
    "ChurnFeaturesInput",
    "ChurnPredictionError",
    "ChurnPredictionView",
    "ModelChurnPredictor",
    "Predictor",
    "PreflightAction",
    "PreflightDecision",
    "PreflightPolicy",
    "PreflightReason",
    "PreflightTelemetry",
    "RenewalContext",
    "RenewalPreflightRequest",
    "RenewalPreflightService",
    "RiskLevel",
    "StructuredTelemetry",
    "build_idempotency_key",
    "evaluate_renewal_preflight",
    "reason_from_prediction_failure",
]
