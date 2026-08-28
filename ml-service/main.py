import uuid
import time
import logging
import json
from contextlib import asynccontextmanager
from contextvars import ContextVar

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel
from typing import List, Dict, Optional
from models import ChurnPredictionModel, RevenueForecastModel

# ──────────────────────────────────────────────────────────────────────────────
# Structured logging with correlation IDs  (issue #939)
# ──────────────────────────────────────────────────────────────────────────────

# Context var that holds the current correlation ID for the active request.
_correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


class StructuredLogger:
    """JSON-formatted logger that automatically injects the active correlation ID."""

    def __init__(self, service: str = "ml-service") -> None:
        self._service = service
        self._raw = logging.getLogger(service)
        if not self._raw.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter("%(message)s"))
            self._raw.addHandler(handler)
        self._raw.setLevel(logging.DEBUG)

    def _emit(self, level: str, message: str, **extra) -> None:
        entry = {
            "level": level,
            "message": message,
            "service": self._service,
            "correlation_id": _correlation_id.get() or None,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            **extra,
        }
        # Strip None values to keep logs clean
        entry = {k: v for k, v in entry.items() if v is not None}
        getattr(self._raw, level if level != "warning" else "warning")(
            json.dumps(entry)
        )

    def debug(self, message: str, **extra) -> None:
        self._emit("debug", message, **extra)

    def info(self, message: str, **extra) -> None:
        self._emit("info", message, **extra)

    def warning(self, message: str, **extra) -> None:
        self._emit("warning", message, **extra)

    def error(self, message: str, **extra) -> None:
        self._emit("error", message, **extra)


logger = StructuredLogger()

# ──────────────────────────────────────────────────────────────────────────────
# Application
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(title="SubTrackr ML Service", version="1.0.0")


# ── Correlation-ID middleware ──────────────────────────────────────────────────

@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next) -> Response:
    """
    Reads X-Correlation-ID from the incoming request (or generates a new UUID
    if absent), stores it in the context var, injects it into the response, and
    records basic request/response telemetry via the structured logger.
    """
    correlation_id = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
    token = _correlation_id.set(correlation_id)

    start = time.monotonic()
    logger.info(
        "request_started",
        method=request.method,
        path=request.url.path,
    )

    try:
        response: Response = await call_next(request)
    except Exception as exc:
        logger.error(
            "request_error",
            method=request.method,
            path=request.url.path,
            error=str(exc),
        )
        raise
    finally:
        elapsed_ms = round((time.monotonic() - start) * 1000, 2)
        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status_code=getattr(response, "status_code", None),
            duration_ms=elapsed_ms,
        )
        _correlation_id.reset(token)

    response.headers["X-Correlation-ID"] = correlation_id
    return response


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────────────────────

class UserData(BaseModel):
    recent_payment_failures: float
    baseline_logins_per_month: float
    recent_logins: float
    open_support_tickets: float
    price_sensitivity_index: float


class PredictRequest(BaseModel):
    subscriber: str
    user_data: UserData


class BatchPredictItem(BaseModel):
    subscriber: str
    user_data: UserChurnData


class BatchChurnPredictRequest(BaseModel):
    items: List[BatchChurnPredictItem] = Field(..., min_length=1, max_length=500)


class BatchPredictRequest(BaseModel):
    items: List[BatchPredictItem]


class Observation(BaseModel):
    period: str
    revenue: float


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



# ──────────────────────────────────────────────────────────────────────────────
# Model initialisation
# ──────────────────────────────────────────────────────────────────────────────

churn_model = ChurnPredictionModel()
forecast_model = RevenueForecastModel()

custom_weights = registry.load_model("v1.1")
if custom_weights and "feature_weights" in custom_weights:
    churn_model.feature_weights = custom_weights["feature_weights"]
    logger.info("model_loaded", version="v1.1")
else:
    logger.info("model_loaded", version="v1.0")


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/v1/churn/predict")
async def predict_churn(req: PredictRequest):
    logger.info("predict_churn", subscriber=req.subscriber)
    try:
        prediction = churn_model.predict_churn(req.subscriber, req.user_data.model_dump())
        prediction["model_version"] = "v1.1" if custom_weights else "v1.0"
        return prediction
    except Exception as e:
        logger.error("predict_churn_failed", subscriber=req.subscriber, error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/churn/predict/batch")
async def predict_churn_batch(req: BatchPredictRequest):
    logger.info("predict_churn_batch", count=len(req.items))
    results = []
    for item in req.items:
        try:
            pred = churn_model.predict_churn(item.subscriber, item.user_data.model_dump())
            pred["ok"] = True
            results.append(pred)
        except Exception as e:
            logger.warning(
                "predict_churn_item_failed",
                subscriber=item.subscriber,
                error=str(e),
            )
            results.append({"subscriber": item.subscriber, "ok": False, "error": str(e)})

    return {
        "model_version": "v1.1" if custom_weights else "v1.0",
        "results": results,
    }


@app.post("/v1/churn/forecast")
async def forecast_revenue(req: ForecastRequest):
    logger.info("forecast_revenue", horizon=req.horizon, observations=len(req.observations))
    try:
        observations = [obs.model_dump() for obs in req.observations]
        forecast = forecast_model.forecast(observations, req.horizon)
        return forecast
    except Exception as e:
        logger.error("forecast_revenue_failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/models/retrain")
async def retrain_model():
    """Trigger the retraining pipeline."""
    logger.info("model_retrain_triggered")
    new_version = registry.retrain_model([])
    new_weights = registry.load_model(new_version)
    if new_weights:
        churn_model.feature_weights = new_weights["feature_weights"]
        logger.info("model_weights_reloaded", version=new_version)
    return {"status": "success", "new_version": new_version}


@app.get("/healthz")
async def health():
    return {"status": "ok", "service": "ml-service"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "production") == "development",
        log_level="info",
    )
