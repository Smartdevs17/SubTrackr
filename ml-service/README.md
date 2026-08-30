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
