"""Tests for structured logging with correlation IDs in ml-service (issue #939)."""

import json
import uuid
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Minimal stubs so main.py can be imported without real model files.
# ---------------------------------------------------------------------------
class _FakeChurnModel:
    feature_weights: dict = {}

    def predict_churn(self, subscriber, user_data):
        return {"subscriber": subscriber, "churn_probability": 0.3, "risk_level": "low"}


class _FakeForecastModel:
    def forecast(self, observations, horizon):
        return {"horizon": horizon, "forecast": []}


class _FakeRegistry:
    def load_model(self, version):
        return None

    def retrain_model(self, data):
        return "v1.2"


@pytest.fixture(autouse=True)
def _patch_models(monkeypatch):
    """Patch heavy model imports before main.py is imported."""
    monkeypatch.setitem(__import__("sys").modules, "models", MagicMock(
        ChurnPredictionModel=lambda: _FakeChurnModel(),
        RevenueForecastModel=lambda: _FakeForecastModel(),
    ))
    monkeypatch.setitem(__import__("sys").modules, "model_registry", MagicMock(
        registry=_FakeRegistry(),
    ))


@pytest.fixture()
def client():
    # Import after patching
    import importlib
    import sys
    # Remove cached module if present
    sys.modules.pop("main", None)
    import main as app_module  # noqa: E402
    return TestClient(app_module.app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# StructuredLogger unit tests
# ---------------------------------------------------------------------------

class TestStructuredLogger:
    def test_info_emits_json_with_required_fields(self, caplog):
        import sys
        sys.modules.pop("main", None)
        import main  # noqa: E402
        import logging

        with patch.object(main.logger._raw, "info") as mock_info:
            main.logger.info("hello world", extra_field="value")
            assert mock_info.called
            raw_json = mock_info.call_args[0][0]
            entry = json.loads(raw_json)

        assert entry["level"] == "info"
        assert entry["message"] == "hello world"
        assert entry["service"] == "ml-service"
        assert "timestamp" in entry
        assert entry["extra_field"] == "value"

    def test_correlation_id_injected_when_set(self):
        import sys
        sys.modules.pop("main", None)
        import main  # noqa: E402

        test_corr = "test-corr-id-abc123"
        token = main._correlation_id.set(test_corr)
        try:
            with patch.object(main.logger._raw, "info") as mock_info:
                main.logger.info("with correlation")
                raw_json = mock_info.call_args[0][0]
                entry = json.loads(raw_json)
            assert entry["correlation_id"] == test_corr
        finally:
            main._correlation_id.reset(token)

    def test_no_correlation_id_key_when_empty(self):
        import sys
        sys.modules.pop("main", None)
        import main  # noqa: E402

        # Ensure context var is empty
        token = main._correlation_id.set("")
        try:
            with patch.object(main.logger._raw, "info") as mock_info:
                main.logger.info("no corr")
                raw_json = mock_info.call_args[0][0]
                entry = json.loads(raw_json)
            assert "correlation_id" not in entry  # None values are stripped
        finally:
            main._correlation_id.reset(token)

    def test_error_level_emitted_correctly(self):
        import sys
        sys.modules.pop("main", None)
        import main  # noqa: E402

        with patch.object(main.logger._raw, "error") as mock_error:
            main.logger.error("something broke", code=500)
            raw_json = mock_error.call_args[0][0]
            entry = json.loads(raw_json)

        assert entry["level"] == "error"
        assert entry["code"] == 500


# ---------------------------------------------------------------------------
# Middleware integration tests
# ---------------------------------------------------------------------------

class TestCorrelationIdMiddleware:
    def test_generates_correlation_id_when_absent(self, client):
        resp = client.post(
            "/v1/churn/predict",
            json={
                "subscriber": "sub_001",
                "user_data": {
                    "recent_payment_failures": 0.0,
                    "baseline_logins_per_month": 10.0,
                    "recent_logins": 8.0,
                    "open_support_tickets": 0.0,
                    "price_sensitivity_index": 0.5,
                },
            },
        )
        assert "x-correlation-id" in resp.headers
        # Should be a valid UUID
        corr_id = resp.headers["x-correlation-id"]
        uuid.UUID(corr_id)  # raises ValueError if not a valid UUID

    def test_echoes_provided_correlation_id(self, client):
        custom_id = "my-custom-corr-id-12345"
        resp = client.post(
            "/v1/churn/predict",
            headers={"X-Correlation-ID": custom_id},
            json={
                "subscriber": "sub_002",
                "user_data": {
                    "recent_payment_failures": 1.0,
                    "baseline_logins_per_month": 5.0,
                    "recent_logins": 2.0,
                    "open_support_tickets": 1.0,
                    "price_sensitivity_index": 0.8,
                },
            },
        )
        assert resp.headers["x-correlation-id"] == custom_id

    def test_different_requests_get_different_ids(self, client):
        payload = {
            "subscriber": "sub_003",
            "user_data": {
                "recent_payment_failures": 0.0,
                "baseline_logins_per_month": 10.0,
                "recent_logins": 10.0,
                "open_support_tickets": 0.0,
                "price_sensitivity_index": 0.1,
            },
        }
        resp1 = client.post("/v1/churn/predict", json=payload)
        resp2 = client.post("/v1/churn/predict", json=payload)
        assert resp1.headers["x-correlation-id"] != resp2.headers["x-correlation-id"]

    def test_health_endpoint_also_gets_correlation_id(self, client):
        resp = client.get("/healthz")
        assert resp.status_code == 200
        assert "x-correlation-id" in resp.headers


# ---------------------------------------------------------------------------
# Endpoint smoke tests (verify logging doesn't break functionality)
# ---------------------------------------------------------------------------

class TestEndpoints:
    def test_predict_churn_returns_200(self, client):
        resp = client.post(
            "/v1/churn/predict",
            json={
                "subscriber": "sub_smoke",
                "user_data": {
                    "recent_payment_failures": 0.0,
                    "baseline_logins_per_month": 12.0,
                    "recent_logins": 10.0,
                    "open_support_tickets": 0.0,
                    "price_sensitivity_index": 0.3,
                },
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "model_version" in body

    def test_batch_predict_returns_results(self, client):
        resp = client.post(
            "/v1/churn/predict/batch",
            json={
                "items": [
                    {
                        "subscriber": f"sub_{i}",
                        "user_data": {
                            "recent_payment_failures": float(i % 3),
                            "baseline_logins_per_month": 10.0,
                            "recent_logins": 8.0,
                            "open_support_tickets": 0.0,
                            "price_sensitivity_index": 0.5,
                        },
                    }
                    for i in range(3)
                ]
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 3

    def test_forecast_endpoint_returns_200(self, client):
        resp = client.post(
            "/v1/churn/forecast",
            json={
                "observations": [
                    {"period": "2024-01", "revenue": 10000.0},
                    {"period": "2024-02", "revenue": 11000.0},
                ],
                "horizon": 2,
            },
        )
        assert resp.status_code == 200
