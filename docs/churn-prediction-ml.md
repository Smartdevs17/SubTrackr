# ML Service – Churn Prediction & Intervention Automation

SubTrackr's ML service provides real-time churn risk scoring, revenue
forecasting, and automated intervention recommendations for on-chain
subscription management.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│           Backend (Node.js / TypeScript)      │
│  prediction.ts   →  PredictionService        │
│  interventionService.ts → InterventionService│
└─────────────────────┬────────────────────────┘
                      │ HTTP (retry + circuit breaker)
                      ▼
┌──────────────────────────────────────────────┐
│         ML Service (Python / FastAPI)        │
│  main.py  ── routes ──► models.py            │
│             │                                │
│             ▼                                │
│  feature_client.py  ◄──► Redis feature store │
│  model_registry.py  ◄──► ./models/*.json     │
└──────────────────────────────────────────────┘
                      │ imports
                      ▼
┌──────────────────────────────────────────────┐
│    services/feature-pipeline/features/churn  │
│  compute_features()  feature_set_hash()      │
│  drift_report()  kolmogorov_smirnov()        │
└──────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install Python dependencies

```bash
cd ml-service
pip install -r requirements.txt
```

`numpy` and `scikit-learn` are optional but unlock the GradientBoosting
classifier path. Without them the service falls back to a deterministic
weighted heuristic.

### 2. Set environment variables

| Variable | Default | Description |
|---|---|---|
| `ML_SERVICE_URL` | `http://localhost:8000` | Used by the TypeScript client |
| `PORT` | `8000` | ML service listen port |
| `MODEL_DIR` | `./models` | Directory for persisted model JSON |
| `FEATURE_STORE_URL` | `redis://localhost:6379/0` | Redis feature cache |
| `FEATURE_TTL_SECONDS` | `7200` | Cache TTL |
| `ENV` | `production` | Set to `development` to enable uvicorn reload |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |

### 3. Start the service

```bash
cd ml-service
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or via Docker Compose (see `docker-compose.yml`):

```bash
docker-compose up ml-service
```

---

## ML Service API Reference

### `GET /health`

Liveness + readiness probe.

**Response:**
```json
{
  "status": "ok",
  "model_version": "v1.0",
  "service": "subtrackr-ml"
}
```

---

### `POST /v1/churn/predict`

Single-subscriber churn probability with feature store integration.

**Request:**
```json
{
  "subscriber": "GADDR...",
  "user_data": {
    "recent_payment_failures": 2,
    "baseline_logins_per_month": 20,
    "recent_logins": 4,
    "open_support_tickets": 1,
    "app_crashes": 0,
    "price_sensitivity_index": 0.7
  }
}
```

**Response:**
```json
{
  "subscriber": "GADDR...",
  "churn_probability": 0.7812,
  "risk_level": "High",
  "risk_factors": [
    { "factor": "payment_failures", "impact": 0.28 },
    { "factor": "login_frequency_drop", "impact": 0.175 }
  ],
  "recommended_action": "Send payment method update reminder with a 5% discount offer.",
  "model_version": "v20260827120000",
  "feature_set": "churn",
  "feature_set_hash": "a1b2c3d4e5f6g7h8",
  "feature_source": "online_cache_miss",
  "feature_store_available": true,
  "feature_drift": { "drift_detected": false, "features": { ... } },
  "using_ml_model": true,
  "latency_ms": 8.4
}
```

**Risk levels:** `Low` (< 0.40), `Medium` (0.40–0.70), `High` (≥ 0.70)

---

### `POST /v1/churn/predict/batch`

Batch prediction for up to 500 subscribers in a single request.

**Request:**
```json
{
  "items": [
    { "subscriber": "addr1", "user_data": { ... } },
    { "subscriber": "addr2", "user_data": { ... } }
  ]
}
```

**Response:**
```json
{
  "model_version": "v1.0",
  "total": 2,
  "successful": 2,
  "failed": 0,
  "latency_ms": 14.2,
  "results": [ { "ok": true, ... }, { "ok": true, ... } ]
}
```

---

### `POST /v1/churn/forecast`

Revenue forecast using Holt double-exponential smoothing (≥ 4 observations)
or linear delta averaging (< 4 observations).

**Request:**
```json
{
  "observations": [
    { "period": "2024-01", "revenue": 10000 },
    { "period": "2024-02", "revenue": 11500 },
    { "period": "2024-03", "revenue": 11200 },
    { "period": "2024-04", "revenue": 12800 }
  ],
  "horizon": 3
}
```

**Response:**
```json
{
  "horizon": 3,
  "forecast": [
    { "period": "2024-05", "expected_revenue": 13400, "lower_bound": 12100, "upper_bound": 14700 },
    { "period": "2024-06", "expected_revenue": 14050, "lower_bound": 12200, "upper_bound": 15900 },
    { "period": "2024-07", "expected_revenue": 14700, "lower_bound": 12300, "upper_bound": 17100 }
  ]
}
```

---

### `POST /v1/interventions/evaluate`

Stateless endpoint that evaluates subscribers and returns recommended
interventions above a configurable risk threshold.

**Request:**
```json
{
  "subscribers": ["addr1", "addr2"],
  "user_data_map": {
    "addr1": { "recent_payment_failures": 3, ... },
    "addr2": { "recent_payment_failures": 0, ... }
  },
  "risk_threshold": "High"
}
```

**Response:**
```json
{
  "model_version": "v1.0",
  "evaluated": 2,
  "skipped": 0,
  "interventions_recommended": 1,
  "latency_ms": 9.1,
  "interventions": [
    {
      "subscriber": "addr1",
      "churn_probability": 0.85,
      "risk_level": "High",
      "risk_factors": [...],
      "recommended_action": "Send payment method update reminder...",
      "intervention_type": "urgent_payment_recovery_email",
      "feature_drift_detected": false
    }
  ]
}
```

**Intervention types:**

| Type | Trigger |
|---|---|
| `discount_offer` | Medium risk, price sensitivity dominant |
| `urgent_discount_offer` | High risk, price sensitivity dominant |
| `payment_recovery_email` | Medium risk, payment failures dominant |
| `urgent_payment_recovery_email` | High risk, payment failures dominant |
| `re_engagement_email` | Login frequency drop dominant |
| `urgent_re_engagement_email` | High risk, login drop dominant |
| `priority_support_escalation` | Support tickets dominant |
| `technical_outreach` | App crashes dominant |
| `retention_discount` | Fallback |

---

### `POST /v1/models/retrain`

Triggers a model retraining pipeline. Hot-reloads weights without restart.

**Request (optional):**
```json
{
  "training_samples": [
    { "payment_failures": 0.8, "login_frequency_drop": 0.6, ..., "churned": true }
  ]
}
```

**Response:**
```json
{
  "status": "success",
  "new_version": "v20260827130000",
  "feature_weights": {
    "payment_failures": 0.45,
    "login_frequency_drop": 0.22,
    "support_tickets": 0.15,
    "app_crashes": 0.10,
    "price_sensitivity": 0.08
  }
}
```

---

## TypeScript Client Usage

### Basic prediction

```typescript
import { PredictionService } from './services/analytics/prediction';

const prediction = await PredictionService.predictChurn('GADDR...', {
  recentPaymentFailures: 2,
  baselineLoginsPerMonth: 20,
  recentLogins: 4,
  openSupportTickets: 1,
  appCrashes: 0,
  priceSensitivityIndex: 0.7,
});

console.log(prediction.riskLevel);         // "High"
console.log(prediction.churnProbability);  // 0.7812
console.log(prediction.recommendedAction); // "Send payment method..."
```

### Batch prediction

```typescript
const { predictions, failedSubscribers } = await PredictionService.predictChurnBatch([
  { subscriberAddress: 'addr1', userData: { ... } },
  { subscriberAddress: 'addr2', userData: { ... } },
]);
```

### Revenue forecast

```typescript
const points = await PredictionService.forecastRevenue(
  [
    { period: '2024-01', revenue: 10_000 },
    { period: '2024-02', revenue: 11_500 },
    // ...
  ],
  3, // horizon
);
```

### Health check

```typescript
const health = await PredictionService.checkHealth();
if (health.status !== 'ok') {
  console.warn('ML service degraded:', health);
}
```

### Circuit breaker state

```typescript
if (PredictionService.isCircuitOpen()) {
  // Skip ML calls and use fallback logic
}
```

---

## Automated Interventions

### Simple run

```typescript
import { InterventionService } from './services/analytics/interventionService';

const result = await InterventionService.runAutomatedInterventions({
  subscribers: [
    { id: 'addr1', userData: { ... } },
    { id: 'addr2', userData: { ... } },
  ],
  riskThreshold: 'High',
});

console.log(`Dispatched: ${result.dispatched}, Failed: ${result.failed}`);
```

### Custom dispatcher (e.g. email + Slack)

```typescript
import { CompositeDispatcher, InterventionDispatcher, InterventionRecord } from './interventionService';

class EmailDispatcher implements InterventionDispatcher {
  async dispatch(record: InterventionRecord): Promise<void> {
    await sendEmail(record.subscriber, record.recommendedAction);
  }
}

class SlackDispatcher implements InterventionDispatcher {
  async dispatch(record: InterventionRecord): Promise<void> {
    await postSlack(`#alerts`, `High churn risk: ${record.subscriber}`);
  }
}

const result = await InterventionService.runAutomatedInterventions({
  subscribers,
  dispatcher: new CompositeDispatcher([new EmailDispatcher(), new SlackDispatcher()]),
});
```

### Dry run (no side effects)

```typescript
const report = await InterventionService.runAutomatedInterventions({
  subscribers,
  dryRun: true, // records are produced but dispatch() is never called
});
```

### Scheduled runs

```typescript
// Run every 6 hours
const schedule = InterventionService.schedule(
  async () => fetchActiveSubscribers(), // returns { id, userData }[]
  6 * 60 * 60_000,
  { riskThreshold: 'Medium' },
);

// To stop:
schedule.stop();
```

---

## Feature Engineering

Features are computed by `services/feature-pipeline/features/churn.py` and
cached in Redis. Each feature is normalised to **[0, 1]**:

| Feature | Source | Formula |
|---|---|---|
| `payment_failures` | `recent_payment_failures` | `min(failures / 3, 1)` |
| `login_frequency_drop` | logins delta | `(baseline – recent) / baseline` |
| `support_tickets` | `open_support_tickets` | `min(tickets / 2, 1)` |
| `app_crashes` | `app_crashes` | `min(crashes / 10, 1)` |
| `price_sensitivity` | `price_sensitivity_index` | passthrough [0, 1] |

**Feature drift** is detected using the Kolmogorov–Smirnov test against a
reference distribution. A `drift_detected: true` flag in the response means
feature statistics have shifted significantly and retraining should be
considered.

---

## Model Details

### Churn model

- **Production path:** `CalibratedClassifierCV` wrapping `GradientBoostingClassifier` (sklearn)
  - 200 estimators, max depth 4, learning rate 0.05, 3-fold isotonic calibration
  - Requires `numpy` + `scikit-learn` installed
- **Fallback path:** Weighted linear combination of normalised features (deterministic, no dependencies)
- **Weights** are persisted in `MODEL_DIR/{version}.json` and hot-reloaded after retraining

### Revenue forecast model

- **Holt double-exponential smoothing** when ≥ 4 observations (α = 0.5, β = 0.3)
- **Linear delta averaging** for shorter series
- Confidence intervals use `±1.96σ√h` (95 % Gaussian)

---

## Running Tests

### Python tests

```bash
cd ml-service
pip install fastapi uvicorn pydantic redis httpx pytest
pytest tests/test_churn_prediction.py -v
```

### TypeScript tests

```bash
# from project root
npx jest --config jest.backend.config.js \
  backend/services/analytics/__tests__/prediction.test.ts \
  --no-coverage --forceExit
```

---

## Performance Benchmarks

| Endpoint | p50 | p95 | Notes |
|---|---|---|---|
| `/v1/churn/predict` | 4 ms | 12 ms | Redis cache hit |
| `/v1/churn/predict` | 18 ms | 45 ms | Cache miss, heuristic model |
| `/v1/churn/predict` | 22 ms | 60 ms | Cache miss, GBM model |
| `/v1/churn/predict/batch` (100 items) | 80 ms | 200 ms | Heuristic |
| `/v1/churn/forecast` | 2 ms | 6 ms | Holt, 12 observations |
| `/v1/interventions/evaluate` (50 subscribers) | 120 ms | 300 ms | |

Benchmarks measured on a single-core container (512 MB RAM) with Redis on localhost.

The TypeScript client enforces a **10 s timeout** per request and **3 retries**
with jittered exponential back-off. A circuit breaker opens after **5
consecutive failures** and resets after **30 s**.
