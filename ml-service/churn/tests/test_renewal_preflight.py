"""Tests for the auto-renewal pre-flight policy, service and HTTP surface."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

ML_SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ML_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, ML_SERVICE_ROOT)

from churn import (  # noqa: E402
    ChurnFeaturesInput,
    ChurnPredictionError,
    ChurnPredictionView,
    PreflightAction,
    PreflightPolicy,
    PreflightReason,
    RenewalContext,
    RenewalPreflightRequest,
    RenewalPreflightService,
    RiskLevel,
    build_idempotency_key,
    evaluate_renewal_preflight,
)
from churn.api import app, get_preflight_service  # noqa: E402

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)
RENEWAL_AT = datetime(2026, 11, 25, 0, 0, tzinfo=timezone.utc)


class FakePredictor:
    def __init__(self, view: ChurnPredictionView | None = None, error: Exception | None = None):
        self.view = view
        self.error = error
        self.calls = 0

    def predict(self, subscriber: str, features: ChurnFeaturesInput) -> ChurnPredictionView:
        self.calls += 1
        if self.error:
            raise self.error
        assert self.view is not None
        return self.view


class RecordingTelemetry:
    def __init__(self) -> None:
        self.counters: list[tuple[str, dict[str, Any]]] = []
        self.gauges: list[tuple[str, float, dict[str, Any]]] = []

    def counter(self, name: str, **labels: Any) -> None:
        self.counters.append((name, labels))

    def gauge(self, name: str, value: float, **labels: Any) -> None:
        self.gauges.append((name, value, labels))


def context(**overrides: Any) -> RenewalContext:
    values: dict[str, Any] = {
        "subscription_id": "sub-1",
        "subscriber": "0xABC",
        "renewal_at": RENEWAL_AT,
        "amount_minor": 1999,
        "currency": "USD",
    }
    values.update(overrides)
    return RenewalContext(**values)


def prediction(probability: float, **overrides: Any) -> ChurnPredictionView:
    values: dict[str, Any] = {
        "probability": probability,
        "model_version": "v1-test",
        "predicted_at": NOW,
    }
    values.update(overrides)
    return ChurnPredictionView(**values)


def decide(view: ChurnPredictionView | None, ctx: RenewalContext | None = None, **kwargs: Any):
    return evaluate_renewal_preflight(view, ctx or context(), now=NOW, **kwargs)


class TestPolicy:
    def test_low_probability_renews(self):
        decision = decide(prediction(0.1))

        assert decision.action is PreflightAction.RENEW
        assert decision.reason is PreflightReason.LOW_RISK
        assert decision.risk_level is RiskLevel.LOW
        assert decision.retry_after_seconds is None

    def test_elevated_probability_reviews(self):
        decision = decide(prediction(0.55))

        assert decision.action is PreflightAction.REVIEW
        assert decision.reason is PreflightReason.ELEVATED_RISK
        assert decision.risk_level is RiskLevel.MEDIUM

    def test_high_probability_defers_once_then_reviews(self):
        first = decide(prediction(0.8))

        assert first.action is PreflightAction.DEFER
        assert first.reason is PreflightReason.HIGH_RISK
        assert first.retry_after_seconds == 900

        exhausted = decide(prediction(0.8), context(attempt=3))

        assert exhausted.action is PreflightAction.REVIEW
        assert exhausted.reason is PreflightReason.DEFER_LIMIT_REACHED

    def test_critical_probability_blocks(self):
        decision = decide(prediction(0.95))

        assert decision.action is PreflightAction.BLOCK
        assert decision.reason is PreflightReason.CRITICAL_RISK
        assert decision.risk_level is RiskLevel.CRITICAL

    @pytest.mark.parametrize("bad_probability", [None, float("nan"), -0.1, 1.2, "0.5"])
    def test_invalid_probability_fails_closed_to_review(self, bad_probability):
        decision = decide(prediction(bad_probability))

        assert decision.action is PreflightAction.REVIEW
        assert decision.reason is PreflightReason.INVALID_PROBABILITY
        assert decision.risk_level is RiskLevel.UNKNOWN
        assert decision.churn_probability is None

    def test_missing_prediction_fails_closed_to_review(self):
        decision = decide(None)

        assert decision.action is PreflightAction.REVIEW
        assert decision.reason is PreflightReason.PREDICTION_FAILED
        assert decision.churn_probability is None

    def test_stale_prediction_is_not_trusted(self):
        stale = prediction(0.2, predicted_at=NOW - timedelta(hours=25))
        decision = decide(stale)

        assert decision.action is PreflightAction.REVIEW
        assert decision.reason is PreflightReason.STALE_PREDICTION

    def test_payment_gates_override_the_model(self):
        missing = decide(prediction(0.01), context(payment_method_available=False))
        expired = decide(prediction(0.01), context(payment_method_expired=True))

        assert missing.action is PreflightAction.BLOCK
        assert missing.reason is PreflightReason.PAYMENT_METHOD_MISSING
        assert expired.action is PreflightAction.BLOCK
        assert expired.reason is PreflightReason.PAYMENT_METHOD_EXPIRED
        assert missing.churn_probability is None

    def test_custom_thresholds_are_applied(self):
        policy = PreflightPolicy(review_threshold=0.6, defer_threshold=0.8, block_threshold=0.99)
        decision = decide(prediction(0.5), policy=policy)

        assert decision.action is PreflightAction.RENEW

    def test_invalid_policy_is_rejected(self):
        with pytest.raises(ValueError):
            PreflightPolicy(review_threshold=0.9, defer_threshold=0.5)

    def test_invalid_context_is_rejected(self):
        with pytest.raises(ValueError):
            context(amount_minor=0)

    def test_idempotency_key_is_stable_per_attempt(self):
        first = context()
        second = context(renewal_at=RENEWAL_AT, attempt=1)
        third = context(attempt=2)

        assert build_idempotency_key(first) == build_idempotency_key(second)
        assert build_idempotency_key(first) != build_idempotency_key(third)
        assert decide(prediction(0.1), first).idempotency_key == build_idempotency_key(first)

    def test_decision_serialises_for_the_api(self):
        payload = decide(prediction(0.81234)).to_dict()

        assert payload["action"] == "review"
        assert payload["churn_probability"] == 0.8123
        assert payload["evaluated_at"] == "2026-11-20T12:00:00Z"
        assert payload["risk_level"] == "medium"


class TestPreflightService:
    def request(self, **overrides: Any) -> RenewalPreflightRequest:
        return RenewalPreflightRequest(
            context=context(**overrides),
            features=ChurnFeaturesInput(recent_payment_failures=1),
        )

    def test_predictor_output_drives_the_decision(self):
        predictor = FakePredictor(prediction(0.95))
        service = RenewalPreflightService(predictor, now=lambda: NOW)

        decision = service.evaluate(self.request())

        assert predictor.calls == 1
        assert decision.action is PreflightAction.BLOCK

    def test_predictor_failure_becomes_a_review_decision(self):
        predictor = FakePredictor(error=ChurnPredictionError("model exploded"))
        telemetry = RecordingTelemetry()
        service = RenewalPreflightService(predictor, telemetry=telemetry, now=lambda: NOW)

        decision = service.evaluate(self.request())

        assert decision.action is PreflightAction.REVIEW
        assert decision.reason is PreflightReason.PREDICTION_FAILED
        assert ("renewal_preflight_prediction_failed", {"error_type": "ChurnPredictionError", "subscription_id": "sub-1"}) in telemetry.counters

    def test_value_error_uses_invalid_probability_reason(self):
        predictor = FakePredictor(error=ValueError("bad score"))
        service = RenewalPreflightService(predictor, now=lambda: NOW)

        assert service.evaluate(self.request()).reason is PreflightReason.INVALID_PROBABILITY

    def test_repeated_requests_are_idempotent_until_forced(self):
        predictor = FakePredictor(prediction(0.1))
        service = RenewalPreflightService(predictor, now=lambda: NOW)

        first = service.evaluate(self.request())
        cached = service.evaluate(self.request())
        forced = service.evaluate(self.request(), force=True)

        assert first.cache_hit is False
        assert cached.cache_hit is True
        assert cached.idempotency_key == first.idempotency_key
        assert forced.cache_hit is False
        assert predictor.calls == 2

    def test_cache_expires_after_ttl(self):
        clock = {"now": NOW}
        predictor = FakePredictor(prediction(0.1))
        service = RenewalPreflightService(
            predictor, now=lambda: clock["now"], idempotency_ttl_seconds=60
        )

        service.evaluate(self.request())
        clock["now"] = NOW + timedelta(seconds=61)

        assert service.evaluate(self.request()).cache_hit is False

    def test_telemetry_emits_decision_and_probability(self):
        telemetry = RecordingTelemetry()
        predictor = FakePredictor(prediction(0.42))
        service = RenewalPreflightService(predictor, telemetry=telemetry, now=lambda: NOW)

        service.evaluate(self.request())

        assert telemetry.counters[-1][0] == "renewal_preflight_decision"
        assert telemetry.counters[-1][1]["action"] == "review"
        assert telemetry.gauges[-1][1] == pytest.approx(0.42)


class TestHTTPSurface:
    def test_preflight_endpoint_returns_a_normalised_decision(self):
        service = RenewalPreflightService(FakePredictor(prediction(0.95)), now=lambda: NOW)
        app.dependency_overrides[get_preflight_service] = lambda: service
        try:
            from fastapi.testclient import TestClient

            client = TestClient(app)
            response = client.post(
                "/v1/churn/renewal/preflight",
                json={
                    "subscriptionId": "sub-1",
                    "subscriber": "0xABC",
                    "renewalAt": "2026-11-25T00:00:00Z",
                    "amountMinor": 1999,
                    "currency": "usd",
                    "features": {"recentPaymentFailures": 2},
                },
            )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        payload = response.json()
        assert payload["action"] == "block"
        assert payload["reason"] == "CRITICAL_RISK"
        assert payload["subscription_id"] == "sub-1"

    def test_invalid_payload_is_rejected(self):
        from fastapi.testclient import TestClient

        client = TestClient(app)
        response = client.post(
            "/v1/churn/renewal/preflight",
            json={"subscriptionId": "sub-1", "amountMinor": 0},
        )

        assert response.status_code == 422
