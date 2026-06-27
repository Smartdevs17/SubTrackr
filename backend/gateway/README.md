# Rate-Limit Anomaly Detection Gateway (#615)

Behavioral anomaly scoring + adaptive rate limiting to catch distributed attacks
(botnets, rotating IPs/API keys) that slip past static per-IP / per-key limits.

## Pieces

- **`featureExtraction.ts`** — turns a window of recent requests into a feature
  vector: request rate, endpoint-distribution entropy, time-of-day, average
  payload size, user-agent entropy, geographic (distinct-IP) spread.
- **`isolationForest.ts`** — dependency-free Isolation Forest (unsupervised) that
  scores anomalies in `[0, 1]`; deterministic via a seeded PRNG.
- **`anomalyDetector.ts`** — trains on normal-traffic windows and scores new ones.
- **`adaptiveRateLimit.ts`** — when a key's score crosses the threshold (default
  `0.8`) the effective limit is reduced 50%, and 90% past `0.95`. Allow-listed
  paths (webhooks/health) bypass reduction; per-key overrides handle false
  positives.
- **`middleware/adaptiveRateLimitMiddleware.ts`** — Express-compatible middleware
  wiring it together (sliding window per key, scoring, enforcement, headers).
- **`../monitoring/anomalyMetrics.ts`** — per-key anomaly-score gauge
  (Prometheus text exposition + the repo's flat metric shape).

The Python **`ml-service`** mirrors the model (`ml-service/anomaly/`,
`routers/anomaly.py` at `/v1/anomaly`) so scoring can run in-process in the
gateway or be delegated to the ML service.

## Tests

```bash
# Backend (TS)
npx jest --config jest.backend.config.js backend/gateway/__tests__/anomalyRateLimit.test.ts

# ml-service (Python)
cd ml-service && python -m pytest tests/test_anomaly.py
```

## Covered acceptance criteria

- Feature extraction (rate, endpoint distribution, time-of-day, payload size,
  user-agent entropy, geographic spread).
- Isolation Forest anomaly scoring with a configurable threshold.
- Adaptive limiting: reduce by 50% past threshold, 90% past the severe threshold.
- False-positive handling: allow-listed patterns + per-key manual override.
- Anomaly-score Prometheus metric per key (`backend/monitoring`).

## Follow-ups (out of this PR's core)

- Real-time Slack/PagerDuty alerting on high-confidence attacks (score > 0.95) —
  the detector already surfaces `high_confidence`.
- Admin `RateLimitDashboardScreen` (`mobile/app/screens/`).
- Seasonal model + event-day whitelisting; weekly auto-retrain + drift alerting
  (hooks belong in `ml-service/jobs/` / `ml-service/retrain.py`).
