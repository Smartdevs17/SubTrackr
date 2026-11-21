# Virtualised subscriptions screen (Issue #2075)

The subscriptions list is rendered with Shopify **FlashList** instead of a
React Native `FlatList`. FlashList recycles row views and mounts only the
visible window plus a bounded draw distance, which keeps scrolling smooth when
a user has hundreds or thousands of subscriptions.

## Layout

| File | Purpose |
| --- | --- |
| `SubscriptionFlashList.tsx` | Virtualised list: stable keys, bounded window, empty/loading/error states. |
| `SubscriptionListScreen.tsx` | Screen container; reads data through `mobile/src/queries` and emits telemetry. |
| `flashListConfig.ts` | Pure policy for `estimatedItemSize`, `drawDistance`, `windowSize` and clipping. |
| `mapRows.ts` | Maps query records onto the small, memoised `./row` shape. |
| `types.ts` | Public props and metrics hooks. |
| `index.ts` | Public barrel for the screen module. |

## Virtualisation policy

`resolveFlashListTuning(itemCount, overrides)` returns a bounded tuning object.
Short lists use a small window with clipping disabled; medium and long lists
increase the draw distance and enable `removeClippedSubviews`. All overrides are
clamped, and `NaN`/non-finite counts fall back to the short-list defaults, so a
bad metric can never unbound the mounted window.

Rows reuse the memoised `./row` module: `subscriptionRowKey` supplies stable
keys based on `subscription.id`, and `areRowPropsEqual` prevents re-renders when
a fresh array contains identical data. `renderItem` and `keyExtractor` are
created with `useCallback`/`useMemo` so FlashList sees stable identities.

## Data flow

`SubscriptionListScreen` never calls `fetch()` directly. It builds a typed key
with `subscriptionKeys.list(filters)` and calls `useQuery` with a 60s TTL and
the `SUBSCRIPTIONS_TAG` tag. Refreshing invalidates and refetches through the
query layer, so cached screens and this list stay consistent.

## Observability

Pass a `metrics` object to the screen or list to receive user-visible signals:

- `onView` — the screen mounted.
- `onVisibleRows({ count, indices })` — FlashList's viewability callback fires;
  useful for tracking how many rows are actually mounted.
- `onRowRender({ key, renderedAt })` — a row genuinely re-rendered (wired
  through the `./row` hook).
- `onError(error)` — the query failed.
- `onRefresh()` — the user pulled to refresh.

These hooks are optional and have no default side effects, so production builds
can attach logging or analytics without changing rendering behaviour.

## Tests

```bash
npx jest --config jest.backend.config.js \
  --testMatch '**/mobile/src/screens/subscriptions/__tests__/*.test.ts'
```
