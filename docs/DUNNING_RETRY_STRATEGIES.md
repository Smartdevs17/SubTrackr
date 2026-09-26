# Dunning Retry Strategies

How `backend/services/billing/dunningService.ts` decides *when* to retry a
failed charge and *when* to give up. For the email/A-B-test layer that sits on
top of it see [DUNNING.md](./DUNNING.md); for the time-based stage escalation
rules see [DUNNING_ESCALATION.md](./DUNNING_ESCALATION.md).

## The two knobs

Retry behaviour is configured in two independent places, and it helps to keep
them apart:

| | Configured by | Scope | Answers |
|---|---|---|---|
| **Stage ladder** (`RetryStrategy`) | `configurePlan()` | per plan | *Which stage comes next, and how long the payer sits in it?* |
| **Retry schedule** (`RetryScheduleConfig`) | `configureRetrySchedule()` | per failure type, service-wide | *How long between retries inside a stage?* |

A subscription escalates to the next stage when **either** its stage's
`maxAttempts` or its failure type's `maxRetries` is spent — whichever comes
first.

## Strategy resolution

`getStrategy(planId, failureReason, abTestVariant)` picks the ladder, most
specific first:

```
A/B variant  →  failure-reason override  →  plan default  →  built-in fallback
```

So a plan can run a general ladder, a harsher one for `expired_card`, and still
A/B-test a third against both:

```ts
dunningService.configurePlan('plan_pro', {
  defaultStrategy: standardLadder,
  strategies: { expired_card: shortLadder },
});

dunningService.configureABTest('plan_pro', true, [
  { id: 'control',    weight: 50, strategy: standardLadder },
  { id: 'aggressive', weight: 50, strategy: aggressiveLadder },
]);
```

A variant is assigned once, at `startDunning()`, by weight, and is stored on the
entry so the subscription keeps the same treatment for its whole dunning run.
Reading a variant only matters while the test is enabled — flipping
`configureABTest(..., false, ...)` sends everyone back to the resolved ladder
without touching stored entries.

## Backoff policies

`calculateRetryDelay(failureType, attempt)` applies the failure type's
`backoffPolicy`. `attempt` is 1-based.

| Policy | Delay for attempt *n* |
|---|---|
| `fixed` | `baseDelayHours` |
| `linear` | `baseDelayHours × n` |
| `exponential` | `baseDelayHours × multiplier^(n-1)` |
| `exponential_jitter` | as `exponential`, then spread by ± `jitterRatio` |

Every result is clamped to `maxDelayHours`, jitter included — a jittered delay
never escapes the configured envelope.

### Why jitter

A single upstream outage fails hundreds of charges within the same second.
Without jitter every one of them retries at exactly the same instant, and the
retry storm hits the processor just as hard as the original burst. `jitterRatio:
0.2` spreads those retries over ±20% of the delay, which is enough to decorrelate
them.

Jitter is on by default for `insufficient_funds` and `network_error`, the two
failure types that arrive in correlated bursts.

### Defaults

| Failure type | Base | Max retries | Policy | Rationale |
|---|---|---|---|---|
| `insufficient_funds` | 1h | 5 | `exponential_jitter` | Funds may arrive; back off but keep trying. |
| `card_declined` | 2h | 3 | `exponential` | Usually needs the payer to act. |
| `expired_card` | 24h | 2 | `fixed` | Will keep failing until updated — a flat daily nudge beats escalation. |
| `network_error` | 30m | 6 | `exponential_jitter` | Transient; retry often, decorrelated. |
| `processing_error` | 1h | 4 | `exponential` | Usually transient. |
| `auth_required` | 15m | 3 | `linear` | The payer is likely still in-session. |
| `unknown` | 1h | 3 | `exponential` | Conservative default. |

Override any of them — partial updates merge onto the existing entry:

```ts
dunningService.configureRetrySchedule({
  failureType: 'insufficient_funds',
  maxRetries: 8,
  jitterRatio: 0.35,
});
```

### Non-retryable failures

Setting `retryable: false` skips the retry budget entirely: the first failure of
that type escalates straight to the next stage. Use it for hard declines where
retrying only burns processor reputation.

## Analytics

`getRetryAnalytics(merchantId?)` reports raw retry counts — attempts, success
rate, breakdown by failure type and by current stage, mean time to recovery.

`getAnalytics(merchantId?)` reports the business view. Note that `recoveryRate`
is measured over **closed outcomes only** — recovered entries versus entries that
reached `cancel`. Subscriptions still in dunning are deliberately excluded: their
outcome is not known yet, and counting them as failures would make the rate look
worse the more traffic is in flight.

## Testing

`backend/services/billing/__tests__/dunningService.test.ts` covers strategy
resolution precedence, every backoff policy, the jitter envelope, stage
escalation, and the analytics edge cases (empty history returns zeroes, not
`NaN`).

Construct a fresh `new DunningService()` per test, or call `reset()` on the
shared singleton — state is in-memory and otherwise leaks between tests.
