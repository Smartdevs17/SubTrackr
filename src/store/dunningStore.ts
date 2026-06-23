import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DunningEntry,
  DunningStage,
  DunningAnalytics,
  DunningConfiguration,
  DunningCommunication,
  DEFAULT_DUNNING_STAGES,
} from '../types/dunning';

const STORAGE_KEY = 'subtrackr-dunning';
const ONE_HOUR_MS = 3_600_000;

// Retry schedule in days → converted to hours: 1d, 3d, 7d, 14d
export const RETRY_SCHEDULE_DAYS = [1, 3, 7, 14];

const now = (): number => Date.now();
const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

interface DunningState {
  entries: DunningEntry[];
  configurations: Record<string, DunningConfiguration>;
  isLoading: boolean;
  error: string | null;

  // Core dunning lifecycle
  startDunning: (
    subscriptionId: string,
    subscriberId: string,
    merchantId: string,
    planId?: string
  ) => DunningEntry;
  recordPaymentAttempt: (subscriptionId: string, success: boolean) => DunningEntry | null;
  escalateToSupport: (subscriptionId: string) => DunningEntry | null;
  overrideDunning: (
    subscriptionId: string,
    resolution: 'resolved' | 'waived' | 'cancelled'
  ) => void;

  // Controls
  pauseDunning: (subscriptionId: string) => void;
  resumeDunning: (subscriptionId: string) => void;
  overrideStage: (subscriptionId: string, stage: DunningStage) => void;

  // Config
  configurePlan: (planId: string, config: Partial<DunningConfiguration>) => void;

  // Selectors
  getEntry: (subscriptionId: string) => DunningEntry | undefined;
  getActiveEntries: () => DunningEntry[];
  getAnalytics: () => DunningAnalytics;

  clearError: () => void;
}

const DEFAULT_CONFIG: DunningConfiguration = {
  planId: 'default',
  stages: DEFAULT_DUNNING_STAGES,
  maxRetries: RETRY_SCHEDULE_DAYS.length,
  retryIntervalHours: 24,
  warnAfterFailures: 3,
  suspendAfterDays: 7,
  cancelAfterDays: 14,
  communicationChannels: ['email', 'push', 'in_app'],
};

export const useDunningStore = create<DunningState>()(
  persist(
    (set, get) => ({
      entries: [],
      configurations: { default: DEFAULT_CONFIG },
      isLoading: false,
      error: null,

      startDunning: (subscriptionId, subscriberId, merchantId, planId = 'default') => {
        const existing = get().entries.find((e) => e.subscriptionId === subscriptionId);
        if (existing) return existing;

        const config = get().configurations[planId] ?? DEFAULT_CONFIG;
        const firstStage = config.stages[0] ?? DEFAULT_DUNNING_STAGES[0];
        const ts = now();

        const entry: DunningEntry = {
          id: createId('dun'),
          subscriptionId,
          subscriberId,
          merchantId,
          planId,
          currentStage: firstStage.stage,
          failedAttempts: 0,
          totalFailedCharges: 0,
          firstFailureAt: ts,
          lastFailureAt: ts,
          lastAttemptAt: ts,
          nextActionAt: ts + firstStage.delayHours * ONE_HOUR_MS,
          isPaused: false,
          communicationLog: [],
          createdAt: ts,
          updatedAt: ts,
        };

        set((s) => ({ entries: [...s.entries, entry] }));
        return entry;
      },

      recordPaymentAttempt: (subscriptionId, success) => {
        const entry = get().entries.find((e) => e.subscriptionId === subscriptionId);
        if (!entry || entry.isPaused) return null;

        if (success) {
          // Payment recovered — remove from dunning
          set((s) => ({
            entries: s.entries.filter((e) => e.subscriptionId !== subscriptionId),
          }));
          return null;
        }

        const config = get().configurations[entry.planId] ?? DEFAULT_CONFIG;
        const ts = now();
        const stageIdx = config.stages.findIndex((s) => s.stage === entry.currentStage);
        const stageConfig = config.stages[stageIdx];
        const newFailedAttempts = entry.failedAttempts + 1;

        let nextStage: DunningStage = entry.currentStage;
        let nextDelay = config.retryIntervalHours * ONE_HOUR_MS;
        const newComm: DunningCommunication = {
          id: createId('dcom'),
          stage: entry.currentStage,
          channel: 'push',
          templateId: stageConfig?.templateId ?? 'payment_retry',
          sentAt: ts,
          status: 'sent',
          metadata: { subscription_id: subscriptionId },
        };

        // Advance stage when max attempts for current stage reached
        if (stageConfig && newFailedAttempts >= stageConfig.maxAttempts) {
          const nextIdx = stageIdx + 1;
          if (nextIdx < config.stages.length) {
            nextStage = config.stages[nextIdx].stage;
            nextDelay = config.stages[nextIdx].delayHours * ONE_HOUR_MS;
          } else {
            nextStage = 'cancel';
            nextDelay = 24 * ONE_HOUR_MS;
          }
        }

        set((s) => ({
          entries: s.entries.map((e) =>
            e.subscriptionId === subscriptionId
              ? {
                  ...e,
                  currentStage: nextStage,
                  failedAttempts: nextStage !== entry.currentStage ? 0 : newFailedAttempts,
                  totalFailedCharges: e.totalFailedCharges + 1,
                  lastFailureAt: ts,
                  lastAttemptAt: ts,
                  nextActionAt: ts + nextDelay,
                  communicationLog: [...e.communicationLog, newComm],
                  updatedAt: ts,
                }
              : e
          ),
        }));

        return get().entries.find((e) => e.subscriptionId === subscriptionId) ?? null;
      },

      escalateToSupport: (subscriptionId) => {
        const entry = get().entries.find((e) => e.subscriptionId === subscriptionId);
        if (!entry) return null;

        const ts = now();
        const comm: DunningCommunication = {
          id: createId('dcom'),
          stage: 'suspend',
          channel: 'in_app',
          templateId: 'escalate_support',
          sentAt: ts,
          status: 'sent',
          metadata: { subscription_id: subscriptionId, escalated: 'true' },
        };

        set((s) => ({
          entries: s.entries.map((e) =>
            e.subscriptionId === subscriptionId
              ? {
                  ...e,
                  currentStage: 'suspend' as DunningStage,
                  isPaused: true, // pause automated retries while human reviews
                  communicationLog: [...e.communicationLog, comm],
                  updatedAt: ts,
                }
              : e
          ),
        }));

        return get().entries.find((e) => e.subscriptionId === subscriptionId) ?? null;
      },

      overrideDunning: (subscriptionId, _resolution) => {
        set((s) => ({
          entries: s.entries.filter((e) => e.subscriptionId !== subscriptionId),
        }));
      },

      pauseDunning: (subscriptionId) => {
        set((s) => ({
          entries: s.entries.map((e) =>
            e.subscriptionId === subscriptionId
              ? { ...e, isPaused: true, updatedAt: now() }
              : e
          ),
        }));
      },

      resumeDunning: (subscriptionId) => {
        const entry = get().entries.find((e) => e.subscriptionId === subscriptionId);
        if (!entry) return;
        const config = get().configurations[entry.planId] ?? DEFAULT_CONFIG;
        const stageConfig = config.stages.find((s) => s.stage === entry.currentStage);
        const delay = (stageConfig?.delayHours ?? 24) * ONE_HOUR_MS;

        set((s) => ({
          entries: s.entries.map((e) =>
            e.subscriptionId === subscriptionId
              ? { ...e, isPaused: false, nextActionAt: now() + delay, updatedAt: now() }
              : e
          ),
        }));
      },

      overrideStage: (subscriptionId, stage) => {
        const entry = get().entries.find((e) => e.subscriptionId === subscriptionId);
        if (!entry) return;
        const config = get().configurations[entry.planId] ?? DEFAULT_CONFIG;
        const stageConfig = config.stages.find((s) => s.stage === stage);
        const delay = (stageConfig?.delayHours ?? 24) * ONE_HOUR_MS;

        set((s) => ({
          entries: s.entries.map((e) =>
            e.subscriptionId === subscriptionId
              ? {
                  ...e,
                  currentStage: stage,
                  failedAttempts: 0,
                  nextActionAt: now() + delay,
                  updatedAt: now(),
                }
              : e
          ),
        }));
      },

      configurePlan: (planId, config) => {
        const existing = get().configurations[planId] ?? DEFAULT_CONFIG;
        set((s) => ({
          configurations: {
            ...s.configurations,
            [planId]: { ...existing, ...config, planId },
          },
        }));
      },

      getEntry: (subscriptionId) =>
        get().entries.find((e) => e.subscriptionId === subscriptionId),

      getActiveEntries: () => get().entries.filter((e) => !e.isPaused),

      getAnalytics: (): DunningAnalytics => {
        const entries = get().entries;
        const breakdown: Record<DunningStage, number> = {
          retry: 0,
          warn: 0,
          suspend: 0,
          cancel: 0,
        };
        for (const e of entries) {
          breakdown[e.currentStage] = (breakdown[e.currentStage] ?? 0) + 1;
        }
        const totalLost = breakdown.cancel;
        const totalActive = entries.length;
        return {
          totalActiveDunning: totalActive,
          stageBreakdown: breakdown,
          recoveryRate: totalActive > 0 ? Math.round(((totalActive - totalLost) / totalActive) * 100) : 0,
          totalRecovered: 0,
          totalLost,
          averageDaysToRecovery: 0,
          stageSuccessRates: { retry: 0, warn: 0, suspend: 0, cancel: 0 },
        };
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ entries: s.entries, configurations: s.configurations }),
    }
  )
);
