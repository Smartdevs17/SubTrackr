# SubTrackr ML Service

FastAPI microservice wrapping the churn, recommendation, and pricing models.

## Run locally

```bash
cd ml-service
pip install -r requirements.txt
uvicorn main:app --reload
```

Docs at http://localhost:8000/docs

## Retrain models

```bash
python retrain.py --model all        # retrain everything
python retrain.py --model churn      # retrain one model
```

Restart the service after retraining to pick up the new version.

## Environment

| Variable | Default | Description |
|---|---|---|
| `ML_SERVICE_URL` | `http://localhost:8000` | Used by the TS backend to reach this service |

## Key endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/v1/models` | Model versions + drift status |
| POST | `/v1/churn/predict` | Single churn prediction |
| POST | `/v1/churn/predict/batch` | Batch churn predictions |
| POST | `/v1/churn/forecast` | Revenue forecast |
| POST | `/v1/recommendations/predict` | Single recommendation |
| POST | `/v1/recommendations/predict/batch` | Batch recommendations |
| POST | `/v1/recommendations/feedback` | Record acceptance (A/B + drift) |
| POST | `/v1/pricing/optimize` | Optimal price calculation |
| POST | `/v1/pricing/ab-test` | A/B test price tiers |
