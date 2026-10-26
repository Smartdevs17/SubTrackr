# Zustand State Migration (Slices Pattern)

The app state was previously spread across several independent singleton stores
(`authStore`, `userStore`, `settingsStore`, `networkStore`, `transactionStore`), each
persisting its own key. This made cross-store coordination awkward and state-fetching
scattered.

## The new pattern

A single root store — `useAppStore` — is composed from **domain slices** living in
`src/store/slices/`:

| Slice file             | Domain                                     |
| ---------------------- | ------------------------------------------ |
| `authSlice.ts`         | Auth token, `isAuthenticated`              |
| `userSlice.ts`         | User profile, subscription tier, consent   |
| `settingsSlice.ts`     | Currency, notifications, exchange rates    |
| `networkSlice.ts`      | Active network, provider, health weights   |
| `transactionSlice.ts`  | Recent transactions                        |

Each slice is defined independently as a `SliceCreator<AppState>` (see
`src/store/slices/state.ts` for `AppState` and the `SliceCreator<T>` helper) and is
composed in `src/store/slices/index.ts`:

```ts
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...createAuthSlice(set, get),
      ...createUserSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createNetworkSlice(set, get),
      ...createTransactionSlice(set, get),
    }),
    { name: 'subtrackr-app-store', version: 1, storage, partialize }
  )
);
```

## Consuming state

Get whole slices or individual fields with a selector:

```ts
const token = useAppStore(selectAuthToken);
const { user } = useAppStore();
```

Prefer the exported cross-slice selectors (`selectAuthToken`, `selectUser`, …) for
fine-grained subscriptions that avoid re-renders on unrelated state changes.

## Backwards compatibility

The legacy stores (`src/store/authStore.ts`, `userStore.ts`, `settingsStore.ts`,
`networkStore.ts`, `transactionStore.ts`) now **alias** `useAppStore` and re-export the
same hooks/selectors they always did. Existing consumers that call `.getState()` /
`.setState()` or destructure a store hook continue to work unchanged — no consumer edits
are required.

## Persistence

The combined store persists a single JSON blob under the key `subtrackr-app-store`
(version 1). `partialize` whitelists the persisted fields so ephemeral state such as
`isLoading`/`error` is excluded — matching the behavior of the original singleton stores.
See the migration note in the issue for why the single-key change is acceptable.

## Adding a new slice

1. Create `src/store/slices/<name>Slice.ts` exporting `create<Name>Slice(set, get)`
   and a `<Name>Slice` interface.
2. Add its state fields to `AppState` in `state.ts`.
3. Spread it into the store in `src/store/slices/index.ts`.
4. (Optional) add it to `partialize` if it should persist.
5. Add tests under `src/store/__tests__/` (see `slices.test.ts` for reference).
