# Cache Service

`backend/services/shared/cache.ts`

## Overview

`CacheService` is a generic, typed Redis cache layer built on top of the existing `RedisCacheService` primitive. It adds event-driven invalidation, typed deserialization, cache warming with concurrency control, and a cache-bypass mode for forcing fresh reads.

## Architecture

```
Request
  │
  ▼
CacheService.getOrLoad(key, loader)
  │
  ├─ Redis hit  → deserialize → return
  │
  ├─ Redis miss → single-flight loader → serialize → Redis SET → return
  │
  └─ Redis down → degraded mode → loader() directly (no throw)
```

## Basic Usage

```typescript
import { CacheService } from '../services/shared/cache';

// Inject via IoC
const cache = container.resolve<ICacheService>('ICacheService');

// Cache-aside with type safety
const plan = await cache.getOrLoad<PlanMetadata>(
  `plan:${planId}`,
  () => repository.findById(planId),
  { ttlSeconds: 3600 },
);

// Force-refresh (bypass cache, rehydrate)
const fresh = await cache.getOrLoad<PlanMetadata>(
  `plan:${planId}`,
  () => repository.findById(planId),
  { bypassCache: true },
);

// Explicit write
await cache.set('config:feature-flags', flags, 600);

// Invalidate
await cache.invalidate('plan:abc', 'plan:xyz');
await cache.invalidatePattern('plan:'); // removes all plan:* keys
```

## TTL Strategy

| Data type | Suggested TTL |
|---|---|
| Plan metadata | 3600 s (1 hour) |
| Subscription record | 300 s (5 min) |
| User list | 120 s (2 min) |
| Analytics aggregates | 900 s (15 min) |
| Feature flags | 600 s (10 min) |

Override per call via `{ ttlSeconds: N }`, or set a service-wide default in `CacheServiceConfig.defaultTtlSeconds`.

## Event-Driven Invalidation

Wire cache invalidation to domain events so stale entries are evicted automatically when state changes:

```typescript
import { wireInvalidation } from '../services/shared/cache';
import { eventBus } from '../services/shared/events';

wireInvalidation(cache, eventBus, [
  {
    eventName: 'subscription.cancelled',
    keysFromEvent: (e) => [
      `sub:${e.payload.subscriptionId}`,
      `user-subs:${e.payload.userId}`,
    ],
  },
  {
    eventName: 'subscription.upgraded',
    keysFromEvent: (e) => [`plan:${e.payload.fromPlanId}`, `plan:${e.payload.toPlanId}`],
  },
  {
    eventName: '*', // catch-all for broad invalidation
    keysFromEvent: (e) => e.aggregateId ? [`agg:${e.aggregateId}`] : [],
  },
]);
```

## Cache Warming on Startup

```typescript
const plans = await repository.findAllActive();

const { warmed, errors } = await cache.warm(
  plans.map((p) => ({ key: `plan:${p.id}`, value: p, ttlSeconds: 3600 })),
);
logger.info('Cache warm complete', { warmed, errors });
```

Warming respects `CacheServiceConfig.warmConcurrency` (default 10) to avoid Redis overload on startup.

## Graceful Degradation

When Redis is unreachable, `CacheService` enters degraded mode:
- `getOrLoad` calls `loader()` directly — the app continues serving from the database
- `set` and `invalidate` are no-ops — no throws, no crashes
- `isHealthy()` probe resets `degraded = false` once Redis recovers

Check status:
```typescript
cache.isDegraded(); // true when Redis is down
await cache.isHealthy(); // pings Redis, resets degraded flag on success
```

## Cache Hit Rate Metrics

```typescript
const metrics = cache.getMetrics();
/*
{
  hits, misses, writes, invalidations, errors, degradations,
  hitRatio,           // NaN when no reads yet
  latencyMs: { p50, p95, p99 },
  memoryUsageBytes
}
*/
```

Prometheus export:
```typescript
const text = cache.prometheusMetrics('subtrackr_subscription_cache');
// Exposes: hits_total, misses_total, hit_ratio, writes_total, latency_ms, memory_usage_bytes ...
```

## NullCacheService

Use `NullCacheService` in tests or when Redis is not available. All reads pass through to the loader; writes and invalidations are no-ops.

```typescript
import { NullCacheService } from '../services/shared/cache';
const cache = new NullCacheService();
```

## IoC Container Token

| Token | Resolved type |
|---|---|
| `ICacheService` | `CacheService` (or `NullCacheService` in no-Redis environments) |

```typescript
const cache = container.resolve<ICacheService>('ICacheService');
```

## Performance Benchmarks

Expected baseline with Redis on localhost:

| Operation | p50 | p99 |
|---|---|---|
| Cache hit (GET) | < 1 ms | < 5 ms |
| Cache miss + load | loader latency + ~1 ms | loader p99 + ~5 ms |
| Invalidation | < 2 ms | < 8 ms |
| Warm (1000 keys, concurrency 10) | ~200 ms total | — |

