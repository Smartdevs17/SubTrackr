# Zustand State Migration (Slices Pattern)

The app state was previously spread across several independent singleton stores
(`authStore`, `userStore`, `settingsStore`, `networkStore`, `transactionStore`), each
persisting its own key. This made cross-store coordination awkward and state-fetching
scattered.

## The new pattern

A single root store — `useAppStore` — is composed from **domain slices** living in
`src/store/slices/`:

| Slice file             | Domain                                      | Persisted fields |
| ---------------------- | ------------------------------------------- | ---------------- |
| `authSlice.ts`         | Auth token, `isAuthenticated`               | `token`, `userId`, `isAuthenticated` |
| `userSlice.ts`         | User profile, subscription tier, consent    | `user`, `subscriptionTier`, `consent` |
| `settingsSlice.ts`     | Currency, notifications, exchange rates     | `preferredCurrency`, `notificationsEnabled`, `exchangeRates`, `healthScoreWeights` |
| `networkSlice.ts`      | Active network, provider health             | `currentNetwork` |
| `transactionSlice.ts`  | Recent transaction history                  | `transactions` |
| `searchSlice.ts`       | Advanced search query, filters, saved searches | `savedSearches` |
| `creditSlice.ts`       | Credit lots, prepayment wallets, applications | `accounts`, `nextId`, `wallets`, `nextWalletId`, `walletTransactionIds` |
| `meteringSlice.ts`     | Per-subscription usage meters, charge lines, alerts | _(none — ephemeral)_ |
| `paymentSlice.ts`      | Payment methods, fallback chains, expiry alerts | `methods`, `attemptLog`, `chains` |
| `batchSlice.ts`        | Batch operations draft, results, history    | `history`, `configs` |
| `analyticsSlice.ts`    | Subscription analytics, cohort, churn, LTV  | _(none — ephemeral)_ |
| `billingSlice.ts`      | Merchant billing schedules, calendar invoices, pro-rata | `billingSchedules`, `billingInvoices` |
| `calendarSlice.ts`     | Calendar provider OAuth, synced events, one-time payments | `calendarIntegrations`, `calendarSyncedEvents`, `calendarReminderOffsets`, `calendarOneTimePayments`, `calendarTimezone` |

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
      ...createSearchSlice(set, get),
      ...createCreditSlice(set, get),
      ...createMeteringSlice(set, get),
      ...createPaymentSlice(set, get),
      ...createBatchSlice(set, get),
      ...createAnalyticsSlice(set, get),
      ...createBillingSlice(set, get),
      ...createCalendarSlice(set, get),
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

The legacy standalone stores now **alias** `useAppStore` and re-export the same hooks
and selectors they always did. Existing consumers continue to work unchanged:

| Legacy hook | Backed by |
| ----------- | --------- |
| `useAuthStore` | `useAppStore` (authSlice) |
| `useUserStore` | `useAppStore` (userSlice) |
| `useSettingsStore` | `useAppStore` (settingsSlice) |
| `useNetworkStore` | `useAppStore` (networkSlice) |
| `useTransactionStore` | `useAppStore` (transactionSlice) |
| `useSearchStore` | `useAppStore` (searchSlice) |
| `useCreditStore` | `useAppStore` (creditSlice) |
| `useMeteringStore` | `useAppStore` (meteringSlice) |
| `usePaymentStore` | `useAppStore` (paymentSlice) |
| `useBatchStore` | `useAppStore` (batchSlice) |
| `useAnalyticsStore` | `useAppStore` (analyticsSlice) |
| `useBillingStore` | `useAppStore` (billingSlice) — issue #2045 |
| `useCalendarStore` | `useAppStore` (calendarSlice) — issue #2045 |

## Naming conventions for billingSlice and calendarSlice

To avoid collisions with other slices on the combined store, billing and calendar state
fields and actions are prefixed:

**billingSlice** — state fields: `billingSchedules`, `billingInvoices`, `billingIsLoading`,
`billingError`. Actions: `setMerchantCalendarBilling`, `removeMerchantCalendarBilling`,
`getNextBillingDate`, `advanceBillingSchedule`, `generateBillingInvoice`,
`updateBillingInvoiceStatus`, `getInvoicesForSubscription`, `getInvoicesForMerchant`,
`calculateProRata`, `clearBillingError`.

**calendarSlice** — state fields: `calendarIntegrations`, `calendarSyncedEvents`,
`calendarReminderOffsets`, `calendarPendingAuthorizations`, `calendarIsLoading`,
`calendarError`, `calendarOneTimePayments`, `calendarScheduleConflicts`,
`calendarTimezone`. Actions mirror the same prefix pattern.

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
4. Add any persisted fields to `partialize` in `index.ts`.
5. Add barrel exports to `slices/index.ts`.
6. Add a thin adapter in `app/stores/<name>Store.ts` and re-export from `src/store/index.ts`.
7. Add tests under `src/store/__tests__/<name>Slice.test.ts` (see `billingSlice.test.ts`
   and `calendarSlice.test.ts` for reference).

## Atomic updates and fine-grained selectors

Multi-field actions must call `set` once with the complete patch instead of issuing
one `set` per field. In React components, use `useAtomicState` from
`src/hooks/useAtomicState.ts` when related fields are local to a hook; it commits a
whole patch in one render and preserves referential equality for no-op changes.

When reading a store, select only the fields the component uses. Object-returning
selectors must be wrapped in `useShallow` from `zustand/react/shallow`, otherwise a
fresh object is produced on every store notification and the component re-renders.
See `docs/ATOMIC_STATE_UPDATES.md` for examples and test guidance.
