# Network-aware intelligent payment retry (#2198)

`backend/services/billing/networkRetryScheduler.ts` replaces fixed, network-agnostic
retry delays with a deterministic scoring model that uses the card network, the
decline code, shopper history and realised retry outcomes.

## Inputs

| Field | Purpose |
| --- | --- |
| `cardNetwork` | `visa`, `mastercard`, `amex`, `discover`, `jcb`, or `unknown`. Use `normalizeCardNetwork()` for a PAN, BIN or gateway label. |
| `declineCode` | Issuer decline reason. Terminal declines (`card_lost_stolen`) are never retried. |
| `attempt` | Number of prior failed attempts; drives bounded exponential backoff. |
| `amount` | Large charges receive a small probability penalty. |
| `previousSuccessRate` | Optional per-subscriber historical success rate. |
| `maxAttempts`, `now` | Optional deterministic overrides for tests and workers. |

## Model

Each candidate window is scored with `score = P(success) - delayPenalty + jitter`:

- `P(success)` is a logistic function over network priors, decline recovery bias,
  preferred authorisation hour, attempt number, charge amount and incrementally
  learned network/decline/hour/subscriber success rates.
- Rewards are smoothed: a prior needs five observations before it influences the
  model, so a single lucky retry cannot skew scheduling.
- Jitter is derived from a stable FNV-1a hash of the charge identity, so equal
  inputs always produce equal plans without synchronising random seeds.
- All delays are clamped per decline profile and shifted by up to six hours toward
  the network's preferred UTC authorisation hour.

## Usage

```ts
import { networkRetryScheduler } from './backend/services/billing/networkRetryScheduler';

const plan = networkRetryScheduler.planRetry({
  subscriptionId: 'sub_123',
  cardNetwork: normalizeCardNetwork('4242424242424242'),
  declineCode: 'insufficient_funds',
  attempt: 0,
  amount: 29,
});

const next = plan.candidates[0];
if (next) {
  await scheduleCharge(plan.subscriptionId, next.scheduledAt, next.outreachChannel);
}

networkRetryScheduler.recordOutcome({
  subscriptionId: plan.subscriptionId,
  cardNetwork: plan.cardNetwork,
  declineCode: plan.declineCode,
  delayHours: next?.delayHours ?? 0,
  succeeded: true,
});
```

`toDunningFailureType()` maps the decline code onto the existing dunning failure
taxonomy, and `getNetworkInsights()` exposes learned success rates, the best hour
per network and the average delay that led to a successful charge.

## Operations

- `getNetworkInsights(network)` — monitoring/analytics input.
- `reset()` — clears learned state (tests and model rollbacks).
- `NetworkRetryScheduler.MODEL_VERSION` — attach to scheduled jobs so a model
  change can be audited against recovery rates.

Unit tests: `backend/services/billing/__tests__/networkRetryScheduler.test.ts`.
