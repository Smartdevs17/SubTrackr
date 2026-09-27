/**
 * usageAlertStore.ts — Zustand store for usage alerts and overage notifications.
 *
 * Persists to AsyncStorage under 'subtrackr-usage-alerts'.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { UsageAlert, UsageThreshold, OverageNotification } from '../types/usageAlerts';
import {
  evaluateAllThresholds,
  generateOverageNotification,
} from '../services/usageAlertService';

// ─────────────────────────────────────────────────────────────────────────────
// State shape
// ─────────────────────────────────────────────────────────────────────────────

interface UsageAlertState {
  /** All generated alerts (active + dismissed). */
  alerts: UsageAlert[];
  /** Overage notifications triggered when usage exceeds quota. */
  overageNotifications: OverageNotification[];
  /** User-configured threshold definitions. */
  thresholds: UsageThreshold[];
  /** ISO-8601 timestamp of the last threshold evaluation run, or null. */
  lastChecked: string | null;
  isLoading: boolean;
  error: string | null;

  // ── Threshold management ────────────────────────────────────────────────
  addThreshold: (threshold: UsageThreshold) => void;
  updateThreshold: (id: string, updates: Partial<UsageThreshold>) => void;
  removeThreshold: (id: string) => void;

  // ── Alert lifecycle ─────────────────────────────────────────────────────
  /**
   * Evaluates all configured thresholds against the provided usage map.
   * Appends new alerts and overage notifications; does not overwrite existing
   * alerts with the same metric.
   *
   * @param usageData - Map keyed by "subscriptionId::metricName".
   * @param costPerUnit - Default overage cost per unit (used when no per-threshold
   *                      cost is configured). Defaults to 0.
   */
  checkAlerts: (
    usageData: Record<string, { current: number; limit: number }>,
    costPerUnit?: number
  ) => void;
  acknowledgeAlert: (id: string) => void;
  dismissAlert: (id: string) => void;
  markAllRead: () => void;
  clearAllAlerts: () => void;

  // ── Overage notifications ───────────────────────────────────────────────
  acknowledgeOverage: (id: string) => void;

  // ── Misc ────────────────────────────────────────────────────────────────
  clearError: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useUsageAlertStore = create<UsageAlertState>()(
  persist(
    (set, get) => ({
      alerts: [],
      overageNotifications: [],
      thresholds: [],
      lastChecked: null,
      isLoading: false,
      error: null,

      // ── Threshold management ──────────────────────────────────────────────

      addThreshold: (threshold) =>
        set((state) => ({
          thresholds: [...state.thresholds, threshold],
        })),

      updateThreshold: (id, updates) =>
        set((state) => ({
          thresholds: state.thresholds.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),

      removeThreshold: (id) =>
        set((state) => ({
          thresholds: state.thresholds.filter((t) => t.id !== id),
        })),

      // ── Alert evaluation ──────────────────────────────────────────────────

      checkAlerts: (usageData, costPerUnit = 0) => {
        set({ isLoading: true, error: null });
        try {
          const { thresholds, alerts: existingAlerts } = get();

          // Evaluate thresholds → new alerts
          const newAlerts = evaluateAllThresholds(usageData, thresholds);

          // De-duplicate: skip if an unread, undismissed alert for the same
          // subscription + metric + type already exists.
          const filteredAlerts = newAlerts.filter((na) => {
            return !existingAlerts.some(
              (ea) =>
                ea.subscriptionId === na.subscriptionId &&
                ea.metricName === na.metricName &&
                ea.type === na.type &&
                !ea.isDismissed
            );
          });

          // Generate overage notifications for any entries that exceed limit
          const newOverages: OverageNotification[] = [];
          for (const [key, usage] of Object.entries(usageData)) {
            if (usage.current <= usage.limit) continue;
            const [subscriptionId, metricName] = key.split('::');
            if (!subscriptionId || !metricName) continue;

            const notification = generateOverageNotification(
              subscriptionId,
              metricName,
              usage.current,
              usage.limit,
              costPerUnit
            );
            if (notification) {
              newOverages.push(notification);
            }
          }

          set((state) => ({
            alerts: [...state.alerts, ...filteredAlerts],
            overageNotifications: [...state.overageNotifications, ...newOverages],
            lastChecked: new Date().toISOString(),
            isLoading: false,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to check usage alerts';
          set({ error: message, isLoading: false });
        }
      },

      // ── Alert lifecycle ────────────────────────────────────────────────────

      acknowledgeAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) => (a.id === id ? { ...a, isRead: true } : a)),
        })),

      dismissAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, isDismissed: true, isRead: true } : a
          ),
        })),

      markAllRead: () =>
        set((state) => ({
          alerts: state.alerts.map((a) => ({ ...a, isRead: true })),
        })),

      clearAllAlerts: () =>
        set({
          alerts: [],
          overageNotifications: [],
          error: null,
        }),

      // ── Overage notifications ──────────────────────────────────────────────

      acknowledgeOverage: (id) =>
        set((state) => ({
          overageNotifications: state.overageNotifications.map((n) =>
            n.id === id ? { ...n, isAcknowledged: true } : n
          ),
        })),

      // ── Misc ───────────────────────────────────────────────────────────────

      clearError: () => set({ error: null }),
    }),
    {
      name: 'subtrackr-usage-alerts',
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
