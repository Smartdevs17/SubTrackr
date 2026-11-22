/**
 * Subscription Proration Store (Zustand)
 *
 * Manages proration calculation history, current preview, configuration,
 * and analytics. Integrates with persistence adapter.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import type {
  ProrationConfig,
  ProrationCalculationRequest,
  ProrationCalculationResult,
  ProrationAnalyticsSummary,
  ProrationRecord,
} from '../types/prorationCalculator';
import { DEFAULT_PRORATION_CONFIG } from '../types/prorationCalculator';
import {
  calculateProration,
  buildProrationAnalytics,
} from '../services/prorationCalculatorService';

const STORAGE_KEY = 'subtrackr-proration-calculator';

interface ProrationStoreState {
  /** Active proration configuration */
  config: ProrationConfig;
  /** Active proration calculation preview */
  activePreview: ProrationCalculationResult | null;
  /** History of calculated prorations */
  records: ProrationRecord[];
  /** Loading indicator */
  isLoading: boolean;
  /** Error message */
  error: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Update proration configuration */
  updateConfig: (config: Partial<ProrationConfig>) => void;

  /** Calculate proration preview */
  calculate: (request: ProrationCalculationRequest) => ProrationCalculationResult;

  /** Save calculation to history */
  applyProration: (subscriptionId: string, calculation: ProrationCalculationResult) => void;

  /** Clear active preview */
  clearPreview: () => void;

  /** Get aggregated proration analytics */
  getAnalytics: () => ProrationAnalyticsSummary;

  /** Clear history */
  clearHistory: () => void;
}

export const useProrationStore = create<ProrationStoreState>()(
  persist(
    (set, get) => ({
      config: DEFAULT_PRORATION_CONFIG,
      activePreview: null,
      records: [],
      isLoading: false,
      error: null,

      updateConfig: (newConfig) => {
        set((state) => ({
          config: { ...state.config, ...newConfig },
        }));
      },

      calculate: (request) => {
        set({ isLoading: true, error: null });
        try {
          const currentConfig = get().config;
          const mergedRequest: ProrationCalculationRequest = {
            ...request,
            config: { ...currentConfig, ...request.config },
          };
          const result = calculateProration(mergedRequest);
          set({ activePreview: result, isLoading: false });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Proration calculation failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      applyProration: (subscriptionId, calculation) => {
        const record: ProrationRecord = {
          id: `proration-record-${Date.now().toString(36)}`,
          subscriptionId,
          result: calculation,
          status: 'applied',
          appliedAt: Date.now(),
          createdAt: Date.now(),
        };

        set((state) => ({
          records: [record, ...state.records],
          activePreview: null,
        }));
      },

      clearPreview: () => {
        set({ activePreview: null });
      },

      getAnalytics: () => {
        return buildProrationAnalytics(get().records);
      },

      clearHistory: () => {
        set({ records: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      version: 1,
      partialize: (state) => ({
        config: state.config,
        records: state.records,
      }),
    }
  )
);
