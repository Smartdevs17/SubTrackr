# SubTrackr ML Service

ML-powered churn prediction, revenue forecasting, and intervention automation
for the SubTrackr on-chain subscription platform.

## Full documentation

See **[docs/churn-prediction-ml.md](../docs/churn-prediction-ml.md)** for:

- Architecture diagram
- Quick-start guide
- Full API reference (all endpoints with request/response examples)
- TypeScript client usage
- Intervention automation with custom dispatchers
- Feature engineering details
- Model training pipeline
- Performance benchmarks

## Quick start

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Service will be available at `http://localhost:8000`.  
Health check: `GET /health`

## Running tests

```bash
pip install pytest httpx
pytest tests/ -v
```

## Typed Python inference client

`inference_client.py` provides a dependency-free synchronous client for churn
prediction, batch prediction, revenue forecasting, and health checks. It includes
typed input and output dataclasses, sends a correlation ID on every request, and
supports the service API key when configured:

```python
from inference_client import ChurnFeatures, InferenceClient

client = InferenceClient("http://localhost:8000", api_key="your-api-key", timeout=3)
result = client.predict_churn(
    "subscriber-123",
    ChurnFeatures(1, 20, 8, 0, 0.4),
)
print(result.risk_level, result.churn_probability)
```

HTTP failures raise `InferenceAPIError` (including status and server correlation
ID); connection, timeout, and malformed response failures raise
`InferenceTransportError`. Input constraints raise `ValueError` before a request
is sent. The same client exposes `predict_churn_batch`, `forecast_revenue`, and
`health`.

## Renewal pre-flight

`churn/` turns the churn probability into an auto-renewal decision (`renew`,
`review`, `defer` or `block`) with fail-closed handling for stale or missing
predictions. Run it standalone with:

```bash
uvicorn churn.api:app --port 8001
```

The billing worker calls `POST /v1/churn/renewal/preflight` through
`backend/src/services/renewal.ts`. See **[churn/README.md](churn/README.md)**
and **[docs/renewal-preflight.md](../docs/renewal-preflight.md)** for the full
policy and integration contract.
