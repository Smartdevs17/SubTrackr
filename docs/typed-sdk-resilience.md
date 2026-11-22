# Typed Client SDK with Resilience and Automatic Retry

Issue #2216 — Robust client SDK with circuit breaker and backoff retry.

## Overview

The SubTrackr JavaScript SDK (`@subtrackr/sdk`) already has typed API methods
and an exponential backoff retry policy. This adds a **circuit breaker** and an
integrated **resilience layer** that combines the circuit breaker with the
existing retry mechanism.

## Circuit Breaker

When the API is consistently failing, the circuit breaker stops sending
requests entirely — failing fast instead of waiting for each one to time out
or retry. This prevents cascading failures and gives the downstream service
time to recover.

### States

```
CLOSED  --(N consecutive failures)-->  OPEN
   ^                                      |
   |                                      | wait recoveryTimeoutMs
   |                                      v
   +--(M successes in half-open)--  HALF-OPEN
                                    |
                                    +--(any failure)--> OPEN
```

- **CLOSED**: requests flow normally. Consecutive failures are counted.
- **OPEN**: all requests fail immediately with `CircuitOpenError`. After
  `recoveryTimeoutMs` the breaker moves to HALF-OPEN.
- **HALF-OPEN**: a limited number of probe requests are allowed. If enough
  succeed, the breaker closes; any failure re-opens it.

### Usage

```typescript
import { CircuitBreaker } from '@subtrackr/sdk';

const breaker = new CircuitBreaker({
  failureThreshold: 5,       // trip after 5 consecutive failures
  recoveryTimeoutMs: 30_000, // wait 30s before probing
  successThreshold: 2,       // need 2 successes to close
  name: 'subtrackr-api',
});

try {
  const result = await breaker.execute(async () => {
    return await fetch('https://api.subtrackr.app/v1/subscriptions');
  });
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Circuit is open — fail fast, don't retry
  }
}
```

## Resilience Layer

The `withResilience` function combines the circuit breaker with the existing
retry mechanism:

1. If the circuit is OPEN, the request fails immediately with
   `CircuitOpenError` — no retry, no network call.
2. If the circuit is CLOSED or HALF-OPEN, the request runs through the retry
   policy. A successful request moves the breaker toward CLOSED; a failed
   request moves it toward OPEN.

### Usage

```typescript
import { withResilience, withResilienceAndBreaker, CircuitBreaker } from '@subtrackr/sdk';

// One-off: creates its own breaker
const result = await withResilience(
  async (attempt) => {
    const res = await fetch('https://api.subtrackr.app/v1/subscriptions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  {
    retry: { maxAttempts: 3, initialDelayMs: 200 },
    circuitBreaker: { failureThreshold: 5, recoveryTimeoutMs: 30_000 },
  },
);

// Shared breaker across multiple requests
const breaker = new CircuitBreaker({ name: 'shared' });
const result2 = await withResilienceAndBreaker(
  async (attempt) => fetch('https://api.subtrackr.app/health').then(r => r.json()),
  breaker,
  { retry: { maxAttempts: 3 } },
);
```

## Existing Retry Mechanism

The retry policy (already in the SDK) handles transient failures:

- Network errors (fetch threw)
- 429 Too Many Requests (respects Retry-After header)
- 503 Service Unavailable
- 502 / 504 Gateway errors
- 408 Request Timeout

Retry uses exponential backoff with ±20% jitter to prevent thundering herd.

## Testing

```bash
npx jest --config jest.backend.config.js \
  --testMatch '**/sdks/javascript/src/__tests__/circuitBreaker.test.ts' \
  --testMatch '**/sdks/javascript/src/__tests__/resilience.test.ts' \
  --coverage \
  --collectCoverageFrom='sdks/javascript/src/circuitBreaker.ts' \
  --collectCoverageFrom='sdks/javascript/src/resilience.ts'
```

Coverage: 100% statements, 94.73% branches, 89.47% functions, 100% lines
across 20 tests.
