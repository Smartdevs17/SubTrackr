/**
 * Zustand store for subscription metrics forecasting (#1232).
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import type {
  ForecastAccuracy,
  ForecastGranularity,
  ForecastHorizon,
  ForecastModel,
  ForecastOptions,
  ForecastResult,
  RevenueDataPoint,
} from '../types/forecasting';
import {
  buildRevenueDataPoints,
  calculateAccuracy,
  generateRevenueForecast,
  selectBestModel,
} from '../services/forecastingService';
import type { Subscription } from '../types/subscription';

const STORAGE_KEY = 'subtrackr-forecasting';

// ── State shape ────────────────────────────────────────────────────────────

interface ForecastingState {
  /** Last generated forecast result */
  currentForecast: ForecastResult | null;
  /** Historical data points derived from subscriptions */
  historicalData: RevenueDataPoint[];
  /** Accuracy report (populated when actuals are available for back-testing) */
  accuracy: ForecastAccuracy | null;

  // ── UI state ──────────────────────────────────────────────────────────────
  selectedModel: ForecastModel;
  selectedHorizon: ForecastHorizon;
  selectedGranularity: ForecastGranularity;
  confidence: number;

  isLoading: boolean;
  error: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Derive historical data from the active subscription list and generate
   * a new forecast with the current settings.
   */
  generateForecast: (subscriptions: Subscription[], options?: ForecastOptions) => void;

  /**
   * Re-run forecast with updated model/horizon/confidence without touching
   * the cached historical data.
   */
  refreshForecast: (options?: ForecastOptions) => void;

  /**
   * Automatically pick the best model for the current historical dataset.
   */
  autoSelectModel: () => void;

  /**
   * Update model selection (re-runs forecast).
   */
  setModel: (model: ForecastModel) => void;

  /**
   * Update horizon (re-runs forecast).
   */
  setHorizon: (horizon: ForecastHorizon) => void;

  /**
   * Update granularity (re-runs forecast).
   */
  setGranularity: (granularity: ForecastGranularity) => void;

  /**
   * Compute accuracy by back-testing the current model against the last N
   * periods of historical data (hold-out set).
   */
  computeAccuracy: (holdoutPeriods?: number) => void;

  /**
   * Clear current forecast and accuracy results.
   */
  reset: () => void;

  clearError: () => void;
}

// ── Default values ─────────────────────────────────────────────────────────

const defaults = {
  currentForecast: null,
  historicalData: [],
  accuracy: null,
  selectedModel: 'linear' as ForecastModel,
  selectedHorizon: 6 as ForecastHorizon,
  selectedGranularity: 'month' as ForecastGranularity,
  confidence: 0.95,
  isLoading: false,
  error: null,
};

// ── Store ──────────────────────────────────────────────────────────────────

export const useForecastingStore = create<ForecastingState>()(
  persist(
    (set, get) => ({
      ...defaults,

      generateForecast: (subscriptions, options) => {
        set({ isLoading: true, error: null });
        try {
          const historicalData = buildRevenueDataPoints(subscriptions);
          const {
            selectedModel,
            selectedHorizon,
            selectedGranularity,
            confidence,
          } = get();

          const mergedOptions: ForecastOptions = {
            model: selectedModel,
            horizon: selectedHorizon,
            granularity: selectedGranularity,
            confidence,
            ...options,
          };

          const currentForecast = generateRevenueForecast(historicalData, mergedOptions);
          set({ historicalData, currentForecast, isLoading: false });
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to generate forecast.',
          });
        }
      },

      refreshForecast: (options) => {
        set({ isLoading: true, error: null });
        try {
          const {
            historicalData,
            selectedModel,
            selectedHorizon,
            selectedGranularity,
            confidence,
          } = get();

          const mergedOptions: ForecastOptions = {
            model: selectedModel,
            horizon: selectedHorizon,
            granularity: selectedGranularity,
            confidence,
            ...options,
          };

          const currentForecast = generateRevenueForecast(historicalData, mergedOptions);
          set({ currentForecast, isLoading: false });
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to refresh forecast.',
          });
        }
      },

      autoSelectModel: () => {
        const { historicalData } = get();
        const best = selectBestModel(historicalData);
        set({ selectedModel: best });
        get().refreshForecast({ model: best });
      },

      setModel: (model) => {
        set({ selectedModel: model });
        get().refreshForecast({ model });
      },

      setHorizon: (horizon) => {
        set({ selectedHorizon: horizon });
        get().refreshForecast({ horizon });
      },

      setGranularity: (granularity) => {
        set({ selectedGranularity: granularity });
        get().refreshForecast({ granularity });
      },

      computeAccuracy: (holdoutPeriods = 3) => {
        const { historicalData, selectedModel, selectedHorizon, selectedGranularity, confidence } =
          get();

        if (historicalData.length < holdoutPeriods + 2) {
          set({ error: 'Not enough historical data to compute accuracy.' });
          return;
        }

        try {
          const training = historicalData.slice(0, -holdoutPeriods);
          const holdout = historicalData.slice(-holdoutPeriods);
          const result = generateRevenueForecast(training, {
            model: selectedModel,
            horizon: holdoutPeriods as ForecastHorizon,
            granularity: selectedGranularity,
            confidence,
          });
          const accuracy = calculateAccuracy(result.forecasts, holdout);
          set({ accuracy });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Failed to compute accuracy.',
          });
        }
      },

      reset: () => set({ ...defaults }),

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        historicalData: state.historicalData,
        currentForecast: state.currentForecast,
        selectedModel: state.selectedModel,
        selectedHorizon: state.selectedHorizon,
        selectedGranularity: state.selectedGranularity,
        confidence: state.confidence,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[forecastingStore] Hydration error – resetting to defaults:', error);
          useForecastingStore.setState({ ...defaults });
        }
      },
    }
  )
);
