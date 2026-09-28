# Subscription pause/resume with billing adjustment (Issue #1116)

Pausing a subscription now produces a real billing adjustment instead of a simple
boolean flip: the unused portion of the current period becomes a credit that is
applied to the next invoice, and resuming early refunds the unconsumed part of it.

## Billing math

```
credit       = (pauseDays / periodDays) * price      (capped at `price`)
remaining    = price - credit
early refund = ((pauseDays - daysElapsed) / pauseDays) * credit
```

`periodDays` is 30 for monthly plans and 365 for yearly plans. Credits expire
`CREDIT_EXPIRY_DAYS` (90) days after the pause is resumed.

## Limits

| Limit              | Default |
| ------------------ | ------- |
| Minimum pause      | 7 days  |
| Maximum pause      | 90 days |
| Pauses per year    | 2       |

Requests outside these limits are rejected before any state changes.

## API

| Method | Path                                | Purpose                              |
| ------ | ----------------------------------- | ------------------------------------ |
| `POST` | `/subscriptions/:id/pause`          | Pause and issue the credit           |
| `POST` | `/subscriptions/:id/pause/preview`  | Dry-run the adjustment (no state)    |
| `POST` | `/subscriptions/:id/pause/resume`   | Resume, optionally early             |
| `GET`  | `/subscriptions/:id/pause`          | Active pause plus full history       |

### Example

```bash
curl -X POST http://localhost:3000/subscriptions/sub_1/pause \
  -H 'content-type: application/json' \
  -d '{"price":30,"currency":"USD","pauseDays":14,"reason":"vacation"}'
```

The response contains the persisted `session`, the `adjustment`
(`creditAmount`, `remainingBalance`, `creditExpiryDays`) and `earlyResumeCredit`,
the amount refunded if the customer resumes right now.

Errors follow the standard envelope:

- `409 SUBSCRIPTION_PAUSED` – already paused
- `422 VALIDATION_ERROR` – duration/price/reason outside the allowed range
- `404 NOT_FOUND` – resume requested for a subscription with no active pause

## Code map

- `backend/subscription/domain/pauseBilling.ts` – pure credit math and validation
- `backend/subscription/domain/pauseStateStore.ts` – pause sessions, auto-resume
- `backend/subscription/controller/pauseController.ts` – HTTP handlers
- `backend/subscription/router/subscriptionOpsRouter.ts` – route table
- `src/store/pauseStore.ts` – client-side credit ledger and state machine
- `src/screens/PauseSubscriptionScreen.tsx` – pause UI with credit preview

## End-to-end flow

1. `SubscriptionDetailScreen` → **Set Pause Schedule** → `PauseSubscription`.
2. The screen previews the credit before the customer confirms.
3. Confirming stores a `PauseRecord` and marks the subscription inactive.
4. Resuming restores the subscription and credits the unused days.

## Tests

```bash
npx jest -c jest.backend.config.js backend/subscription
npm test -- src/store/__tests__/pauseStore.test.ts
```
