# Caching Strategy

SubTrackr uses a multi-layer cache with offline queue support to keep the app fast and functional without a network connection.

## Architecture

```
Read path:   L1 (memory Map) → L2 (AsyncStorage) → store/network
Write path:  L1 + L2 simultaneously (write-through)
Offline:     mutations enqueued → flushed on reconnect
```

### Layers

| Layer | Storage         | Lifetime         | Speed    |
| ----- | --------------- | ---------------- | -------- |
| L1    | In-memory `Map` | Process lifetime | ~0 ms    |
| L2    | `AsyncStorage`  | App restarts     | ~5–20 ms |

L2 entries are promoted to L1 on first read to avoid repeated disk access.

## Files

| File                                                | Purpose                                          |
| --------------------------------------------------- | ------------------------------------------------ |
| `src/services/cache/cacheService.ts`                | Core `CacheService` class + singleton            |
| `src/hooks/useCachedSubscriptions.ts`               | React hook wrapping subscriptionStore with cache |
| `src/services/cache/__tests__/cacheService.test.ts` | Unit tests                                       |

## Usage

### Basic read/write

```ts
import { cacheService } from '../services/cache/cacheService';

// Write (5 min TTL, tagged for bulk invalidation)
await cacheService.set('subscriptions:all', subs, {
  ttl: 5 * 60_000,
  tags: ['subscriptions'],
});

// Read (L1 → L2 → null)
const cached = await cacheService.get<Subscription[]>('subscriptions:all');
```

### In a component

```ts
import { useCachedSubscriptions } from '../hooks/useCachedSubscriptions';

function HomeScreen() {
  const { subscriptions, fetchSubscriptions, prefetchSubscriptions } = useCachedSubscriptions();

  useEffect(() => {
    void fetchSubscriptions();
  }, []);
  // ...
}
```

### Prefetch on navigation

```ts
// In a list item's onPress — prefetch before the screen mounts
onPress={() => {
  void prefetchSubscriptions();
  navigation.navigate('SubscriptionDetail', { id });
}}
```

## Cache Invalidation

### TTL (time-based)

Every entry has a TTL (default 60 s). Expired entries are evicted lazily on next read.

```ts
await cacheService.set(key, value, { ttl: 0 }); // never expires
await cacheService.set(key, value, { ttl: 30_000 }); // 30 s
```

### Tag-based (bulk)

Tag entries at write time; invalidate all at once:

```ts
await cacheService.set('subs:1', sub1, { tags: ['subscriptions'] });
await cacheService.set('subs:2', sub2, { tags: ['subscriptions'] });

// After a mutation:
await cacheService.invalidateByTag('subscriptions');
```

### Manual

```ts
await cacheService.delete('specific-key');
cacheService.clearMemory(); // L1 only
await cacheService.clearAll(); // L1 + L2
```

## Offline Queue

Mutations made while offline are enqueued and replayed when connectivity returns.

```ts
// Enqueue (called automatically by useCachedSubscriptions when offline)
await cacheService.enqueueOfflineOperation('update:sub-1', updatedData, 'update:sub-1');

// Flush on reconnect
NetInfo.addEventListener((state) => {
  if (state.isConnected) void syncOfflineQueue();
});
```

### Conflict Resolution

Two strategies, set at construction:

| Strategy                    | Behaviour                                             |
| --------------------------- | ----------------------------------------------------- |
| `last-write-wins` (default) | Later enqueue for same `conflictKey` replaces earlier |
| `first-write-wins`          | First enqueue wins; subsequent ones are discarded     |

```ts
import { CacheService } from '../services/cache/cacheService';
const svc = new CacheService('first-write-wins');
```

## Metrics

```ts
const { hits, misses, evictions, offlineQueueDepth } = cacheService.getMetrics();
cacheService.resetMetrics(); // zero counters (preserves queue depth)
```

Expose metrics in a debug screen or send to your monitoring service to track cache efficiency.

## Constants

| Constant          | Value                      | Description                      |
| ----------------- | -------------------------- | -------------------------------- |
| Default TTL       | 60 000 ms                  | Applied when `ttl` is omitted    |
| Subscription TTL  | 300 000 ms                 | Used by `useCachedSubscriptions` |
| Storage prefix    | `@subtrackr_cache:`        | AsyncStorage key namespace       |
| Offline queue key | `@subtrackr_offline_queue` | Persisted queue storage key      |
