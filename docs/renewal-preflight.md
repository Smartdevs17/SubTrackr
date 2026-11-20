# Auto-renewal pre-flight

Issue #2033 adds a churn-aware gate before a subscription is charged. The ML
service owns the risk policy in `ml-service/churn/`; the billing worker calls it
through `backend/src/services/renewal.ts`.

## Flow

1. The worker builds a `RenewalCandidate` (subscription, subscriber, renewal
   date, amount, payment-method state and churn signals).
2. `createHttpChurnPreflightClient` posts to
   `POST /v1/churn/renewal/preflight` with a correlation ID and optional API
   key.
3. `createRenewalService` retries retryable failures with exponential backoff,
   emits telemetry and normalises the response.
4. Only an explicit `renew` decision may be charged. `review`, `defer` and
   `block` are handed to the retention scheduler.

If the ML service is unreachable, malformed or returns an unknown action, the
service returns a `review` decision with reason `PREFLIGHT_UNAVAILABLE` and
`retryAfterSeconds: 60`. It never fails open into a charge.

## Usage

```ts
import {
  createHttpChurnPreflightClient,
  createRenewalService,
  shouldAutoRenew,
} from './src/services/renewal';

const service = createRenewalService({
  client: createHttpChurnPreflightClient({
    baseUrl: process.env.ML_SERVICE_URL ?? 'http://localhost:8000',
    apiKey: process.env.ML_SERVICE_API_KEY,
    timeoutMs: 3000,
  }),
  maxAttempts: 3,
  telemetry: prometheusRenewalTelemetry,
});

const decision = await service.preflight(candidate);
if (shouldAutoRenew(decision)) await charge(candidate);
else await scheduleRetention(candidate, decision);
```

## Idempotency

The ML decision carries an `idempotency_key` derived from subscription, renewal
timestamp and attempt. When an upstream response omits it, the backend derives
the same deterministic key locally. `nextAttempt(candidate, decision)` advances
the attempt only for `defer`/`block`, so a retry cannot accidentally reuse a
stale decision.

## Observability

`RenewalTelemetry.record` receives one event per pre-flight with `outcome`,
`attempts`, `durationMs`, `action`, `reason` and optional `errorCode`. The ML
package additionally emits `renewal_preflight_decision`,
`renewal_preflight_prediction_failed` and a churn-probability gauge; see
`ml-service/churn/README.md`.
