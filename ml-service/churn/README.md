# Renewal pre-flight (`ml-service/churn/`)

Issue #2033 adds a churn-aware gate in front of auto-renewal. The churn model
already produced a probability, but nothing consumed it before charging a
subscriber. This package turns that probability into an explicit, observable
decision.

## Decision policy

| Probability | Action | Meaning |
| --- | --- | --- |
| `< 0.40` | `renew` | Proceed with the scheduled charge. |
| `0.40 – 0.69` | `review` | Renew, but surface a retention nudge. |
| `0.70 – 0.89` | `defer` | Pause for 15 minutes and offer an incentive. |
| `>= 0.90` | `block` | Require explicit confirmation before charging. |

Failures fail closed: an invalid, stale or missing prediction becomes `review`,
never an automatic `renew`. A missing or expired payment method becomes
`block`. After `max_defer_attempts` deferrals the decision escalates to
`review` so a subscription cannot be deferred forever.

Thresholds, prediction freshness and defer limits are configurable through
`PreflightPolicy`.

## Layout

- `policy.py` — pure decision engine and serialisable `PreflightDecision`.
- `predictor.py` — typed adapter over the existing `models.ChurnPredictionModel`.
- `service.py` — idempotency cache, structured telemetry and failure handling.
- `api.py` — FastAPI router and standalone app exposing
  `POST /v1/churn/renewal/preflight`.

## Run

```bash
cd ml-service
uvicorn churn.api:app --port 8001
```

The router can also be mounted in the main ML app:

```python
from churn.api import router as renewal_router

app.include_router(renewal_router)
```

## Request

```json
{
  "subscriptionId": "sub-1",
  "subscriber": "0xABC",
  "renewalAt": "2026-11-25T00:00:00Z",
  "amountMinor": 1999,
  "currency": "USD",
  "attempt": 1,
  "paymentMethodAvailable": true,
  "paymentMethodExpired": false,
  "features": {
    "recentPaymentFailures": 2,
    "baselineLoginsPerMonth": 20,
    "recentLogins": 8,
    "openSupportTickets": 1,
    "priceSensitivityIndex": 0.8
  }
}
```

Both camelCase and snake_case keys are accepted. The response includes the
`action`, stable `reason`, `risk_level`, `churn_probability`, `model_version`,
an `idempotency_key` and optional `retry_after_seconds`.

## Observability

`StructuredTelemetry` emits JSON counters and gauges to the `churn.preflight`
logger:

- `renewal_preflight_decision` (action, reason, risk level, subscription)
- `renewal_preflight_prediction_failed` (error type, subscription)
- `renewal_preflight_cache_hit`
- `renewal_preflight_churn_probability` (gauge, `-1` when unavailable)

Inject any object with `counter(name, **labels)` and `gauge(name, value,
**labels)` to forward these to Prometheus/StatsD.

## Tests

```bash
pytest churn/tests -v
```
