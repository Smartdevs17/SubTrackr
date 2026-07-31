/**
 * Subscription SLA Monitoring Store (Zustand)
 *
 * Manages subscription-level SLA state including configs, statuses,
 * breaches, and alerts. Integrates with the evaluation service and
 * notification system for real-time breach detection and alerting.
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/779
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import type {
  SubscriptionSlaConfig,
  SubscriptionSlaBreach,
  SubscriptionSlaAlert,
  SubscriptionSlaStatus,
  SubscriptionSlaAnalytics,
  SubscriptionSlaReport,
  SubscriptionSlaDashboard,
  SlaMetricSample,
  SubscriptionSlaTier,
  SlaBreachSeverity,
} from '../types/subscriptionSla';
import { DEFAULT_SLA_TARGETS } from '../types/subscriptionSla';
import {
  evaluateSubscriptionSla,
  buildSubscriptionSlaAnalytics,
  generateSubscriptionSlaReport,
  buildSubscriptionSlaDashboard,
} from '../services/subscriptionSlaMonitorService';
import { presentSlaBreachNotification } from '../services/notificationService';

const STORAGE_KEY = 'subtrackr-subscription-sla';

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

// ── Store interface ───────────────────────────────────────────────────────────

interface SubscriptionSlaState {
  /** Per-subscription SLA configurations */
  configs: Record<string, SubscriptionSlaConfig>;
  /** Current SLA statuses per subscription */
  statuses: Record<string, SubscriptionSlaStatus>;
  /** All SLA breaches (active and resolved) */
  breaches: SubscriptionSlaBreach[];
  /** All SLA alerts */
  alerts: SubscriptionSlaAlert[];
  /** Collected metric samples (ring buffer, latest N per subscription) */
  metricSamples: Record<string, SlaMetricSample[]>;
  /** Loading state */
  isLoading: boolean;
  /** Last error */
  error: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Configure SLA monitoring for a subscription */
  configureSubscriptionSla: (
    subscriptionId: string,
    tier: SubscriptionSlaTier,
    overrides?: Partial<SubscriptionSlaConfig>
  ) => void;

  /** Remove SLA monitoring for a subscription */
  removeSubscriptionSla: (subscriptionId: string) => void;

  /** Record a metric sample and trigger SLA evaluation */
  recordMetric: (subscriptionId: string, sample: Omit<SlaMetricSample, 'subscriptionId'>) => void;

  /** Record a batch of metric samples and evaluate */
  recordMetricBatch: (subscriptionId: string, samples: Omit<SlaMetricSample, 'subscriptionId'>[]) => void;

  /** Manually trigger SLA evaluation for a subscription */
  evaluateSla: (subscriptionId: string) => SubscriptionSlaStatus | null;

  /** Acknowledge a breach */
  acknowledgeBreach: (breachId: string, notes?: string) => void;

  /** Resolve a breach */
  resolveBreach: (breachId: string) => void;

  /** Mark an alert as read */
  markAlertRead: (alertId: string) => void;

  /** Resolve an alert */
  resolveAlert: (alertId: string) => void;

  /** Get the current SLA status for a subscription */
  getStatus: (subscriptionId: string) => SubscriptionSlaStatus | null;

  /** Get all active breaches */
  getActiveBreaches: () => SubscriptionSlaBreach[];

  /** Get unread alerts */
  getUnreadAlerts: () => SubscriptionSlaAlert[];

  /** Get SLA analytics */
  getAnalytics: (days?: number) => SubscriptionSlaAnalytics;

  /** Generate an SLA report */
  generateReport: (
    reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly',
    periodStart: number,
    periodEnd: number
  ) => SubscriptionSlaReport;

  /** Get dashboard data */
  getDashboard: () => SubscriptionSlaDashboard;

  /** Get credit balance for a subscription */
  getCreditBalance: (subscriptionId: string) => number;

  /** Reset all SLA data */
  reset: () => void;
}

// ── Maximum metric samples to retain per subscription ─────────────────────────

const MAX_SAMPLES_PER_SUB = 1000;

// ── Store implementation ──────────────────────────────────────────────────────

export const useSubscriptionSlaStore = create<SubscriptionSlaState>()(
  persist(
    (set, get) => ({
      configs: {},
      statuses: {},
      breaches: [],
      alerts: [],
      metricSamples: {},
      isLoading: false,
      error: null,

      configureSubscriptionSla: (subscriptionId, tier, overrides) => {
        const targets = { ...DEFAULT_SLA_TARGETS[tier], ...overrides?.targets };
        const now = Date.now();

        const config: SubscriptionSlaConfig = {
          subscriptionId,
          tier,
          targets,
          checkIntervalSeconds: overrides?.checkIntervalSeconds ?? 300,
          autoCreditEnabled: overrides?.autoCreditEnabled ?? true,
          alertContacts: overrides?.alertContacts ?? [],
          escalationRules: overrides?.escalationRules ?? [
            { severity: 'warning', afterMinutes: 30, action: 'alert', recipients: [] },
            { severity: 'minor', afterMinutes: 15, action: 'alert', recipients: [] },
            { severity: 'major', afterMinutes: 5, action: 'notify_admin', recipients: [] },
            { severity: 'critical', afterMinutes: 0, action: 'escalate', recipients: [] },
          ],
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          configs: { ...state.configs, [subscriptionId]: config },
          error: null,
        }));
      },

      removeSubscriptionSla: (subscriptionId) => {
        set((state) => {
          const { [subscriptionId]: _, ...configs } = state.configs;
          const { [subscriptionId]: __, ...statuses } = state.statuses;
          const { [subscriptionId]: ___, ...metricSamples } = state.metricSamples;
          return {
            configs,
            statuses,
            metricSamples,
            breaches: state.breaches.filter((b) => b.subscriptionId !== subscriptionId),
            alerts: state.alerts.filter((a) => a.subscriptionId !== subscriptionId),
          };
        });
      },

      recordMetric: (subscriptionId, sample) => {
        const fullSample: SlaMetricSample = { ...sample, subscriptionId };

        set((state) => {
          const existing = state.metricSamples[subscriptionId] ?? [];
          const updated = [...existing, fullSample].slice(-MAX_SAMPLES_PER_SUB);
          return {
            metricSamples: { ...state.metricSamples, [subscriptionId]: updated },
          };
        });

        // Trigger evaluation
        get().evaluateSla(subscriptionId);
      },

      recordMetricBatch: (subscriptionId, samples) => {
        const fullSamples = samples.map((s) => ({ ...s, subscriptionId }));

        set((state) => {
          const existing = state.metricSamples[subscriptionId] ?? [];
          const updated = [...existing, ...fullSamples].slice(-MAX_SAMPLES_PER_SUB);
          return {
            metricSamples: { ...state.metricSamples, [subscriptionId]: updated },
          };
        });

        get().evaluateSla(subscriptionId);
      },

      evaluateSla: (subscriptionId) => {
        const state = get();
        const config = state.configs[subscriptionId];
        if (!config) return null;

        const metrics = state.metricSamples[subscriptionId] ?? [];
        const existingBreaches = state.breaches.filter(
          (b) => b.subscriptionId === subscriptionId
        );

        try {
          const result = evaluateSubscriptionSla({
            config,
            metrics,
            existingBreaches,
          });

          // Update state with evaluation results
          const updatedBreaches = state.breaches
            .filter((b) => b.subscriptionId !== subscriptionId)
            .concat(result.breaches.filter((b) => b.subscriptionId === subscriptionId));

          set({
            statuses: { ...state.statuses, [subscriptionId]: result.status },
            breaches: updatedBreaches,
            alerts: [...state.alerts, ...result.alerts],
            error: null,
          });

          // Send breach notifications for new breaches
          for (const breach of result.newBreaches) {
            void presentSlaBreachNotification({
              merchantName: `Subscription ${subscriptionId}`,
              uptimeTarget: breach.targetValue,
              uptimePercentage: breach.actualValue,
              creditAmount: breach.creditIssued,
            });
          }

          return result.status;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'SLA evaluation failed';
          set({ error: msg });
          return null;
        }
      },

      acknowledgeBreach: (breachId, notes) => {
        set((state) => ({
          breaches: state.breaches.map((b) =>
            b.id === breachId ? { ...b, acknowledged: true, notes: notes ?? b.notes } : b
          ),
        }));
      },

      resolveBreach: (breachId) => {
        const now = Date.now();
        set((state) => ({
          breaches: state.breaches.map((b) =>
            b.id === breachId ? { ...b, resolvedAt: now } : b
          ),
          alerts: state.alerts.map((a) =>
            a.breachId === breachId ? { ...a, isResolved: true, resolvedAt: now } : a
          ),
        }));
      },

      markAlertRead: (alertId) => {
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === alertId ? { ...a, isRead: true, acknowledgedAt: Date.now() } : a
          ),
        }));
      },

      resolveAlert: (alertId) => {
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === alertId ? { ...a, isResolved: true, resolvedAt: Date.now() } : a
          ),
        }));
      },

      getStatus: (subscriptionId) => get().statuses[subscriptionId] ?? null,

      getActiveBreaches: () => get().breaches.filter((b) => b.resolvedAt === null),

      getUnreadAlerts: () => get().alerts.filter((a) => !a.isRead && !a.isResolved),

      getAnalytics: (days = 30) => {
        const state = get();
        return buildSubscriptionSlaAnalytics(
          Object.values(state.statuses),
          state.breaches,
          days
        );
      },

      generateReport: (reportType, periodStart, periodEnd) => {
        const state = get();
        return generateSubscriptionSlaReport(
          reportType,
          periodStart,
          periodEnd,
          Object.values(state.statuses),
          state.breaches
        );
      },

      getDashboard: () => {
        const state = get();
        return buildSubscriptionSlaDashboard(
          Object.values(state.statuses),
          state.breaches,
          state.alerts
        );
      },

      getCreditBalance: (subscriptionId) => {
        return get()
          .breaches.filter((b) => b.subscriptionId === subscriptionId)
          .reduce((sum, b) => sum + b.creditIssued, 0);
      },

      reset: () => {
        set({
          configs: {},
          statuses: {},
          breaches: [],
          alerts: [],
          metricSamples: {},
          isLoading: false,
          error: null,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      version: 1,
      partialize: (state) => ({
        configs: state.configs,
        statuses: state.statuses,
        breaches: state.breaches,
        alerts: state.alerts,
        // metricSamples intentionally excluded from persistence to avoid bloat
      }),
    }
  )
);
