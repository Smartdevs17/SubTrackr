/**
 * Combined Zustand Store
 *
 * Merges all domain slices into a single store using Zustand's slices pattern.
 * Uses persist middleware for client-side persistence with AsyncStorage.
 *
 * ## Migration from individual stores
 *
 * Previously each domain had its own Zustand store with separate persistence
 * (e.g., `useSubscriptionStore`, `useInvoiceStore`). These have been combined
 * into a single `useStore` hook. Backward-compatible named exports are
 * provided in `index.ts` via the `createSelectorHook` helper.
 *
 * ## Usage
 *
 * ```tsx
 * import { useStore } from '../store/combinedStore';
 *
 * // Select only what you need (recommended for performance)
 * const subscriptions = useStore((state) => state.subscriptions);
 * const { addSubscription } = useStore((state) => state);
 *
 * // Get state outside of React
 * const { subscriptions } = useStore.getState();
 * ```
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createBillingSlice } from './slices/billingSlice';
import { createWalletSlice } from './slices/walletSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createEngagementSlice } from './slices/engagementSlice';
import { createRiskSlice } from './slices/riskSlice';
import { createDevSlice } from './slices/devSlice';
import { createMarketingSlice } from './slices/marketingSlice';
import { createCalendarSlice } from './slices/calendarSlice';
import { createNetworkSlice } from './slices/networkSlice';
import { createSupportSlice } from './slices/supportSlice';
import { createMeteringSlice } from './slices/meteringSlice';
import type { AppState } from './slices/types';

// Storage key for the combined store
const STORAGE_KEY = 'subtrackr-root-store-v2';
const STORE_VERSION = 2;

/**
 * The root combined store, persisted to AsyncStorage.
 *
 * All slices are composed here. Each slice factory receives `set`, `get`,
 * and `api` (the full store API) so that slices can access other slices'
 * state via `get()`.
 *
 * Note: Zustand's persist middleware automatically drops functions via
 * JSON.stringify, so no explicit partialize is needed.
 */
export const useStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createBillingSlice(...a),
      ...createWalletSlice(...a),
      ...createSettingsSlice(...a),
      ...createEngagementSlice(...a),
      ...createRiskSlice(...a),
      ...createDevSlice(...a),
      ...createMarketingSlice(...a),
      ...createCalendarSlice(...a),
      ...createNetworkSlice(...a),
      ...createSupportSlice(...a),
      ...createMeteringSlice(...a),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      // Migration from v1 (old separate stores) to v2 (combined store)
      migrate: (persistedState: any, version: number) => {
        if (version === 0 || version === 1) {
          // Return default state for v2 migration
          return {
            subscriptions: persistedState?.subscriptions ?? [],
            stats: { totalActive: 0, totalMonthlySpend: 0, totalYearlySpend: 0, categoryBreakdown: {} },
            isLoading: false,
            error: null,
            prorationPreview: null,
            creditMemos: {},
            invoices: persistedState?.invoices ?? [],
            // Default everything else
          } as AppState;
        }
        return persistedState as AppState;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Recalculate stats after hydration
          if ((state as any).calculateStats) {
            try { (state as any).calculateStats(); } catch { /* ok */ }
          }
        }
      },
    }
  )
);
