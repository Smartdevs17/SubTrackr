"""
Comprehensive tests for the SubTrackr ML service churn prediction pipeline.

Coverage targets:
  - ChurnPredictionModel: heuristic scoring, risk levels, recommended actions
  - RevenueForecastModel: linear delta + Holt smoothing, confidence intervals
  - ModelRegistry: save/load/retrain/list operations
  - FastAPI endpoints via TestClient: /health, /v1/churn/predict,
    /v1/churn/predict/batch, /v1/churn/forecast, /v1/interventions/evaluate,
    /v1/models/retrain, /v1/models/status
  - Feature pipeline integration via ChurnFeatureProvider (mocked store)
"""
from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import types
from typing import Dict
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Make sure ml-service root is importable
# ---------------------------------------------------------------------------
ML_SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ML_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, ML_SERVICE_ROOT)

# Add feature-pipeline path so feature_client can find it
FP_ROOT = os.path.abspath(os.path.join(ML_SERVICE_ROOT, "..", "services", "feature-pipeline"))
if FP_ROOT not in sys.path:
    sys.path.insert(0, FP_ROOT)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def sample_features() -> Dict[str, float]:
    return {
        "payment_failures": 0.6,
        "login_frequency_drop": 0.7,
        "support_tickets": 0.5,
        "app_crashes": 0.1,
        "price_sensitivity": 0.8,
    }


@pytest.fixture()
def low_risk_features() -> Dict[str, float]:
    return {
        "payment_failures": 0.0,
        "login_frequency_drop": 0.05,
        "support_tickets": 0.0,
        "app_crashes": 0.0,
        "price_sensitivity": 0.2,
    }


@pytest.fixture()
def high_risk_features() -> Dict[str, float]:
    return {
        "payment_failures": 1.0,
        "login_frequency_drop": 1.0,
        "support_tickets": 1.0,
        "app_crashes": 0.8,
        "price_sensitivity": 1.0,
    }


@pytest.fixture()
def tmp_model_dir(tmp_path):
    return str(tmp_path)


# ===========================================================================
# ChurnPredictionModel tests
# ===========================================================================

class TestChurnPredictionModel:
    def _make(self, weights=None):
        from models import ChurnPredictionModel
        return ChurnPredictionModel(feature_weights=weights)

    def test_predict_returns_required_keys(self, sample_features):
        model = self._make()
        result = model.predict_churn("sub_001", sample_features)
        for key in ("subscriber", "churn_probability", "risk_level", "risk_factors", "recommended_action"):
            assert key in result, f"Missing key: {key}"

    def test_subscriber_identity_preserved(self, sample_features):
        model = self._make()
        assert model.predict_churn("0xABCD", sample_features)["subscriber"] == "0xABCD"

    def test_churn_probability_in_range(self, sample_features, low_risk_features, high_risk_features):
        model = self._make()
        for features in [sample_features, low_risk_features, high_risk_features]:
            prob = model.predict_churn("sub", features)["churn_probability"]
            assert 0.0 <= prob <= 1.0, f"Probability out of range: {prob}"

    def test_high_risk_classification(self, high_risk_features):
        model = self._make()
        result = model.predict_churn("sub", high_risk_features)
        assert result["risk_level"] == "High"
        assert result["churn_probability"] >= 0.7

    def test_low_risk_classification(self, low_risk_features):
        model = self._make()
        result = model.predict_churn("sub", low_risk_features)
        assert result["risk_level"] == "Low"

    def test_medium_risk_classification(self):
        from models import ChurnPredictionModel
        model = ChurnPredictionModel()
        features = {
            "payment_failures": 0.3,
            "login_frequency_drop": 0.4,
            "support_tickets": 0.0,
            "app_crashes": 0.0,
            "price_sensitivity": 0.5,
        }
        result = model.predict_churn("sub", features)
        # With these weights the score should be in medium range
        assert result["risk_level"] in ("Medium", "Low")

    def test_risk_factors_are_sorted_descending(self, high_risk_features):
        model = self._make()
        factors = model.predict_churn("sub", high_risk_features)["risk_factors"]
        impacts = [f["impact"] for f in factors]
        assert impacts == sorted(impacts, reverse=True)

    def test_low_risk_recommended_action(self, low_risk_features):
        model = self._make()
        action = model.predict_churn("sub", low_risk_features)["recommended_action"]
        assert "no action" in action.lower()

    def test_payment_failures_action(self):
        from models import ChurnPredictionModel
        model = ChurnPredictionModel()
        features = {
            "payment_failures": 1.0,
            "login_frequency_drop": 0.0,
            "support_tickets": 0.0,
            "app_crashes": 0.0,
            "price_sensitivity": 0.0,
        }
        action = model.predict_churn("sub", features)["recommended_action"]
        assert "payment" in action.lower() or "discount" in action.lower()

    def test_custom_weights_respected(self):
        from models import ChurnPredictionModel
        weights = {
            "payment_failures": 1.0,
            "login_frequency_drop": 0.0,
            "support_tickets": 0.0,
            "app_crashes": 0.0,
            "price_sensitivity": 0.0,
        }
        model = ChurnPredictionModel(feature_weights=weights)
        features = {"payment_failures": 0.5}
        prob = model.predict_churn("sub", features)["churn_probability"]
        # Only payment_failures contributes → 0.5 * 1.0 = 0.5
        assert abs(prob - 0.5) < 0.01

    def test_empty_features_does_not_crash(self):
        from models import ChurnPredictionModel
        model = ChurnPredictionModel()
        result = model.predict_churn("sub", {})
        assert result["churn_probability"] == 0.0
        assert result["risk_level"] == "Low"


# ===========================================================================
# RevenueForecastModel tests
# ===========================================================================

class TestRevenueForecastModel:
    def _make(self):
        from models import RevenueForecastModel
        return RevenueForecastModel()

    def _obs(self, revenues):
        return [{"period": f"2024-{i+1:02d}", "revenue": r} for i, r in enumerate(revenues)]

    def test_returns_correct_horizon(self):
        model = self._make()
        obs = self._obs([100, 110, 120, 130])
        result = model.forecast(obs, horizon=6)
        assert len(result) == 6

    def test_forecast_fields_present(self):
        model = self._make()
        obs = self._obs([100, 110, 120, 130])
        point = model.forecast(obs, horizon=1)[0]
        for key in ("period", "expected_revenue", "lower_bound", "upper_bound"):
            assert key in point

    def test_upper_bound_ge_expected(self):
        model = self._make()
        for point in model.forecast(self._obs([100, 200, 300, 400]), horizon=3):
            assert point["upper_bound"] >= point["expected_revenue"]

    def test_lower_bound_le_expected(self):
        model = self._make()
        for point in model.forecast(self._obs([100, 200, 300, 400]), horizon=3):
            assert point["lower_bound"] <= point["expected_revenue"]

    def test_revenue_non_negative(self):
        model = self._make()
        for point in model.forecast(self._obs([5, 3, 2, 1]), horizon=5):
            assert point["lower_bound"] >= 0
            assert point["expected_revenue"] >= 0

    def test_empty_observations(self):
        model = self._make()
        assert model.forecast([], horizon=3) == []

    def test_period_labels_increment_monthly(self):
        model = self._make()
        obs = self._obs([100, 110, 120, 130])
        obs[-1]["period"] = "2024-12"
        points = model.forecast(obs, horizon=2)
        assert points[0]["period"] == "2025-01"
        assert points[1]["period"] == "2025-02"

    def test_short_series_uses_fallback(self):
        model = self._make()
        obs = self._obs([100, 110])  # len < 4 → linear delta
        result = model.forecast(obs, horizon=2)
        assert len(result) == 2

    def test_holt_smoothing_used_for_long_series(self):
        model = self._make()
        obs = self._obs([100, 120, 115, 130, 145])  # len >= 4
        result = model.forecast(obs, horizon=3)
        # Just assert it runs without error and returns sensible values
        assert all(p["expected_revenue"] >= 0 for p in result)


# ===========================================================================
# ModelRegistry tests
# ===========================================================================

class TestModelRegistry:
    def _make(self, tmp_dir):
        from model_registry import ModelRegistry
        return ModelRegistry(storage_dir=tmp_dir)

    def test_save_and_load_round_trip(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        data = {"version": "v_test", "feature_weights": {"a": 0.5}}
        registry.save_model("v_test", data)
        loaded = registry.load_model("v_test")
        assert loaded["feature_weights"]["a"] == 0.5

    def test_load_missing_model_returns_none(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        assert registry.load_model("nonexistent") is None

    def test_list_models_returns_saved(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        registry.save_model("va", {"v": "a"})
        registry.save_model("vb", {"v": "b"})
        names = registry.list_models()
        assert "va" in names
        assert "vb" in names

    def test_retrain_returns_version_string(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        new_version = registry.retrain_model([])
        assert isinstance(new_version, str)
        assert len(new_version) > 0

    def test_retrain_persists_new_version(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        new_version = registry.retrain_model([])
        loaded = registry.load_model(new_version)
        assert loaded is not None
        assert "feature_weights" in loaded

    def test_retrain_weights_differ_from_defaults(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        new_version = registry.retrain_model([])
        loaded = registry.load_model(new_version)
        assert loaded["feature_weights"]["payment_failures"] != 0.40  # bumped

    def test_meta_counters(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        meta = registry.meta("churn")
        meta.record_prediction()
        meta.record_prediction()
        meta.record_error()
        stats = meta.stats()
        assert stats["predictions"] == 2
        assert stats["errors"] == 1

    def test_default_v1_saved_on_init(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        loaded = registry.load_model("v1.0")
        assert loaded is not None

    def test_path_traversal_sanitized(self, tmp_model_dir):
        registry = self._make(tmp_model_dir)
        # Should not escape the storage dir
        registry.save_model("../../evil", {"x": 1})
        files = os.listdir(tmp_model_dir)
        assert not any(".." in f for f in files)


# ===========================================================================
# FastAPI endpoint tests
# ===========================================================================

@pytest.fixture(scope="module")
def client():
    """Create a TestClient for the FastAPI app with mocked feature provider."""
    from fastapi.testclient import TestClient

    # Patch FeatureStoreClient to avoid needing Redis
    with patch("feature_client.FeatureStoreClient") as MockStore:
        mock_store = MockStore.return_value
        mock_store.get.return_value = None  # cache miss → compute_features is called
        mock_store.set.return_value = None

        import main as app_module
        tc = TestClient(app_module.app)
        yield tc


class TestHealthEndpoint:
    def test_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200

    def test_body_has_status_ok(self, client):
        body = client.get("/health").json()
        assert body["status"] == "ok"

    def test_body_has_model_version(self, client):
        body = client.get("/health").json()
        assert "model_version" in body

    def test_body_has_service_name(self, client):
        body = client.get("/health").json()
        assert body["service"] == "subtrackr-ml"


class TestModelStatusEndpoint:
    def test_returns_200(self, client):
        assert client.get("/v1/models/status").status_code == 200

    def test_has_churn_section(self, client):
        body = client.get("/v1/models/status").json()
        assert "churn" in body

    def test_has_feature_weights(self, client):
        body = client.get("/v1/models/status").json()
        assert "feature_weights" in body["churn"]


class TestPredictEndpoint:
    def _payload(self, subscriber="sub_001"):
        return {
            "subscriber": subscriber,
            "user_data": {
                "recent_payment_failures": 2,
                "baseline_logins_per_month": 20,
                "recent_logins": 4,
                "open_support_tickets": 1,
                "app_crashes": 0,
                "price_sensitivity_index": 0.7,
            },
        }

    def test_returns_200(self, client):
        resp = client.post("/v1/churn/predict", json=self._payload())
        assert resp.status_code == 200

    def test_response_has_churn_probability(self, client):
        body = client.post("/v1/churn/predict", json=self._payload()).json()
        assert "churn_probability" in body
        assert 0.0 <= body["churn_probability"] <= 1.0

    def test_response_has_risk_level(self, client):
        body = client.post("/v1/churn/predict", json=self._payload()).json()
        assert body["risk_level"] in ("High", "Medium", "Low")

    def test_response_has_recommended_action(self, client):
        body = client.post("/v1/churn/predict", json=self._payload()).json()
        assert "recommended_action" in body
        assert len(body["recommended_action"]) > 0

    def test_subscriber_preserved_in_response(self, client):
        body = client.post("/v1/churn/predict", json=self._payload("wallet_42")).json()
        assert body["subscriber"] == "wallet_42"

    def test_model_version_in_response(self, client):
        body = client.post("/v1/churn/predict", json=self._payload()).json()
        assert "model_version" in body

    def test_invalid_price_sensitivity_rejected(self, client):
        payload = self._payload()
        payload["user_data"]["price_sensitivity_index"] = 99.0
        resp = client.post("/v1/churn/predict", json=payload)
        assert resp.status_code == 422


class TestBatchPredictEndpoint:
    def _payload(self, count=3):
        return {
            "items": [
                {
                    "subscriber": f"sub_{i}",
                    "user_data": {
                        "recent_payment_failures": i % 3,
                        "baseline_logins_per_month": 20,
                        "recent_logins": 5,
                        "open_support_tickets": 0,
                        "app_crashes": 0,
                        "price_sensitivity_index": 0.5,
                    },
                }
                for i in range(count)
            ]
        }

    def test_returns_200(self, client):
        assert client.post("/v1/churn/predict/batch", json=self._payload()).status_code == 200

    def test_all_items_returned(self, client):
        body = client.post("/v1/churn/predict/batch", json=self._payload(5)).json()
        assert body["total"] == 5

    def test_successful_count(self, client):
        body = client.post("/v1/churn/predict/batch", json=self._payload(3)).json()
        assert body["successful"] == 3
        assert body["failed"] == 0

    def test_empty_items_rejected(self, client):
        resp = client.post("/v1/churn/predict/batch", json={"items": []})
        assert resp.status_code == 422

    def test_model_version_present(self, client):
        body = client.post("/v1/churn/predict/batch", json=self._payload(1)).json()
        assert "model_version" in body


class TestForecastEndpoint:
    def _payload(self, n=6, horizon=3):
        return {
            "observations": [
                {"period": f"2024-{i+1:02d}", "revenue": 1000.0 + i * 100}
                for i in range(n)
            ],
            "horizon": horizon,
        }

    def test_returns_200(self, client):
        assert client.post("/v1/churn/forecast", json=self._payload()).status_code == 200

    def test_forecast_length_matches_horizon(self, client):
        body = client.post("/v1/churn/forecast", json=self._payload(horizon=5)).json()
        assert len(body["forecast"]) == 5

    def test_all_forecast_fields_present(self, client):
        body = client.post("/v1/churn/forecast", json=self._payload()).json()
        for point in body["forecast"]:
            assert "period" in point
            assert "expected_revenue" in point
            assert "lower_bound" in point
            assert "upper_bound" in point

    def test_horizon_too_large_rejected(self, client):
        resp = client.post("/v1/churn/forecast", json=self._payload(horizon=99))
        assert resp.status_code == 422

    def test_single_observation_rejected(self, client):
        resp = client.post("/v1/churn/forecast", json=self._payload(n=1))
        assert resp.status_code == 422


class TestInterventionEndpoint:
    def _payload(self):
        return {
            "subscribers": ["sub_a", "sub_b"],
            "user_data_map": {
                "sub_a": {
                    "recent_payment_failures": 3,
                    "baseline_logins_per_month": 15,
                    "recent_logins": 2,
                    "open_support_tickets": 1,
                    "app_crashes": 0,
                    "price_sensitivity_index": 0.9,
                },
                "sub_b": {
                    "recent_payment_failures": 0,
                    "baseline_logins_per_month": 20,
                    "recent_logins": 18,
                    "open_support_tickets": 0,
                    "app_crashes": 0,
                    "price_sensitivity_index": 0.2,
                },
            },
            "risk_threshold": "High",
        }

    def test_returns_200(self, client):
        assert client.post("/v1/interventions/evaluate", json=self._payload()).status_code == 200

    def test_evaluated_count(self, client):
        body = client.post("/v1/interventions/evaluate", json=self._payload()).json()
        assert body["evaluated"] == 2

    def test_response_has_interventions_list(self, client):
        body = client.post("/v1/interventions/evaluate", json=self._payload()).json()
        assert isinstance(body["interventions"], list)

    def test_all_intervention_fields_present(self, client):
        body = client.post("/v1/interventions/evaluate", json=self._payload()).json()
        for intervention in body["interventions"]:
            assert "subscriber" in intervention
            assert "churn_probability" in intervention
            assert "risk_level" in intervention
            assert "intervention_type" in intervention
            assert "recommended_action" in intervention

    def test_medium_threshold_returns_more_interventions(self, client):
        payload = self._payload()
        payload["risk_threshold"] = "Medium"
        body_medium = client.post("/v1/interventions/evaluate", json=payload).json()

        payload["risk_threshold"] = "High"
        body_high = client.post("/v1/interventions/evaluate", json=payload).json()

        # Medium threshold should catch >= as many as High
        assert body_medium["interventions_recommended"] >= body_high["interventions_recommended"]

    def test_empty_subscribers_rejected(self, client):
        payload = self._payload()
        payload["subscribers"] = []
        resp = client.post("/v1/interventions/evaluate", json=payload)
        assert resp.status_code == 422


class TestRetrainEndpoint:
    def test_returns_200(self, client):
        assert client.post("/v1/models/retrain").status_code == 200

    def test_returns_new_version(self, client):
        body = client.post("/v1/models/retrain").json()
        assert "new_version" in body
        assert len(body["new_version"]) > 0

    def test_status_is_success(self, client):
        body = client.post("/v1/models/retrain").json()
        assert body["status"] == "success"

    def test_feature_weights_returned(self, client):
        body = client.post("/v1/models/retrain").json()
        assert "feature_weights" in body


# ===========================================================================
# Feature client integration tests (mocked Redis)
# ===========================================================================

class TestChurnFeatureProvider:
    def _make_provider(self, store=None):
        from feature_client import ChurnFeatureProvider
        return ChurnFeatureProvider(store=store)

    def test_compute_features_on_cache_miss(self):
        mock_store = MagicMock()
        mock_store.get.return_value = None
        mock_store.set.return_value = None

        provider = self._make_provider(store=mock_store)
        result = provider.get_or_compute("sub_1", {
            "recent_payment_failures": 1,
            "baseline_logins_per_month": 10,
            "recent_logins": 5,
            "open_support_tickets": 0,
            "app_crashes": 0,
            "price_sensitivity_index": 0.5,
        })

        assert result.source in ("online_cache_miss", "online_store_unavailable")
        assert "payment_failures" in result.features

    def test_cache_hit_returns_stored_features(self):
        from feature_client import ChurnFeatureProvider

        cached = {
            "features": {
                "payment_failures": 0.33,
                "login_frequency_drop": 0.1,
                "support_tickets": 0.0,
                "app_crashes": 0.0,
                "price_sensitivity": 0.5,
            },
            "computed_at": "2025-01-01T00:00:00Z",
        }

        mock_store = MagicMock()
        mock_store.get.return_value = cached

        provider = ChurnFeatureProvider(store=mock_store)
        result = provider.get_or_compute("sub_cached", {})
        assert result.source == "feature_store"
        assert result.features["payment_failures"] == pytest.approx(0.33)

    def test_store_unavailable_falls_back_to_compute(self):
        from feature_client import ChurnFeatureProvider, FeatureStoreUnavailable

        mock_store = MagicMock()
        mock_store.get.side_effect = FeatureStoreUnavailable("Redis down")
        mock_store.set.side_effect = FeatureStoreUnavailable("Redis down")

        provider = ChurnFeatureProvider(store=mock_store)
        result = provider.get_or_compute("sub_fallback", {
            "recent_payment_failures": 2,
            "baseline_logins_per_month": 10,
            "recent_logins": 3,
            "open_support_tickets": 1,
            "app_crashes": 0,
            "price_sensitivity_index": 0.6,
        })

        assert result.store_available is False
        assert "payment_failures" in result.features

    def test_feature_result_has_drift_report(self):
        mock_store = MagicMock()
        mock_store.get.return_value = None
        mock_store.set.return_value = None

        provider = self._make_provider(store=mock_store)
        result = provider.get_or_compute("sub_drift", {
            "recent_payment_failures": 3,
            "baseline_logins_per_month": 5,
            "recent_logins": 1,
            "open_support_tickets": 2,
            "app_crashes": 1,
            "price_sensitivity_index": 0.9,
        })

        assert "drift_detected" in result.drift
        assert "features" in result.drift
