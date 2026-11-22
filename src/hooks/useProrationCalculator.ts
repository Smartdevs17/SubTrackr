/**
 * useProrationCalculator — React Hook
 *
 * Exposes proration calculation functions, active preview, transparency summary,
 * and analytics for React Native components.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProrationStore } from '../store/prorationStore';
import type {
  ProrationConfig,
  ProrationCalculationRequest,
  ProrationCalculationResult,
  ProrationAnalyticsSummary,
} from '../types/prorationCalculator';

export interface UseProrationCalculatorReturn {
  config: ProrationConfig;
  activePreview: ProrationCalculationResult | null;
  isLoading: boolean;
  error: string | null;

  calculate: (request: ProrationCalculationRequest) => ProrationCalculationResult;
  applyProration: (subscriptionId: string, calculation: ProrationCalculationResult) => void;
  updateConfig: (newConfig: Partial<ProrationConfig>) => void;
  clearPreview: () => void;
  analytics: ProrationAnalyticsSummary;
  clearHistory: () => void;
}

export function useProrationCalculator(): UseProrationCalculatorReturn {
  const {
    config,
    activePreview,
    records,
    isLoading,
    error,
    calculate: calculateInStore,
    applyProration: applyProrationInStore,
    updateConfig: updateConfigInStore,
    clearPreview: clearPreviewInStore,
    clearHistory: clearHistoryInStore,
  } = useProrationStore(
    useShallow((s) => ({
      config: s.config,
      activePreview: s.activePreview,
      records: s.records,
      isLoading: s.isLoading,
      error: s.error,
      calculate: s.calculate,
      applyProration: s.applyProration,
      updateConfig: s.updateConfig,
      clearPreview: s.clearPreview,
      clearHistory: s.clearHistory,
    }))
  );

  const analytics = useMemo(() => useProrationStore.getState().getAnalytics(), [records]);

  const calculate = useCallback(
    (request: ProrationCalculationRequest) => calculateInStore(request),
    [calculateInStore]
  );

  const applyProration = useCallback(
    (subscriptionId: string, calculation: ProrationCalculationResult) => {
      applyProrationInStore(subscriptionId, calculation);
    },
    [applyProrationInStore]
  );

  const updateConfig = useCallback(
    (newConfig: Partial<ProrationConfig>) => {
      updateConfigInStore(newConfig);
    },
    [updateConfigInStore]
  );

  const clearPreview = useCallback(() => {
    clearPreviewInStore();
  }, [clearPreviewInStore]);

  const clearHistory = useCallback(() => {
    clearHistoryInStore();
  }, [clearHistoryInStore]);

  return {
    config,
    activePreview,
    isLoading,
    error,
    calculate,
    applyProration,
    updateConfig,
    clearPreview,
    analytics,
    clearHistory,
  };
}
