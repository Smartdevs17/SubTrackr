# Mobile query layer (Issue #2074)

Screen-level data fetching lives here instead of inside screen components.
Screens declare a key and a fetcher; the query client owns caching,
deduplication, retries, invalidation and telemetry. No React Query/SWR
dependency is added.

## Usage

```tsx
import { createSubscriptionQueries, useQuery } from '../queries';
import { subscriptionApi } from './api'; // any SubscriptionQueryApi implementation

function SubscriptionsScreen({ status }: { status: string }) {
  const { data, status: queryStatus, isFetching, refetch } = useQuery({
    key: ['subscriptions', 'list', status],
    fetcher: ({ signal }) => subscriptionApi.listSubscriptions({ status }, signal),
    tags: ['subscriptions'],
    ttlMs: 60_000,
  });

  // render data, queryStatus ('idle' | 'loading' | 'success' | 'error') and progress
}
```

For typed subscription endpoints, `createSubscriptionQueries(api, client)`
provides `list()`, `detail()`, `counts()` and scoped invalidation.
`createHttpSubscriptionApi({ baseUrl })` is the HTTP adapter; screens never
call `fetch()` directly.

## Behaviour

- **Keys:** primitive arrays; order is significant. `subscriptionKeys.*`
  factories keep call sites consistent.
- **Fresh cache hits:** no network call. `QueryResult.fromCache` is `true`.
- **Stale-while-revalidate:** stale data is returned immediately with
  `isFetching: true`; a single deduplicated background refresh updates
  subscribers when it lands.
- **Deduplication:** concurrent requests for one key share one fetch.
- **Retries:** transport/5xx/408/429 errors retry up to twice with exponential
  backoff (250 ms base). 4xx errors other than 408/429 are not retried. Every
  attempt receives an `AbortSignal` and times out after 10 s by default.
- **Invalidation:** by exact key, key prefix, or tag. A response that was
  invalidated while in flight is discarded rather than repopulating the cache.
- **Failure:** a failed revalidation keeps stale data in the result with
  `status: 'error'` and `fromCache: true`, so the screen can degrade gracefully.
- **Optimistic writes:** `setQueryData(key, data)` updates the cache and
  notifies subscribers without a network call.

## Observability

Inject a `QueryTelemetry` (`emit(event)`) into `QueryClient` to receive
`cache_hit`, `cache_miss`, `dedupe`, `fetch_start`, `fetch_success`, `retry`,
`fetch_error`, `invalidate`, `evict` and `set_data` events with the key, tags,
attempt count and duration. `createConsoleQueryTelemetry()` emits the same
events as JSON log lines. Failures also go to the optional `logger.warn` hook.

## Tests

```bash
npx jest --config jest.backend.config.js --testMatch '**/mobile/src/queries/__tests__/*.test.ts'
```
