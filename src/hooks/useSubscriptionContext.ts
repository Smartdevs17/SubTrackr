/**
 * useSubscriptionContext Hook
 *
 * Custom hook for accessing subscription state via React Context.
 * Provides optimized selectors and derived data with minimal re-renders.
 */

import { useMemo, useCallback } from 'react';
import {
  useSubscriptionContext as useBaseContext,
  useSubscriptions as useBaseSubscriptions,
  useSubscriptionStats as useBaseStats,
  useSubscriptionActions as useBaseActions,
} from '../context/SubscriptionContext';
import { SubscriptionCategory, BillingCycle } from '../types/subscription';

/**
 * Hook to get subscription summary statistics.
 * Returns memoized derived data.
 */
export function useSubscriptionSummary() {
  const { stats, getActiveSubscriptions } = useBaseContext();

  const activeCount = useMemo(() => getActiveSubscriptions().length, [getActiveSubscriptions]);

  return useMemo(
    () => ({
      ...stats,
      activeCount,
      avgMonthlyPerSub: activeCount > 0 ? stats.totalMonthlySpend / activeCount : 0,
      avgYearlyPerSub: activeCount > 0 ? stats.totalYearlySpend / activeCount : 0,
    }),
    [stats, activeCount]
  );
}

/**
 * Hook to manage a specific subscription's operations.
 */
export function useSubscriptionManager(subscriptionId: string) {
  const { updateSubscription, deleteSubscription, toggleSubscriptionStatus, recordBillingOutcome } =
    useBaseContext();

  const update = useCallback(
    (data: Partial<import('../types/subscription').Subscription>) =>
      updateSubscription(subscriptionId, data),
    [subscriptionId, updateSubscription]
  );

  const remove = useCallback(() => deleteSubscription(subscriptionId), [subscriptionId, deleteSubscription]);

  const toggle = useCallback(() => toggleSubscriptionStatus(subscriptionId), [subscriptionId, toggleSubscriptionStatus]);

  const recordOutcome = useCallback(
    (outcome: 'success' | 'failed') => recordBillingOutcome(subscriptionId, outcome),
    [subscriptionId, recordBillingOutcome]
  );

  return useMemo(
    () => ({ update, remove, toggle, recordOutcome }),
    [update, remove, toggle, recordOutcome]
  );
}

/**
 * Hook to get subscriptions grouped by category.
 */
export function useSubscriptionsByCategory(): Record<SubscriptionCategory, import('../types/subscription').Subscription[]> {
  const { subscriptions } = useBaseContext();

  return useMemo(() => {
    const grouped = {} as Record<SubscriptionCategory, import('../types/subscription').Subscription[]>;
    for (const sub of subscriptions) {
      if (!grouped[sub.category]) {
        grouped[sub.category] = [];
      }
      grouped[sub.category].push(sub);
    }
    return grouped;
  }, [subscriptions]);
}

/**
 * Hook to get subscriptions grouped by billing cycle.
 */
export function useSubscriptionsByBillingCycle(): Record<BillingCycle, import('../types/subscription').Subscription[]> {
  const { subscriptions } = useBaseContext();

  return useMemo(() => {
    const grouped = {} as Record<BillingCycle, import('../types/subscription').Subscription[]>;
    for (const sub of subscriptions) {
      if (!grouped[sub.billingCycle]) {
        grouped[sub.billingCycle] = [];
      }
      grouped[sub.billingCycle].push(sub);
    }
    return grouped;
  }, [subscriptions]);
}

/**
 * Hook to search subscriptions by name or description.
 */
export function useSubscriptionSearch(query: string) {
  const { subscriptions } = useBaseContext();

  return useMemo(() => {
    if (!query.trim()) return subscriptions;
    const lower = query.toLowerCase();
    return subscriptions.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.description?.toLowerCase().includes(lower)
    );
  }, [subscriptions, query]);
}

// Re-export base hooks for convenience
export { useBaseSubscriptions as useFilteredSubscriptions };
export { useBaseStats as useSubscriptionStats };
export { useBaseActions as useSubscriptionActions };
