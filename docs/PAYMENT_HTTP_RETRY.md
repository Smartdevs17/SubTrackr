# Shared gateway HTTP retry

`backend/services/shared/httpRetry.ts` owns the transport mechanics shared by
every outbound payment/billing HTTP client.

## Why it exists

Three gateways each grew their own copy of the same "fetch, decide if the
status is transient, back off, give up" loop:

| Client                                | Retry loop           | Local `defaultSleep` | Local `parseJson` | Local `resolveFetch` |
| ------------------------------------- | -------------------- | -------------------- | ----------------- | -------------------- |
| `services/payment/…/PaddleAdapter`    | `call()`             | yes                  | yes               | yes                  |
| `services/payment/…/ShopifyAdapter`   | `call()`             | yes                  | yes               | yes                  |
| `billing/…/StripeApiClient`           | `request()`          | yes                  | inline            | yes                  |

All three also duplicated the same tunables (`3` attempts, `250ms` base delay,
clamped to `>= 1` / `>= 0`). Duplicating a retry policy on the money path means
a fix has to be applied three times, and a missed application is a
double-charge or a stuck-outage bug. Centralising it makes the policy one
editable thing.

## API

- **`isRetryableStatus(status, code?)`** — the canonical policy. `429` and any
  `5xx` are transient; `409` is transient only for Stripe's `lock_timeout`.
- **`runWithRetries(attempt, options)`** — the attempt loop. `attempt` returns
  one of three outcomes:
  - `{ done: true, value }` — settled, stop.
  - `{ done: false, retry: false, value }` — terminal (e.g. a `400`), answer
    immediately **without** spending the rest of the budget.
  - `{ done: false, retry: true, value }` — transient, back off and try again.
    If the budget is exhausted, `value` is returned.
- **`resolveMaxAttempts(retryable, maxAttempts)`** — pins a non-retryable
  operation to one attempt and clamps the configured budget.
- **`linearBackoff(attempt, baseDelayMs)`** — `base * attempt`, preserving the
  behaviour the gateways had before. Override via `options.backoff`.
- **`resolveFetchImpl(injected)`** — injected `fetch` wins, then `globalThis.fetch`.
- **`parseJsonObject(text)`** — `JSON.parse` returning `null` for malformed input
  and for non-object payloads (`null`, arrays, primitives).

## Usage

```ts
return runWithRetries<Outcome>(
  async () => {
    const response = await fetchImpl(url, { method, headers, body });
    const text = await response.text();

    if (isRetryableStatus(response.status)) {
      return { done: false, retry: true, value: transientOutcome };
    }
    if (!response.ok) {
      // A 4xx is a bug or a bad request: answer now, do not retry.
      return { done: false, retry: false, value: terminalOutcome };
    }
    return { done: true, value: successOutcome };
  },
  { maxAttempts, baseDelayMs: this.retryBaseDelayMs, sleep: this.sleep, onRetry: logAttempt },
);
```

Anything `attempt` throws is treated as a transient transport failure and
retried; on the final attempt the last thrown value is rethrown, so
`StripeApiClient` keeps its `StripeApiError` contract.

### Retry safety is per-operation, not global

Retries stay opt-in per call site because idempotency differs per operation:

- **Retried** — Paddle `charge` and Stripe writes, because the gateway
  de-duplicates on `Idempotency-Key`.
- **Not retried** — Paddle `refund` (a repeated refund refunds twice) and
  `createCustomer`, Stripe `GET`, and Shopify operations without an idempotency
  key. These pass `retryable: false` or default to a single attempt.

## Testing

`backend/services/shared/__tests__/httpRetry.test.ts` covers the policy, the
clamping, the backoff sequence, the three outcome kinds and `sleep` call counts.
The behaviour-preservation net is the pre-existing adapter suites:

- `backend/services/payment/__tests__/PaddleAdapter.test.ts`
- `backend/services/payment/__tests__/ShopifyAdapter.test.ts`
- `backend/billing/tests/stripeBilling.test.ts`

Because this is money-path logic, run `npm run mutation:test:backend` as well —
it is the strongest check that the clamping and policy predicates are actually
asserted.

## Deliberately out of scope

These loops are *not* candidates for this helper, because their semantics differ
in ways the shared API does not model:

- `services/notification/webhook.ts` — persists per-attempt delivery state,
  honours a computed `retryPolicy`, and auto-disables on HTTP `410`.
- `dr/RunbookEngine.ts` — exponential (`2^(attempt-1)`) backoff with a per-step
  timeout.
- `services/analytics/prediction.ts` — a circuit breaker around the loop.
