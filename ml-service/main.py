"""
SubTrackr ML Service - Production-ready FastAPI application for churn prediction
and revenue forecasting with feature store integration, model registry, drift
detection, and intervention automation endpoints.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from feature_client import ChurnFeatureProvider
from model_registry import ModelRegistry
from models import ChurnPredictionModel, RevenueForecastModel

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
MODEL_DIR = os.getenv("MODEL_DIR", "./models")
DEFAULT_CHURN_VERSION = "v1.0"

# ── Model Registry (module-level singleton) ────────────────────────────────────
registry = ModelRegistry(storage_dir=MODEL_DIR)

# ── Model instances (populated in lifespan) ───────────────────────────────────
_churn_model: ChurnPredictionModel = ChurnPredictionModel()
_forecast_model: RevenueForecastModel = RevenueForecastModel()
_feature_provider: ChurnFeatureProvider = ChurnFeatureProvider()
_active_churn_version: str = DEFAULT_CHURN_VERSION

# ── Startup / Shutdown ─────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the most recent model weights from the registry on startup."""
    global _churn_model, _forecast_model, _feature_provider, _active_churn_version

    logger.info("ML Service starting up …")

    # Attempt to load saved model weights
    for candidate_version in ("v1.1", "v1.0"):
        weights = registry.load_model(candidate_version)
        if weights and "feature_weights" in weights:
            _churn_model.feature_weights = weights["feature_weights"]
            _active_churn_version = candidate_version
            logger.info("Loaded churn model weights: %s", candidate_version)
            break
    else:
        logger.warning(
            "No persisted model weights found – using built-in defaults (%s)",
            DEFAULT_CHURN_VERSION,
        )

    yield

    logger.info("ML Service shutting down.")


# ── Application ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SubTrackr ML Service",
    description="ML-powered churn prediction, revenue forecasting, and intervention automation",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


# ── Pydantic Schemas ───────────────────────────────────────────────────────────
class UserChurnData(BaseModel):
    recent_payment_failures: int = Field(0, ge=0, description="Number of recent payment failures")
    baseline_logins_per_month: int = Field(10, ge=1, description="Historical average logins per month")
    recent_logins: int = Field(10, ge=0, description="Logins in the most recent period")
    open_support_tickets: int = Field(0, ge=0, description="Number of open support tickets")
    app_crashes: int = Field(0, ge=0, description="Number of app crashes in recent period")
    price_sensitivity_index: float = Field(0.5, ge=0.0, le=1.0, description="Price sensitivity (0=insensitive, 1=very sensitive)")


class ChurnPredictRequest(BaseModel):
    subscriber: str = Field(..., description="Subscriber ID or wallet address")
    user_data: UserChurnData


class BatchChurnPredictItem(BaseModel):
    subscriber: str
    user_data: UserChurnData


class BatchChurnPredictRequest(BaseModel):
    items: List[BatchChurnPredictItem] = Field(..., min_length=1, max_length=500)


class RevenueObservation(BaseModel):
    period: str = Field(..., description="Period label (e.g. 2024-01)")
    revenue: float = Field(..., ge=0)


class ForecastRequest(BaseModel):
    observations: List[RevenueObservation] = Field(..., min_length=2)
    horizon: int = Field(3, ge=1, le=24, description="Number of periods to forecast")


class InterventionRequest(BaseModel):
    subscribers: List[str] = Field(..., min_length=1, max_length=500, description="List of subscriber IDs to evaluate")
    user_data_map: Dict[str, UserChurnData] = Field(
        ..., description="Map of subscriber_id -> user data"
    )
    risk_threshold: str = Field("High", description="Minimum risk level that triggers an intervention ('High' or 'Medium')")


class RetrainRequest(BaseModel):
    training_samples: Optional[List[Dict[str, Any]]] = Field(
        None, description="Optional training rows; omit to use registry defaults"
    )


# ── Helper ─────────────────────────────────────────────────────────────────────
_RISK_ORDER = {"Low": 0, "Medium": 1, "High": 2}


def _meets_threshold(risk_level: str, threshold: str) -> bool:
    return _RISK_ORDER.get(risk_level, 0) >= _RISK_ORDER.get(threshold, 2)


# ── Health Check ───────────────────────────────────────────────────────────────
@app.get("/health", tags=["ops"])
async def health():
    """Liveness + readiness probe."""
    return {
        "status": "ok",
        "model_version": _active_churn_version,
        "service": "subtrackr-ml",
    }


@app.get("/v1/models/status", tags=["models"])
async def model_status():
    """Returns current active model metadata and feature weights."""
    return {
        "churn": {
            "version": _active_churn_version,
            "feature_weights": _churn_model.feature_weights,
        },
        "revenue_forecast": {
            "version": "builtin-linear",
        },
    }


# ── Churn Prediction ───────────────────────────────────────────────────────────
@app.post("/v1/churn/predict", tags=["churn"])
async def predict_churn(req: ChurnPredictRequest):
    """Single-subscriber churn probability prediction with feature store integration."""
    try:
        t0 = time.perf_counter()
        feature_result = _feature_provider.get_or_compute(
            req.subscriber, req.user_data.model_dump()
        )
        prediction = _churn_model.predict_churn(req.subscriber, feature_result.features)
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

        return {
            **prediction,
            "model_version": _active_churn_version,
            "feature_set": feature_result.feature_set,
            "feature_set_hash": feature_result.feature_set_hash,
            "feature_source": feature_result.source,
            "feature_store_available": feature_result.store_available,
            "feature_computed_at": feature_result.computed_at,
            "feature_drift": feature_result.drift,
            "latency_ms": elapsed_ms,
        }
    except Exception as exc:
        logger.exception("Prediction failed for %s", req.subscriber)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@app.post("/v1/churn/predict/batch", tags=["churn"])
async def predict_churn_batch(req: BatchChurnPredictRequest):
    """Batch churn prediction for up to 500 subscribers."""
    results: List[Dict[str, Any]] = []
    t0 = time.perf_counter()

    for item in req.items:
        try:
            feature_result = _feature_provider.get_or_compute(
                item.subscriber, item.user_data.model_dump()
            )
            prediction = _churn_model.predict_churn(item.subscriber, feature_result.features)
            results.append(
                {
                    **prediction,
                    "ok": True,
                    "feature_set": feature_result.feature_set,
                    "feature_set_hash": feature_result.feature_set_hash,
                    "feature_source": feature_result.source,
                    "feature_store_available": feature_result.store_available,
                    "feature_computed_at": feature_result.computed_at,
                    "feature_drift": feature_result.drift,
                }
            )
        except Exception as exc:
            logger.warning("Batch prediction failed for %s: %s", item.subscriber, exc)
            results.append({"ok": False, "subscriber": item.subscriber, "error": str(exc)})

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    successful = sum(1 for r in results if r.get("ok"))

    return {
        "model_version": _active_churn_version,
        "total": len(results),
        "successful": successful,
        "failed": len(results) - successful,
        "latency_ms": elapsed_ms,
        "results": results,
    }


# ── Revenue Forecast ───────────────────────────────────────────────────────────
@app.post("/v1/churn/forecast", tags=["forecast"])
async def forecast_revenue(req: ForecastRequest):
    """Revenue forecast using linear trend extrapolation with confidence intervals."""
    try:
        observations = [obs.model_dump() for obs in req.observations]
        forecast = _forecast_model.forecast(observations, req.horizon)
        return {"horizon": req.horizon, "forecast": forecast}
    except Exception as exc:
        logger.exception("Revenue forecast failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


# ── Intervention Automation ────────────────────────────────────────────────────
@app.post("/v1/interventions/evaluate", tags=["interventions"])
async def evaluate_interventions(req: InterventionRequest):
    """
    Evaluates a set of subscribers and returns recommended interventions
    for those meeting or exceeding the specified risk threshold.

    This endpoint is stateless; callers are responsible for executing the
    recommended actions (email, discount, support ticket, etc.).
    """
    interventions: List[Dict[str, Any]] = []
    evaluated = 0
    skipped = 0
    t0 = time.perf_counter()

    for subscriber_id in req.subscribers:
        user_data_model = req.user_data_map.get(subscriber_id)
        if user_data_model is None:
            logger.warning("No user_data for subscriber %s – skipping", subscriber_id)
            skipped += 1
            continue

        try:
            feature_result = _feature_provider.get_or_compute(
                subscriber_id, user_data_model.model_dump()
            )
            prediction = _churn_model.predict_churn(subscriber_id, feature_result.features)
            evaluated += 1

            if _meets_threshold(prediction["risk_level"], req.risk_threshold):
                interventions.append(
                    {
                        "subscriber": subscriber_id,
                        "churn_probability": prediction["churn_probability"],
                        "risk_level": prediction["risk_level"],
                        "risk_factors": prediction["risk_factors"],
                        "recommended_action": prediction["recommended_action"],
                        "intervention_type": _derive_intervention_type(
                            prediction["risk_level"], prediction["risk_factors"]
                        ),
                        "feature_drift_detected": feature_result.drift.get("drift_detected", False),
                    }
                )
        except Exception as exc:
            logger.warning("Intervention evaluation failed for %s: %s", subscriber_id, exc)
            skipped += 1

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return {
        "model_version": _active_churn_version,
        "evaluated": evaluated,
        "skipped": skipped,
        "interventions_recommended": len(interventions),
        "latency_ms": elapsed_ms,
        "interventions": interventions,
    }


def _derive_intervention_type(risk_level: str, risk_factors: List[Dict]) -> str:
    """Maps top risk factor + risk level to a concrete intervention type."""
    if not risk_factors:
        return "retention_discount"

    top_factor = risk_factors[0].get("factor", "")
    mapping = {
        "payment_failures": "payment_recovery_email",
        "login_frequency_drop": "re_engagement_email",
        "support_tickets": "priority_support_escalation",
        "app_crashes": "technical_outreach",
        "price_sensitivity": "discount_offer",
    }
    base = mapping.get(top_factor, "retention_discount")

    if risk_level == "High":
        return f"urgent_{base}"
    return base


# ── Model Retraining ───────────────────────────────────────────────────────────
@app.post("/v1/models/retrain", tags=["models"])
async def retrain_model(req: Optional[RetrainRequest] = None):
    """
    Triggers a model retraining pipeline.  Updates in-memory feature weights
    immediately after the new version is persisted to the registry.
    """
    global _churn_model, _active_churn_version

    training_samples = (req.training_samples or []) if req else []

    try:
        new_version = registry.retrain_model(training_samples)
        new_weights = registry.load_model(new_version)
        if new_weights and "feature_weights" in new_weights:
            _churn_model.feature_weights = new_weights["feature_weights"]
            _active_churn_version = new_version
            logger.info("Model hot-reloaded to version %s", new_version)

        return {
            "status": "success",
            "new_version": new_version,
            "feature_weights": _churn_model.feature_weights,
        }
    except Exception as exc:
        logger.exception("Model retraining failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


# ── Entry Point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "production") == "development",
        log_level="info",
    )
