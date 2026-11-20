/**
 * mobile/src/screens/upgrade/hooks.ts
 *
 * Custom hook governing plan selection, billing cycle toggling, and upgrade state.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  calculateProrationQuote,
  DEFAULT_FEATURES,
  DEFAULT_PLANS,
  diffPlanFeatures,
  isUpgradeAllowed,
} from './selectors';
import type {
  BillingCycle,
  PlanTier,
  UpgradeMetrics,
  UpgradeStep,
} from './types';

export interface UseUpgradeFlowOptions {
  currentTier?: PlanTier;
  initialBillingCycle?: BillingCycle;
  daysRemaining?: number;
  totalDays?: number;
  onCompleteUpgrade?: (targetTier: PlanTier, cycle: BillingCycle) => Promise<void>;
  metrics?: UpgradeMetrics;
}

export function useUpgradeFlow({
  currentTier = 'starter',
  initialBillingCycle = 'annual',
  daysRemaining = 15,
  totalDays = 30,
  onCompleteUpgrade,
  metrics,
}: UseUpgradeFlowOptions = {}) {
  // Default target is Pro if on Starter, Enterprise if on Pro
  const defaultTarget: PlanTier = currentTier === 'starter' ? 'pro' : 'enterprise';

  const [selectedTier, setSelectedTier] = useState<PlanTier>(defaultTarget);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initialBillingCycle);
  const [step, setStep] = useState<UpgradeStep>('select');
  const [error, setError] = useState<string | null>(null);

  const prorationQuote = useMemo(() => {
    return calculateProrationQuote(
      currentTier,
      selectedTier,
      billingCycle,
      daysRemaining,
      totalDays
    );
  }, [currentTier, selectedTier, billingCycle, daysRemaining, totalDays]);

  const featureDiff = useMemo(() => {
    return diffPlanFeatures(currentTier, selectedTier, DEFAULT_FEATURES);
  }, [currentTier, selectedTier]);

  const handleSelectTier = useCallback(
    (tier: PlanTier) => {
      if (!isUpgradeAllowed(currentTier, tier)) return;
      setSelectedTier(tier);
      setError(null);
      if (metrics?.onSelectTier) metrics.onSelectTier(tier);
    },
    [currentTier, metrics]
  );

  const handleToggleCycle = useCallback(
    (cycle: BillingCycle) => {
      setBillingCycle(cycle);
      if (metrics?.onToggleCycle) metrics.onToggleCycle(cycle);
    },
    [metrics]
  );

  const handleProceed = useCallback(async () => {
    if (step === 'select') {
      setStep('confirm');
      return;
    }

    if (step === 'confirm') {
      setStep('processing');
      setError(null);
      if (metrics?.onUpgradeStart) {
        metrics.onUpgradeStart(selectedTier, prorationQuote.dueToday);
      }

      try {
        if (onCompleteUpgrade) {
          await onCompleteUpgrade(selectedTier, billingCycle);
        }
        setStep('success');
        if (metrics?.onUpgradeSuccess) {
          metrics.onUpgradeSuccess(selectedTier);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upgrade could not be completed';
        setError(msg);
        setStep('error');
        if (metrics?.onUpgradeFailure) {
          metrics.onUpgradeFailure(msg);
        }
      }
    }
  }, [step, selectedTier, billingCycle, prorationQuote.dueToday, onCompleteUpgrade, metrics]);

  const handleBackToSelect = useCallback(() => {
    setStep('select');
    setError(null);
  }, []);

  return {
    currentTier,
    selectedTier,
    billingCycle,
    step,
    error,
    prorationQuote,
    unlockedFeatures: featureDiff.unlocked,
    plans: DEFAULT_PLANS,
    handleSelectTier,
    handleToggleCycle,
    handleProceed,
    handleBackToSelect,
  };
}
