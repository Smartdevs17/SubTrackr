/**
 * useSubscriptionSlaMonitor — React hook for subscription SLA monitoring.
 *
 * Provides a convenient interface to the subscription SLA store,
 * exposing status, breaches, alerts, analytics, and actions for
 * use in React components.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/779
 */

import { useCallback, useMemo } from 'react';
import { useSubscriptionSlaStore } from '../store/subscriptionSlaStore';
import type {
  SubscriptionSlaTier,
  SubscriptionSlaConfig,
  SubscriptionSlaStatus,
  SubscriptionSlaBreach,
  SubscriptionSlaAlert,
  SubscriptionSlaAnalytics,
  SubscriptionSlaDashboard,
  SlaMetricSample,
  SlaMetricKind,
} from '../types/subscriptionSla';

export interface UseSubscriptionSlaMonitorReturn {
  // ── State ───────────────────────────────────────────────────────────────

  /** Whether the store is performing an async operation */
  isLoading: boolean;

  /** Last error message, if any */
  error: string | null;

  /** Get the SLA status for a specific subscription */
  getStatus: (subscriptionId: string) => SubscriptionSlaStatus | null;

  /** All currently active (unresolved) breaches */
  activeBreaches: SubscriptionSlaBreach[];

  /** Count of active breaches */
  activeBreachCount: number;

  /** All unread alerts */
  unreadAlerts: SubscriptionSlaAlert[];

  /** Count of unread alerts */
  unreadAlertCount: number;

  /** SLA dashboard summary */
  dashboard: SubscriptionSlaDashboard;

  // ── Configuration ─────────────────────────────────────────────────────

  /** Set up SLA monitoring for a subscription */
  configureSla: (
    subscriptionId: string,
    tier: SubscriptionSlaTier,
    overrides?: Partial<SubscriptionSlaConfig>
  ) => void;

  /** Remove SLA monitoring for a subscription */
  removeSla: (subscriptionId: string) => void;

  // ── Metric recording ──────────────────────────────────────────────────

  /** Record a single metric sample */
  recordMetric: (
    subscriptionId: string,
    kind: SlaMetricKind,
    value: number
  ) => void;

  /** Record multiple metric samples at once */
  recordMetrics: (
    subscriptionId: string,
    samples: Array<{ kind: SlaMetricKind; value: number }>
  ) => void;

  // ── Breach management ─────────────────────────────────────────────────

  /** Acknowledge a breach (marks as seen, with optional notes) */
  acknowledgeBreach: (breachId: string, notes?: string) => void;

  /** Resolve a breach (marks as resolved with timestamp) */
  resolveBreach: (breachId: string) => void;

  // ── Alert management ──────────────────────────────────────────────────

  /** Mark an alert as read */
  markAlertRead: (alertId: string) => void;

  /** Resolve an alert */
  resolveAlert: (alertId: string) => void;

  // ── Analytics & Reporting ─────────────────────────────────────────────

  /** Get aggregated SLA analytics */
  getAnalytics: (days?: number) => SubscriptionSlaAnalytics;

  /** Get credit balance for a subscription */
  getCreditBalance: (subscriptionId: string) => number;
}

/**
 * Hook to interact with the subscription SLA monitoring system.
 *
 * @example
 * ```tsx
 * const { activeBreaches, dashboard, configureSla, recordMetric } = useSubscriptionSlaMonitor();
 *
 * // Set up SLA for a subscription
 * configureSla('sub-123', 'premium');
 *
 * // Record a metric
 * recordMetric('sub-123', 'uptime', 99.95);
 *
 * // Check breaches
 * console.log(`Active breaches: ${activeBreaches.length}`);
 * ```
 */
export function useSubscriptionSlaMonitor(): UseSubscriptionSlaMonitorReturn {
  const store = useSubscriptionSlaStore();

  const activeBreaches = useMemo(() => store.getActiveBreaches(), [store.breaches]);
  const unreadAlerts = useMemo(() => store.getUnreadAlerts(), [store.alerts]);
  const dashboard = useMemo(() => store.getDashboard(), [store.statuses, store.breaches, store.alerts]);

  const recordMetric = useCallback(
    (subscriptionId: string, kind: SlaMetricKind, value: number) => {
      store.recordMetric(subscriptionId, {
        kind,
        value,
        timestamp: Date.now(),
      });
    },
    [store.recordMetric]
  );

  const recordMetrics = useCallback(
    (subscriptionId: string, samples: Array<{ kind: SlaMetricKind; value: number }>) => {
      const now = Date.now();
      store.recordMetricBatch(
        subscriptionId,
        samples.map((s) => ({ ...s, timestamp: now }))
      );
    },
    [store.recordMetricBatch]
  );

  return {
    isLoading: store.isLoading,
    error: store.error,
    getStatus: store.getStatus,
    activeBreaches,
    activeBreachCount: activeBreaches.length,
    unreadAlerts,
    unreadAlertCount: unreadAlerts.length,
    dashboard,
    configureSla: store.configureSubscriptionSla,
    removeSla: store.removeSubscriptionSla,
    recordMetric,
    recordMetrics,
    acknowledgeBreach: store.acknowledgeBreach,
    resolveBreach: store.resolveBreach,
    markAlertRead: store.markAlertRead,
    resolveAlert: store.resolveAlert,
    getAnalytics: store.getAnalytics,
    getCreditBalance: store.getCreditBalance,
  };
}
