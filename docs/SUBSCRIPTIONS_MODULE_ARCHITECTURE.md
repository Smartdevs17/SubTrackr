# Subscriptions Service — Module Architecture

> **Issue #2041** — Split monolithic subscriptions service into pricing, lifecycle, and sync modules.

## Why

The subscription-related code grew organically across six separate locations
(`backend/services/subscription/`, `backend/subscription/`, `backend/sync/`,
`backend/services/subscriptionCacheService.ts`,
`backend/services/subscriptionSlaMonitoring.ts`,
`backend/services/billing/pricingService.ts`), each with its own naming
conventions and no clear ownership model. Any small change required reading
all of them to find the relevant file.

This refactor draws explicit module boundaries so a reader can go straight
to the module that owns the concept they need, make the change, and stop.

---

## Directory layout

```
backend/src/services/subscriptions/
├── index.ts                    ← top-level barrel (namespaced + flat re-exports)
├── observability.ts            ← shared IMetricsRecorder, withSpan, MetricName
│
├── pricing/
│   ├── index.ts
│   ├── types.ts                ← BillingInterval, PlanTemplate, PriceInput, ProrationInput, …
│   ├── errors.ts               ← PricingError, PricingErrorCode
│   ├── pricingStrategies.ts    ← FlatRateStrategy, PerSeatStrategy, UsageBasedStrategy,
│   │                              TieredStrategy, StrategyRegistry
│   ├── prorationService.ts     ← ProrationService (pure, no I/O)
│   ├── planCacheService.ts     ← InMemoryPlanCache (IPlanCache interface)
│   └── __tests__/
│       └── pricing.test.ts
│
├── lifecycle/
│   ├── index.ts
│   ├── types.ts                ← SubscriptionStatus, Cancellation*, Pause*, Trial*, Sla*, …
│   ├── errors.ts               ← LifecycleError, LifecycleErrorCode
│   ├── cancellationService.ts  ← CancellationService
│   ├── pauseResumeService.ts   ← PauseResumeService
│   ├── trialService.ts         ← TrialService
│   ├── eventStore.ts           ← LifecycleEventStore (wraps SubscriptionEventStore)
│   ├── slaMonitoringService.ts ← SlaMonitoringService
│   └── __tests__/
│       └── lifecycle.test.ts
│
└── sync/
    ├── index.ts
    ├── types.ts                ← re-exports CRDT types + SyncEngine* types
    ├── errors.ts               ← SyncError, SyncErrorCode
    ├── syncEngineService.ts    ← SyncEngineService (facade over backend/sync/)
    └── __tests__/
        └── sync.test.ts
```

---

## Module responsibilities

### `pricing/`

Owns everything that answers the question **"how much does this cost?"**

| Export | Responsibility |
|--------|---------------|
| `StrategyRegistry` + strategies | Flat, per-seat, usage-based, and tiered price calculation |
| `ProrationService` | Billing adjustment when a plan changes mid-period |
| `InMemoryPlanCache` | Fast plan template lookup; swappable for Redis in production |
| `PricingError` | Typed errors with codes for every failure mode |

**Does not own:** subscription state, event sourcing, sync, SLA.

### `lifecycle/`

Owns everything that answers the question **"what state is this subscription in, and how did it get there?"**

| Export | Responsibility |
|--------|---------------|
| `CancellationService` | Immediate and end-of-period cancellation, mode resolution |
| `PauseResumeService` | Billing credit calculation on pause/resume |
| `TrialService` | Trial creation, conversion, expiry, and per-plan duration config |
| `LifecycleEventStore` | Append-only event log (wraps existing `SubscriptionEventStore`) |
| `SlaMonitoringService` | Real-time SLA breach detection, credit issuance, breach resolution |
| `LifecycleError` | Typed errors with codes for every failure mode |

**Does not own:** price calculation, CRDT sync.

### `sync/`

Owns everything that answers the question **"how do server and client stay consistent?"**

| Export | Responsibility |
|--------|---------------|
| `SyncEngineService` | Facade over the CRDT engine — validates requests, records metrics, logs outcomes |
| `InMemorySyncEventLog` | Re-exported from `backend/sync/`; inject a persistent log in production |
| `applyOperation`, `mergeEntityStates`, `replay`, `EntityProjection` | Pure CRDT reducers |
| `SyncError` | Typed errors for malformed requests and unresolved conflicts |

**Does not own:** pricing, lifecycle transitions, event sourcing for lifecycle events.

---

## Observability

`observability.ts` is shared across all three modules.

### Inject a metrics backend

```ts
import { setMetricsRecorder } from './subscriptions/observability';
import { PrometheusMetricsRecorder } from './monitoring/prometheusMetricsExporter';

// Call once at process start, before any service is used
setMetricsRecorder(new PrometheusMetricsRecorder());
```

If `setMetricsRecorder` is never called, all metric calls are no-ops and
nothing breaks. This makes the module safe to use in test environments without
any setup.

### Available metric names

| Constant | What it tracks |
|----------|---------------|
| `MetricName.PRICING_PRORATION` | Each proration calculation |
| `MetricName.LIFECYCLE_CANCEL` | Each cancellation (labelled by `mode`) |
| `MetricName.LIFECYCLE_PAUSE` / `RESUME` | Pause/resume operations |
| `MetricName.LIFECYCLE_TRIAL_START/CONVERT/EXPIRE` | Trial funnel |
| `MetricName.LIFECYCLE_SLA_BREACH` / `RESOLVED` | SLA violation lifecycle (labelled by `tier`, `metricKind`) |
| `MetricName.SYNC_REQUEST` | Every sync round-trip (labelled by `status: ok\|error`) |
| `MetricName.SYNC_CONFLICTS` | CRDT conflicts detected per request |
| `MetricName.SYNC_ERROR` | Sync request failures |

### Tracing arbitrary operations

```ts
import { withSpan } from './subscriptions/observability';

const { result } = await withSpan('billing.renewal.preflight', async () =>
  renewalService.evaluate(candidate),
  { subscriptionId: candidate.subscriptionId },
);
```

`withSpan` always records timing and increments the `ok` / `error` counter
regardless of whether a tracing backend is wired.

---

## Import guide

Prefer importing from the module that owns the concept:

```ts
// ✅ Narrow imports — preferred
import { prorationService }    from '…/subscriptions/pricing';
import { cancellationService } from '…/subscriptions/lifecycle';
import { syncEngineService }   from '…/subscriptions/sync';

// ✅ Namespaced — useful when you need several things from one module
import { pricing, lifecycle }  from '…/subscriptions';
const result = pricing.prorationService.calculate(input);

// ✅ Flat re-exports from the barrel — for the most-used singletons
import { prorationService, cancellationService } from '…/subscriptions';
```

---

## Running the tests

```bash
# All three modules
npx jest --config jest.backend.config.js \
  --testPathPattern="src/services/subscriptions"

# Single module
npx jest --config jest.backend.config.js \
  --testPathPattern="src/services/subscriptions/pricing"
```

---

## Migration notes

The existing code in `backend/services/subscription/`, `backend/subscription/`,
and `backend/sync/` is **not removed** by this change. The new modules re-export
or wrap the existing implementations so both import paths work during
transition. Once all consumers have been updated to import from
`backend/src/services/subscriptions/`, the old entry points can be deprecated
and removed in a follow-up.
