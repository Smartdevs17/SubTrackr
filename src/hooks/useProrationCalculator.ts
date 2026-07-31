/**
 * useProrationCalculator — React Hook
 *
 * Exposes proration calculation functions, active preview, transparency summary,
 * and analytics for React Native components.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/784
 */

import { useCallback, useMemo } from 'react';
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
  const store = useProrationStore();

  const analytics = useMemo(() => store.getAnalytics(), [store.records]);

  const calculate = useCallback(
    (request: ProrationCalculationRequest) => {
      return store.calculate(request);
    },
    [store.calculate]
  );

  const applyProration = useCallback(
    (subscriptionId: string, calculation: ProrationCalculationResult) => {
      store.applyProration(subscriptionId, calculation);
    },
    [store.applyProration]
  );

  const updateConfig = useCallback(
    (newConfig: Partial<ProrationConfig>) => {
      store.updateConfig(newConfig);
    },
    [store.updateConfig]
  );

  const clearPreview = useCallback(() => {
    store.clearPreview();
  }, [store.clearPreview]);

  const clearHistory = useCallback(() => {
    store.clearHistory();
  }, [store.clearHistory]);

  return {
    config: store.config,
    activePreview: store.activePreview,
    isLoading: store.isLoading,
    error: store.error,
    calculate,
    applyProration,
    updateConfig,
    clearPreview,
    analytics,
    clearHistory,
  };
}
