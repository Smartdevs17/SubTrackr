# Typed Event Bus

`backend/services/shared/events.ts`

## Overview

SubTrackr uses an in-process typed event bus for decoupled, domain-driven communication between services. Events carry full TypeScript types, are validated at runtime, and are stored in an append-only event store for sourcing and replay.

## Domain Event Definitions

| Domain | Event name | Key payload fields |
|---|---|---|
| subscription | `subscription.created` | `subscriptionId`, `userId`, `planId`, `billingCycle`, `nextBillingDate` |
| subscription | `subscription.cancelled` | `subscriptionId`, `reason`, `cancelledAt`, `effectiveAt` |
| subscription | `subscription.renewed` | `subscriptionId`, `amount`, `currency`, `nextBillingDate` |
| subscription | `subscription.upgraded` | `fromPlanId`, `toPlanId`, `proratedCredit` |
| subscription | `subscription.paused` | `subscriptionId`, `pausedAt`, `resumeAt` |
| subscription | `subscription.resumed` | `subscriptionId`, `resumedAt` |
| subscription | `subscription.payment_failed` | `attemptNumber`, `nextRetryAt`, `reason` |
| billing | `billing.invoice_generated` | `invoiceId`, `amount`, `currency`, `dueDate` |
| billing | `billing.payment_captured` | `paymentId`, `amount`, `currency`, `gateway` |
| billing | `billing.usage_threshold_reached` | `metricType`, `usage`, `limit`, `level` |
| billing | `billing.chargeback_raised` | `chargebackId`, `amount`, `reason` |
| analytics | `analytics.churn_risk_updated` | `riskScore`, `previousScore`, `factors` |
| analytics | `analytics.cohort_aggregated` | `cohortId`, `period`, `retentionRate` |
| analytics | `analytics.mrr_changed` | `previousMrr`, `currentMrr`, `delta` |
| auth | `auth.api_key_rotated` | `keyId`, `merchantId`, `expiresAt` |
| auth | `auth.sso_session_created` | `sessionId`, `provider`, `expiresAt` |
| contract | `contract.invoked` | `contractId`, `method`, `caller`, `ledger` |
| contract | `contract.upgraded` | `proxyId`, `fromImplementation`, `toImplementation` |

## Publishing Events

```typescript
import { buildEvent, eventBus } from '../services/shared/events';

const event = buildEvent('subscription', 'created', {
  subscriptionId: 'sub_abc',
  userId: 'user_123',
  planId: 'plan_pro',
  status: 'active',
  billingCycle: 'monthly',
  nextBillingDate: Date.now() + 30 * 86400_000,
}, { aggregateId: 'sub_abc', correlationId: req.correlationId });

await eventBus.publish(event);
```

`buildEvent` throws `EventValidationError` if the payload fails schema validation.

## Subscribing

```typescript
// Specific event
eventBus.subscribe('subscription.cancelled', async (event) => {
  await notifyUser(event.payload.userId);
});

// Wildcard — receives everything
eventBus.subscribe('*', (event) => {
  logger.info('event received', { name: event.name });
});

// With predicate filter
eventBus.subscribe('billing.usage_threshold_reached', handler, {
  filter: (e) => e.payload.level === 'hard',
});

// Clean up
const sub = eventBus.subscribe('subscription.created', handler);
sub.unsubscribe();
```

## Schema Validation

Schemas are defined in `PAYLOAD_SCHEMAS` inside `events.ts`. Call `validateEventPayload` directly for manual checks:

```typescript
const result = validateEventPayload('subscription.created', payload);
if (!result.valid) console.error(result.errors);
```

## Event Sourcing

```typescript
import { eventStore, buildEvent } from '../services/shared/events';

// Append
eventStore.append(buildEvent('subscription', 'created', { ... }, { aggregateId: 'sub_abc' }));

// Replay all events for an aggregate in sequence order
eventStore.replay('sub_abc', (event) => applyToState(event));

// Reconstruct current state from event history
const state = eventStore.reconstruct('sub_abc');

// Snapshot
const snap = eventStore.snapshot('sub_abc');
// { aggregateId, state, lastSequence, lastEventType, updatedAt }

// Archive events older than 30 days
eventStore.archiveBefore(Date.now() - 30 * 86400_000);
```

## Event Replay for Debugging

```typescript
// Query events by domain, type, or time window
const events = eventStore.query({
  aggregateId: 'sub_abc',
  domain: 'subscription',
  from: Date.now() - 7 * 86400_000,
  limit: 100,
});
```

## Event-Driven Testing

```typescript
import { SpyEventBus, EventCollector } from '../services/shared/events';

// SpyEventBus — wraps real bus, records all publishes
const spy = new SpyEventBus();
await myService.cancel(subscriptionId, spy);
spy.assertPublished('subscription.cancelled');

// EventCollector — attach to any bus
const collector = new EventCollector(eventBus, 'subscription.renewed');
await runRenewal();
collector.assertCount(1);
collector.assertLastEventName('subscription.renewed');
collector.dispose();
```

## Performance Monitoring

```typescript
const metrics = eventBus.getMetrics();
// { published, handled, errors, avgHandlerLatencyMs, countByName, throughputPerSecond }

// Prometheus export
import { eventBusPrometheusMetrics } from '../services/shared/events';
const prometheusText = eventBusPrometheusMetrics(eventBus);
```

## IoC Container Tokens

| Token | Type |
|---|---|
| `IEventBus` | `EventBus` singleton |
| `IEventStore` | `InMemoryEventStore` singleton |

```typescript
const bus = container.resolve<IEventBus>('IEventBus');
const store = container.resolve<EventSourcedStore>('IEventStore');
```

