# Atomic state updates (issue #2204)

React Native screens previously kept each filter/field in its own `useState` call and
updated several of them for one user action. Every setter notified subscribers, so a
single "clear filters" or "save consent" action caused several render passes and
transient half-updated states.

## Primitives

`src/utils/atomicState.ts` contains the framework-independent transition logic:

- `applyAtomicPatch(state, patch)` shallow-merges a partial object (or a function
  returning one) and returns the **original reference** when nothing changed.
- `reduceAtomicState(state, action, initialState)` applies `patch` actions or resets
  to `initialState`.
- `resolveAtomicValue(value, current)` supports both plain values and functional
  setter values, preserving the `React.Dispatch<React.SetStateAction<T>>` API.

`src/hooks/useAtomicState.ts` exposes `useAtomicState<T>(initialState)`, returning
`[state, patch, reset]`. `patch` and `reset` have stable identities and accept
functional updates, so many fields can be committed by one dispatch.

```ts
const [filters, patchFilters, resetFilters] = useAtomicState(DEFAULT_FILTERS);

patchFilters({ searchQuery: '', selectedCategories: [] });
patchFilters((previous) => ({ page: previous.page + 1 }));
resetFilters();
```

## Fine-grained store reads

Hooks that only need part of a Zustand store must not subscribe to the whole store.
`src/hooks/useCachedSubscriptions.ts`, `src/hooks/useProrationCalculator.ts`, and
`useWebSocketActions` in `src/store/websocketStore.ts` now use `useShallow` from
`zustand/react/shallow` so they re-render only when one of the selected fields changes.

## Refactored consumers

- `src/hooks/useSubscriptionFilters.ts`: all eight filter fields live in one atomic
  state; `clearAllFilters` is a single `reset` dispatch. Setter signatures are
  unchanged, including functional updates used by `FilterModal.tsx` and `HomeScreen.tsx`.
- `src/hooks/useConsentManager.ts`: load status, stored consent, draft, saving flag,
  and error are one state object. `reload` and `run` produce one patch per logical
  transition; the public `ConsentManager` shape is unchanged.

## Verification

- `src/utils/__tests__/atomicState.test.ts` covers merges, functional patches, no-op
  referential equality, and reset.
- `src/hooks/__tests__/useAtomicState.test.ts` uses `react-test-renderer` to assert that
  a multi-field patch produces exactly one render and that callbacks are stable.
