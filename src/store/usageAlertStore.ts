/**
 * Zustand store for usage alerts and overage notifications (#1230).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { QuotaMetric } from '../types/usage';
import type { OverageNotification, UsageAlert, UsageThreshold } from '../types/usageAlerts';
import {
  createDefaultThreshold,
  evaluateAllThresholds,
  evaluateOverages,
} from '../services/usageAlertService';
import type { UsageEntry } from '../services/usageAlertService';

const STORAGE_KEY = 'subtrackr-usage-alerts';

// ── State shape ────────────────────────────────────────────────────────────

interface UsageAlertState {
  alerts: UsageAlert[];
  overageNotifications: OverageNotification[];
  thresholds: UsageThreshold[];
  lastChecked: string | null;
  isLoading: boolean;
  error: string | null;

  // ── Threshold management ─────────────────────────────────────────────────
  addThreshold: (subscriptionId: string, metric: QuotaMetric, overrides?: Partial<UsageThreshold>) => void;
  updateThreshold: (id: string, updates: Partial<UsageThreshold>) => void;
  removeThreshold: (id: string) => void;
  getThreshold: (subscriptionId: string, metric: QuotaMetric) => UsageThreshold | undefined;

  // ── Alert evaluation ─────────────────────────────────────────────────────
  /** Run threshold checks against a usage snapshot. Appends new alerts + overages. */
  checkAlerts: (usageMap: Record<string, UsageEntry>) => void;

  // ── Alert lifecycle ──────────────────────────────────────────────────────
  markAlertRead: (id: string) => void;
  dismissAlert: (id: string) => void;
  markAllRead: () => void;
  clearDismissed: () => void;
  clearAllAlerts: () => void;

  // ── Overage lifecycle ────────────────────────────────────────────────────
  acknowledgeOverage: (id: string) => void;
  acknowledgeAllOverages: () => void;

  // ── Utilities ─────────────────────────────────────────────────────────────
  unreadCount: () => number;
  criticalCount: () => number;
  clearError: () => void;
  reset: () => void;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const defaults = {
  alerts: [] as UsageAlert[],
  overageNotifications: [] as OverageNotification[],
  thresholds: [] as UsageThreshold[],
  lastChecked: null as string | null,
  isLoading: false,
  error: null as string | null,
};

// ── Store ──────────────────────────────────────────────────────────────────

export const useUsageAlertStore = create<UsageAlertState>()(
  persist(
    (set, get) => ({
      ...defaults,

      // ── Thresholds ──────────────────────────────────────────────────────

      addThreshold: (subscriptionId, metric, overrides) => {
        const existing = get().thresholds.find(
          (t) => t.subscriptionId === subscriptionId && t.metric === metric
        );
        if (existing) return; // already configured
        const threshold = { ...createDefaultThreshold(subscriptionId, metric), ...overrides };
        set((s) => ({ thresholds: [...s.thresholds, threshold] }));
      },

      updateThreshold: (id, updates) => {
        set((s) => ({
          thresholds: s.thresholds.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        }));
      },

      removeThreshold: (id) => {
        set((s) => ({ thresholds: s.thresholds.filter((t) => t.id !== id) }));
      },

      getThreshold: (subscriptionId, metric) => {
        return get().thresholds.find(
          (t) => t.subscriptionId === subscriptionId && t.metric === metric
        );
      },

      // ── Check ───────────────────────────────────────────────────────────

      checkAlerts: (usageMap) => {
        set({ isLoading: true, error: null });
        try {
          const { thresholds } = get();
          const newAlerts = evaluateAllThresholds(usageMap, thresholds);
          const newOverages = evaluateOverages(usageMap, thresholds);

          set((s) => ({
            alerts: [...s.alerts, ...newAlerts],
            overageNotifications: [...s.overageNotifications, ...newOverages],
            lastChecked: new Date().toISOString(),
            isLoading: false,
          }));
        } catch (err) {
          set({
            isLoading: false,
            error: err instanceof Error ? err.message : 'Failed to check usage alerts.',
          });
        }
      },

      // ── Alert lifecycle ─────────────────────────────────────────────────

      markAlertRead: (id) => {
        set((s) => ({
          alerts: s.alerts.map((a) => (a.id === id ? { ...a, isRead: true } : a)),
        }));
      },

      dismissAlert: (id) => {
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, isDismissed: true, isRead: true } : a
          ),
        }));
      },

      markAllRead: () => {
        set((s) => ({
          alerts: s.alerts.map((a) => ({ ...a, isRead: true })),
        }));
      },

      clearDismissed: () => {
        set((s) => ({ alerts: s.alerts.filter((a) => !a.isDismissed) }));
      },

      clearAllAlerts: () => {
        set({ alerts: [], overageNotifications: [] });
      },

      // ── Overages ────────────────────────────────────────────────────────

      acknowledgeOverage: (id) => {
        set((s) => ({
          overageNotifications: s.overageNotifications.map((n) =>
            n.id === id ? { ...n, isAcknowledged: true } : n
          ),
        }));
      },

      acknowledgeAllOverages: () => {
        set((s) => ({
          overageNotifications: s.overageNotifications.map((n) => ({
            ...n,
            isAcknowledged: true,
          })),
        }));
      },

      // ── Computed helpers ─────────────────────────────────────────────────

      unreadCount: () => get().alerts.filter((a) => !a.isRead && !a.isDismissed).length,

      criticalCount: () =>
        get().alerts.filter((a) => a.severity === 'critical' && !a.isDismissed).length,

      clearError: () => set({ error: null }),

      reset: () => set({ ...defaults }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        alerts: state.alerts,
        overageNotifications: state.overageNotifications,
        thresholds: state.thresholds,
        lastChecked: state.lastChecked,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[usageAlertStore] Hydration error – resetting:', error);
          useUsageAlertStore.setState({ ...defaults });
        }
      },
    }
  )
);
