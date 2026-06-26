from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

router = APIRouter(tags=["churn"])


class UserChurnData(BaseModel):
    recent_payment_failures: int = 0
    baseline_logins_per_month: int = 10
    recent_logins: int = 10
    open_support_tickets: int = 0
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
        result = model.predict_churn(req.subscriber, req.user_data.model_dump())
        meta.record_prediction()
        return {"model_version": meta.version, **result}
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
            result = model.predict_churn(item.subscriber, item.user_data.model_dump())
            meta.record_prediction()
            results.append({"ok": True, **result})
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
