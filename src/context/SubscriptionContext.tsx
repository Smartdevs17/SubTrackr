/**
 * Subscription Context Provider
 *
 * Wraps the Zustand subscription store in a React Context + Hooks pattern,
 * reducing prop drilling and improving TypeScript inference.
 *
 * This provides:
 * - A context provider for global subscription state
 * - Custom hooks for type-safe state access
 * - Performance-optimized selectors to minimize re-renders
 */

import React, { createContext, useContext, useMemo, useCallback, type ReactNode } from 'react';
import { useSubscriptionStore, type SubscriptionState } from '../store/subscriptionStore';
import {
  Subscription,
  SubscriptionFormData,
  SubscriptionStats,
  SubscriptionCategory,
  BillingCycle,
} from '../types/subscription';
import { AppError } from '../services/errorHandler';

// ── Context Types ─────────────────────────────────────────────────────────────

interface SubscriptionContextValue {
  // State
  subscriptions: Subscription[];
  stats: SubscriptionStats;
  isLoading: boolean;
  error: AppError | null;

  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;

  // Derived selectors
  getActiveSubscriptions: () => Subscription[];
  getSubscriptionsByCategory: (category: SubscriptionCategory) => Subscription[];
  getSubscriptionById: (id: string) => Subscription | undefined;
  getMonthlySpend: () => number;
  getYearlySpend: () => number;
}

// ── Context Creation ──────────────────────────────────────────────────────────

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

// ── Provider Component ────────────────────────────────────────────────────────

interface SubscriptionProviderProps {
  children: ReactNode;
}

export function SubscriptionProvider({ children }: SubscriptionProviderProps) {
  // Select individual slices to minimize re-renders
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);
  const stats = useSubscriptionStore((s) => s.stats);
  const isLoading = useSubscriptionStore((s) => s.isLoading);
  const error = useSubscriptionStore((s) => s.error);

  // Get action selectors (these don't change between renders)
  const addSubscription = useSubscriptionStore((s) => s.addSubscription);
  const updateSubscription = useSubscriptionStore((s) => s.updateSubscription);
  const deleteSubscription = useSubscriptionStore((s) => s.deleteSubscription);
  const toggleSubscriptionStatus = useSubscriptionStore((s) => s.toggleSubscriptionStatus);
  const recordBillingOutcome = useSubscriptionStore((s) => s.recordBillingOutcome);
  const fetchSubscriptions = useSubscriptionStore((s) => s.fetchSubscriptions);
  const calculateStats = useSubscriptionStore((s) => s.calculateStats);

  // Derived selectors - memoized to prevent unnecessary re-renders
  const getActiveSubscriptions = useCallback(
    () => subscriptions.filter((s) => s.isActive),
    [subscriptions]
  );

  const getSubscriptionsByCategory = useCallback(
    (category: SubscriptionCategory) =>
      subscriptions.filter((s) => s.category === category),
    [subscriptions]
  );

  const getSubscriptionById = useCallback(
    (id: string) => subscriptions.find((s) => s.id === id),
    [subscriptions]
  );

  const getMonthlySpend = useCallback(() => stats.totalMonthlySpend, [stats]);
  const getYearlySpend = useCallback(() => stats.totalYearlySpend, [stats]);

  // Memoize the entire context value to prevent unnecessary re-renders
  const value: SubscriptionContextValue = useMemo(
    () => ({
      subscriptions,
      stats,
      isLoading,
      error,
      addSubscription,
      updateSubscription,
      deleteSubscription,
      toggleSubscriptionStatus,
      recordBillingOutcome,
      fetchSubscriptions,
      calculateStats,
      getActiveSubscriptions,
      getSubscriptionsByCategory,
      getSubscriptionById,
      getMonthlySpend,
      getYearlySpend,
    }),
    [
      subscriptions,
      stats,
      isLoading,
      error,
      addSubscription,
      updateSubscription,
      deleteSubscription,
      toggleSubscriptionStatus,
      recordBillingOutcome,
      fetchSubscriptions,
      calculateStats,
      getActiveSubscriptions,
      getSubscriptionsByCategory,
      getSubscriptionById,
      getMonthlySpend,
      getYearlySpend,
    ]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// ── Custom Hooks ──────────────────────────────────────────────────────────────

/**
 * Hook to access the full subscription context.
 * Must be used within a SubscriptionProvider.
 */
export function useSubscriptionContext(): SubscriptionContextValue {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscriptionContext must be used within a SubscriptionProvider');
  }
  return context;
}

/**
 * Hook to access only subscription list with optional filtering.
 * Performance-optimized with shallow comparison.
 */
export function useSubscriptions(filter?: {
  active?: boolean;
  category?: SubscriptionCategory;
  billingCycle?: BillingCycle;
}): Subscription[] {
  const subscriptions = useSubscriptionStore((s) => s.subscriptions);

  return useMemo(() => {
    let result = subscriptions;
    if (filter?.active !== undefined) {
      result = result.filter((s) => s.isActive === filter.active);
    }
    if (filter?.category) {
      result = result.filter((s) => s.category === filter.category);
    }
    if (filter?.billingCycle) {
      result = result.filter((s) => s.billingCycle === filter.billingCycle);
    }
    return result;
  }, [subscriptions, filter?.active, filter?.category, filter?.billingCycle]);
}

/**
 * Hook to access subscription statistics.
 */
export function useSubscriptionStats(): SubscriptionStats {
  return useSubscriptionStore((s) => s.stats);
}

/**
 * Hook to access subscription loading and error state.
 */
export function useSubscriptionStatus(): { isLoading: boolean; error: AppError | null } {
  const isLoading = useSubscriptionStore((s) => s.isLoading);
  const error = useSubscriptionStore((s) => s.error);
  return useMemo(() => ({ isLoading, error }), [isLoading, error]);
}

/**
 * Hook to access subscription actions only.
 * Useful for components that only need to dispatch actions.
 */
export function useSubscriptionActions() {
  return useSubscriptionStore((s) => ({
    addSubscription: s.addSubscription,
    updateSubscription: s.updateSubscription,
    deleteSubscription: s.deleteSubscription,
    toggleSubscriptionStatus: s.toggleSubscriptionStatus,
    recordBillingOutcome: s.recordBillingOutcome,
    fetchSubscriptions: s.fetchSubscriptions,
    calculateStats: s.calculateStats,
  }));
}

/**
 * Hook to get a single subscription by ID.
 */
export function useSubscription(id: string): Subscription | undefined {
  return useSubscriptionStore((s) => s.subscriptions.find((sub) => sub.id === id));
}
