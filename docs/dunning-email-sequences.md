# Dunning Email Sequences with A/B Testing

## Overview

SubTrackr's dunning system recovers failed payments through a configurable 4-stage escalation pipeline, with per-stage A/B testing for email content optimisation.

| Component | File | Purpose |
|-----------|------|---------|
| Core dunning engine | `backend/services/billing/dunningService.ts` | Retry scheduling, stage progression, analytics |
| Email sequences + A/B | `backend/services/notification/dunningEmailSequences.ts` | Variant management, test lifecycle, deliverability |
| Types | `src/types/dunning.ts`, `src/types/dunningABTest.ts` | Shared type contracts |

---

## Dunning Stages

```
retry → warn → suspend → cancel
```

| Stage    | Default Delay | Purpose |
|----------|--------------|---------|
| `retry`  | 1 hour       | Automatic retry, subscriber unaware |
| `warn`   | 24 hours     | Notify subscriber, request payment update |
| `suspend`| 72 hours     | Service suspended, urgent action required |
| `cancel` | 168 hours    | Subscription cancelled |

---

## Retry Backoff Policies

| Policy | Formula | Best For |
|--------|---------|---------|
| `fixed` | `baseDelayHours` always | Expired cards (action required before retry helps) |
| `linear` | `baseDelayHours × attempt` | Auth-required flows |
| `exponential` | `base × multiplier^(n-1)` | Card declines |
| `exponential_jitter` | exponential ± `jitterRatio` spread | Network errors (prevents thundering herd) |

### Default Schedules

| Failure Type | Policy | Base (h) | Max Retries |
|-------------|--------|----------|-------------|
| `insufficient_funds` | `exponential_jitter` (±20%) | 1 | 5 |
| `card_declined` | `exponential` | 2 | 3 |
| `expired_card` | `fixed` | 24 | 2 |
| `network_error` | `exponential_jitter` (±30%) | 0.5 | 6 |
| `processing_error` | `exponential` | 1 | 4 |
| `auth_required` | `linear` | 0.25 | 3 |

---

## Email A/B Testing

### Lifecycle

```
draft → running → (paused ↔ running) → completed
```

### Quick Start

```typescript
import { dunningEmailSequenceService } from 'backend/services/notification';

// 1. Create variants
const control = dunningEmailSequenceService.createVariant({
  name: 'Control — Direct',
  subject: 'Your payment failed',
  body: 'Please update your payment method to restore service.',
  stage: 'retry',
  weight: 50,
});

const treatment = dunningEmailSequenceService.createVariant({
  name: 'Treatment — Empathetic',
  subject: 'We had trouble charging your card',
  body: 'Hi {{name}}, no worries — it happens. Tap below to update your card in 30 seconds.',
  stage: 'retry',
  weight: 50,
});

// 2. Create and start the test
const test = dunningEmailSequenceService.createABTest({
  name: 'Retry email tone test',
  stage: 'retry',
  variantIds: [control.id, treatment.id],
});
dunningEmailSequenceService.startABTest(test.id);

// 3. Assign variant per subscriber (deterministic for repeat calls)
const variant = dunningEmailSequenceService.assignVariant(test.id, subscriberId);

// 4. Send variant.subject / variant.body via your email transport

// 5. Log delivery
const log = dunningEmailSequenceService.logDelivery({
  subscriberId,
  subscriptionId,
  stage: 'retry',
  variantId: variant.id,
  testId: test.id,
  subject: variant.subject,
  channel: 'email',
  status: 'sent',
});

// 6. Track engagement
dunningEmailSequenceService.updateDeliveryStatus(log.id, 'opened', {
  openedAt: Date.now(),
});

// 7. Get results
const results = dunningEmailSequenceService.getABTestResults(test.id);
// [{ variantId, sends, opens, clicks, openRate, clickRate, recoveryRate }, ...]

// 8. Complete and declare winner
dunningEmailSequenceService.completeABTest(test.id);
// winningVariantId auto-selected by highest recoveryRate
```

---

## Variant Assignment

Variants are assigned by weighted random selection. Once assigned, a subscriber always receives the same variant (sticky assignment):

```typescript
// sub_001 will always get the same variant for this test
dunningEmailSequenceService.assignVariant(testId, 'sub_001'); // → variantA
dunningEmailSequenceService.assignVariant(testId, 'sub_001'); // → variantA (same)
```

---

## Deliverability Metrics

```typescript
const metrics = dunningEmailSequenceService.getDeliverabilityMetrics();
// {
//   totalSent, delivered, bounced, opened, clicked,
//   deliveryRate, bounceRate, openRate, clickRate,
//   byStage: { retry: {...}, warn: {...}, suspend: {...}, cancel: {...} },
//   byVariant: { [variantId]: { sent, delivered, opened, clicked, recoveryRate } }
// }
```

### Optimal Send Time

```typescript
const { hour, reason } = dunningEmailSequenceService.getOptimalSendTime('retry');
// Uses historical open data; defaults to 10:00 UTC with < 10 data points
```

### Sequence Recommendations

```typescript
const recs = dunningEmailSequenceService.getSequenceRecommendations();
// [{ type: 'content' | 'timing' | 'frequency', message, impact: 'high' | 'medium' | 'low' }]
```

Triggers automatically when:
- Bounce rate > 5%
- Open rate < 20%
- Click rate < 5%
- No A/B test is running for a stage that has ≥ 2 active variants

---

## Dunning Service A/B Testing (Strategy Level)

In addition to email-content A/B testing, the `DunningService` supports A/B testing at the **retry strategy** level:

```typescript
import { dunningService } from 'backend/services/billing/dunningService';

dunningService.configureABTest('plan_pro', true, [
  {
    id: 'aggressive',
    weight: 50,
    strategy: {
      stages: DEFAULT_DUNNING_STAGES,
      maxRetries: 5,
      retryIntervalHours: 1,
      warnAfterFailures: 2,
      suspendAfterDays: 2,
      cancelAfterDays: 5,
      communicationChannels: ['email', 'push', 'in_app'],
    },
  },
  {
    id: 'gentle',
    weight: 50,
    strategy: {
      stages: DEFAULT_DUNNING_STAGES,
      maxRetries: 3,
      retryIntervalHours: 24,
      warnAfterFailures: 3,
      suspendAfterDays: 7,
      cancelAfterDays: 14,
      communicationChannels: ['email'],
    },
  },
]);
```

---

## Analytics

```typescript
// Recovery and stage analytics
const analytics = dunningService.getAnalytics('merch_1');
// { totalActiveDunning, stageBreakdown, recoveryRate, totalRecovered, totalLost,
//   averageDaysToRecovery, stageSuccessRates }

// Retry-specific analytics
const retryAnalytics = dunningService.getRetryAnalytics('merch_1');
// { totalRetries, successfulRetries, failedRetries, retryRate, successRate,
//   averageRetriesBeforeSuccess, retriesByFailureType, retriesByStage,
//   averageTimeToRecovery }
```

---

## Performance Benchmarks

| Operation | Throughput |
|-----------|-----------|
| `startDunning()` | > 10 000 / sec |
| `recordFailedCharge()` | > 5 000 / sec |
| `getProcessableEntries()` (1 000 active) | < 1 ms |
| `getDeliverabilityMetrics()` (10 000 logs) | < 5 ms |

All data is in-memory. For production persistence, replace the internal `Map` stores with a database repository implementing the same interface and call `reset()` only for test isolation.
