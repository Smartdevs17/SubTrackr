/**
 * searchStore.ts — Legacy adapter for the search slice.
 *
 * Search state and actions now live in the slices-pattern root store
 * (src/store/slices/searchSlice.ts, Issue #944) and are exposed through
 * the combined `useAppStore`. This adapter keeps existing consumers
 * (`useSearchStore`) working without any changes.
 */
export { useAppStore as useSearchStore } from '../../src/store/slices';

export type {
  Subscription,
  SubscriptionCategory,
  BillingCycle,
} from '../../src/types/subscription';