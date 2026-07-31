from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List

from feature_client import ChurnFeatureProvider

router = APIRouter(tags=["churn"])
feature_provider = ChurnFeatureProvider()


class UserChurnData(BaseModel):
    recent_payment_failures: int = 0
    baseline_logins_per_month: int = 10
    recent_logins: int = 10
    open_support_tickets: int = 0
    app_crashes: int = 0
    price_sensitivity_index: float = Field(0.5, ge=0.0, le=1.0)


class ChurnRequest(BaseModel):
    subscriber: str
    user_data: UserChurnData


class BatchChurnRequest(BaseModel):
    items: List[ChurnRequest]


class RevenueObservation(BaseModel):
    period: str
    revenue: float


class ForecastRequest(BaseModel):
    observations: List[RevenueObservation]
    horizon: int = Field(3, ge=1, le=12)


@router.post("/predict")
def predict_churn(req: ChurnRequest):
    from main import registry
    try:
        model = registry.get("churn")
        meta = registry.meta("churn")
        feature_result = feature_provider.get_or_compute(req.subscriber, req.user_data.model_dump())
        result = model.predict_churn(req.subscriber, feature_result.features)
        meta.record_prediction()
        return {
            "model_version": meta.version,
            "feature_set": feature_result.feature_set,
            "feature_set_hash": feature_result.feature_set_hash,
            "feature_source": feature_result.source,
            "feature_store_available": feature_result.store_available,
            "feature_computed_at": feature_result.computed_at,
            "feature_drift": feature_result.drift,
            **result,
        }
    except Exception as e:
        registry.meta("churn").record_error()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/predict/batch")
def predict_churn_batch(req: BatchChurnRequest):
    from main import registry
    results = []
    model = registry.get("churn")
    meta = registry.meta("churn")
    for item in req.items:
        try:
            feature_result = feature_provider.get_or_compute(item.subscriber, item.user_data.model_dump())
            result = model.predict_churn(item.subscriber, feature_result.features)
            meta.record_prediction()
            results.append({
                "ok": True,
                "feature_set": feature_result.feature_set,
                "feature_set_hash": feature_result.feature_set_hash,
                "feature_source": feature_result.source,
                "feature_store_available": feature_result.store_available,
                "feature_computed_at": feature_result.computed_at,
                "feature_drift": feature_result.drift,
                **result,
            })
        except Exception as e:
            meta.record_error()
            results.append({"ok": False, "subscriber": item.subscriber, "error": str(e)})
    return {"model_version": meta.version, "results": results}


@router.post("/forecast")
def forecast_revenue(req: ForecastRequest):
    from main import registry
    try:
        model = registry.get("revenue_forecast")
        observations = [o.model_dump() for o in req.observations]
        return model.forecast(observations, req.horizon)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
