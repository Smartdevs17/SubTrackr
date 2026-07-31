from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
from models import ChurnPredictionModel, RevenueForecastModel
from model_registry import registry

app = FastAPI(title="SubTrackr ML Service", version="1.0.0")

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
    user_data: UserData

class BatchPredictRequest(BaseModel):
    items: List[BatchPredictItem]

class Observation(BaseModel):
    period: str
    revenue: float

class ForecastRequest(BaseModel):
    observations: List[Observation]
    horizon: int = 3

churn_model = ChurnPredictionModel()
forecast_model = RevenueForecastModel()

# Try to load a customized model from registry if available
custom_weights = registry.load_model("v1.1")
if custom_weights and "feature_weights" in custom_weights:
    churn_model.feature_weights = custom_weights["feature_weights"]

@app.post("/v1/churn/predict")
async def predict_churn(req: PredictRequest):
    try:
        prediction = churn_model.predict_churn(req.subscriber, req.user_data.model_dump())
        prediction["model_version"] = "v1.1" if custom_weights else "v1.0"
        return prediction
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/churn/predict/batch")
async def predict_churn_batch(req: BatchPredictRequest):
    results = []
    for item in req.items:
        try:
            pred = churn_model.predict_churn(item.subscriber, item.user_data.model_dump())
            pred["ok"] = True
            results.append(pred)
        except Exception as e:
            results.append({"subscriber": item.subscriber, "ok": False, "error": str(e)})
            
    return {
        "model_version": "v1.1" if custom_weights else "v1.0",
        "results": results
    }

@app.post("/v1/churn/forecast")
async def forecast_revenue(req: ForecastRequest):
    try:
        observations = [obs.model_dump() for obs in req.observations]
        forecast = forecast_model.forecast(observations, req.horizon)
        return forecast
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/models/retrain")
async def retrain_model():
    """Trigger the retraining pipeline"""
    new_version = registry.retrain_model([])
    # Hot reload the weights
    new_weights = registry.load_model(new_version)
    if new_weights:
        churn_model.feature_weights = new_weights["feature_weights"]
    return {"status": "success", "new_version": new_version}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
