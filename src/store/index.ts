/**
 * Store index – exports the combined Zustand store and backward-compatible
 * named hooks for each domain.
 *
 * ## Quick Migration
 *
 * Most existing imports continue to work:
 * ```ts
 * // Old (still works)
 * import { useSubscriptionStore } from '../store';
 * const subscriptions = useSubscriptionStore((s) => s.subscriptions);
 *
 * // New (recommended)
 * import { useStore } from '../store/combinedStore';
 * const subscriptions = useStore((s) => s.subscriptions);
 * ```
 *
 * See docs/store-migration.md for a complete migration guide.
 */

export { useStore } from './combinedStore';
export type { AppState } from './slices/types';

// ── Backward-compatible selector hooks ────────────────────────────────
// These hooks pick specific slices from the combined store so that
// existing consumers don't need to update their imports.

import { useStore } from './combinedStore';
import type { AppState } from './slices/types';

type SliceSelector<T> = (state: AppState) => T;

/**
 * Create a typed hook that selects from the combined store.
 * This enables pattern matching from individual stores:
 *   useSubscriptionStore()        → gets full AppState
 *   useSubscriptionStore(s => s.subscriptions) → gets subscriptions
 */
function createSliceHook() {
  return <T>(selector?: SliceSelector<T>): T => {
    return useStore(selector ?? (() => ({} as any)));
  };
}

// ── Subscription Store ────────────────────────────────────────────────
export const useSubscriptionStore = useStore;
export { useSubscriptionStore as useSubscriptionStoreHook } from './combinedStore';

// ── Named re-exports for backward compatibility ───────────────────────
// These are the original hook names that consumers currently import.
// They all point to the same combined store.

/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useInvoiceStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useTransactionQueueStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useWalletStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useNetworkStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useSettingsStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useCommunityStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useFraudStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useGroupStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useTaxStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useSupportStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useSandboxStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useCampaignStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useSegmentStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useDeveloperPortalStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useUsageStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useGamificationStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useLoyaltyStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useAffiliateStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useSlaStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useCalendarStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useMerchantStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useWebhookStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useAccountingStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useCancellationStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useUserStore = useStore;

// ── App store exports (for the app/ directory) ─────────────────────────
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useMeteringStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useCreditStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useBatchStore = useStore;
/** @deprecated Use `useStore` from `store/combinedStore` instead. */
export const useSearchStore = useStore;
