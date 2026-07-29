import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
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
const ONE_DAY_MS = 86_400_000;

// Retry schedule in days → converted to hours: 1d, 3d, 7d, 14d
export const RETRY_SCHEDULE_DAYS = [1, 3, 7, 14];

const now = (): number => Date.now();
const createId = (prefix: string): string =>
  `${prefix}_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export type FailureType =
  | 'insufficient_funds'
  | 'card_declined'
  | 'expired_card'
  | 'network_error'
  | 'processing_error'
  | 'auth_required'
  | 'unknown';

export interface RetryScheduleConfig {
  failureType: FailureType;
  baseDelayHours: number;
  maxRetries: number;
  backoffMultiplier: number;
  maxDelayHours: number;
}

export interface RetryAnalytics {
  totalRetries: number;
  successfulRetries: number;
  failedRetries: number;
  retryRate: number;
  successRate: number;
  averageRetriesBeforeSuccess: number;
  retriesByFailureType: Record<FailureType, number>;
  retriesByStage: Record<DunningStage, number>;
  averageTimeToRecovery: number;
}

const DEFAULT_RETRY_SCHEDULES: RetryScheduleConfig[] = [
  {
    failureType: 'insufficient_funds',
    baseDelayHours: 1,
    maxRetries: 5,
    backoffMultiplier: 2,
    maxDelayHours: 48,
  },
  {
    failureType: 'card_declined',
    baseDelayHours: 2,
    maxRetries: 3,
    backoffMultiplier: 3,
    maxDelayHours: 72,
  },
  {
    failureType: 'expired_card',
    baseDelayHours: 24,
    maxRetries: 2,
    backoffMultiplier: 1,
    maxDelayHours: 24,
  },
  {
    failureType: 'network_error',
    baseDelayHours: 0.5,
    maxRetries: 6,
    backoffMultiplier: 1.5,
    maxDelayHours: 12,
  },
  {
    failureType: 'processing_error',
    baseDelayHours: 1,
    maxRetries: 4,
    backoffMultiplier: 2,
    maxDelayHours: 24,
  },
  {
    failureType: 'auth_required',
    baseDelayHours: 0.25,
    maxRetries: 3,
    backoffMultiplier: 1,
    maxDelayHours: 1,
  },
  {
    failureType: 'unknown',
    baseDelayHours: 1,
    maxRetries: 3,
    backoffMultiplier: 2,
    maxDelayHours: 24,
  },
];

export interface DunningState {
  entries: DunningEntry[];
  configurations: Record<string, DunningConfiguration>;
  retrySchedules: RetryScheduleConfig[];
  retryHistory: Array<{
    subscriptionId: string;
    failureType: FailureType;
    attempt: number;
    success: boolean;
    timestamp: number;
    delayHours: number;
  }>;
  isLoading: boolean;
  error: string | null;

  // Core dunning lifecycle
  startDunning: (
    subscriptionId: string,
    subscriberId: string,
    merchantId: string,
    planId?: string
  ) => DunningEntry;
  recordPaymentAttempt: (
    subscriptionId: string,
    success: boolean,
    failureType?: FailureType
  ) => DunningEntry | null;
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
  configureRetrySchedule: (
    schedule: Partial<RetryScheduleConfig> & { failureType: FailureType }
  ) => void;

  // Selectors
  getEntry: (subscriptionId: string) => DunningEntry | undefined;
  getActiveEntries: () => DunningEntry[];
  getAnalytics: () => DunningAnalytics;
  getRetryAnalytics: () => RetryAnalytics;
  getRetrySchedule: (failureType: FailureType) => RetryScheduleConfig;
  calculateRetryDelay: (failureType: FailureType, attempt: number) => number;

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
      retrySchedules: [...DEFAULT_RETRY_SCHEDULES],
      retryHistory: [],
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

      recordPaymentAttempt: (subscriptionId, success, failureType = 'unknown') => {
        const entry = get().entries.find((e) => e.subscriptionId === subscriptionId);
        if (!entry || entry.isPaused) return null;

        const schedule =
          get().retrySchedules.find((s) => s.failureType === failureType) ??
          get().retrySchedules.find((s) => s.failureType === 'unknown')!;

        if (success) {
          get().retryHistory.push({
            subscriptionId,
            failureType,
            attempt: entry.failedAttempts,
            success: true,
            timestamp: now(),
            delayHours: 0,
          });

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

        get().retryHistory.push({
          subscriptionId,
          failureType,
          attempt: newFailedAttempts,
          success: false,
          timestamp: ts,
          delayHours: 0,
        });

        let nextStage: DunningStage = entry.currentStage;
        let nextDelay = config.retryIntervalHours * ONE_HOUR_MS;
        const newComm: DunningCommunication = {
          id: createId('dcom'),
          stage: entry.currentStage,
          channel: 'push',
          templateId: stageConfig?.templateId ?? 'payment_retry',
          sentAt: ts,
          status: 'sent',
          metadata: { subscription_id: subscriptionId, failure_type: failureType },
        };

        if (newFailedAttempts >= schedule.maxRetries) {
          const nextIdx = stageIdx + 1;
          if (nextIdx < config.stages.length) {
            nextStage = config.stages[nextIdx].stage;
            nextDelay = config.stages[nextIdx].delayHours * ONE_HOUR_MS;
          } else {
            nextStage = 'cancel';
            nextDelay = 24 * ONE_HOUR_MS;
          }
        } else if (stageConfig && newFailedAttempts >= stageConfig.maxAttempts) {
          const nextIdx = stageIdx + 1;
          if (nextIdx < config.stages.length) {
            nextStage = config.stages[nextIdx].stage;
            nextDelay = config.stages[nextIdx].delayHours * ONE_HOUR_MS;
          } else {
            nextStage = 'cancel';
            nextDelay = 24 * ONE_HOUR_MS;
          }
        } else {
          const delayMs =
            schedule.baseDelayHours *
            Math.pow(schedule.backoffMultiplier, newFailedAttempts - 1) *
            ONE_HOUR_MS;
          nextDelay = Math.min(delayMs, schedule.maxDelayHours * ONE_HOUR_MS);
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
            e.subscriptionId === subscriptionId ? { ...e, isPaused: true, updatedAt: now() } : e
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

      configureRetrySchedule: (schedule) => {
        const existingIdx = get().retrySchedules.findIndex(
          (s) => s.failureType === schedule.failureType
        );
        const existing = existingIdx >= 0 ? get().retrySchedules[existingIdx] : undefined;

        const merged: RetryScheduleConfig = {
          failureType: schedule.failureType,
          baseDelayHours: schedule.baseDelayHours ?? existing?.baseDelayHours ?? 1,
          maxRetries: schedule.maxRetries ?? existing?.maxRetries ?? 3,
          backoffMultiplier: schedule.backoffMultiplier ?? existing?.backoffMultiplier ?? 2,
          maxDelayHours: schedule.maxDelayHours ?? existing?.maxDelayHours ?? 24,
        };

        set((s) => {
          const newSchedules = [...s.retrySchedules];
          if (existingIdx >= 0) {
            newSchedules[existingIdx] = merged;
          } else {
            newSchedules.push(merged);
          }
          return { retrySchedules: newSchedules };
        });
      },

      getRetrySchedule: (failureType) => {
        return (
          get().retrySchedules.find((s) => s.failureType === failureType) ??
          get().retrySchedules.find((s) => s.failureType === 'unknown')!
        );
      },

      calculateRetryDelay: (failureType, attempt) => {
        const schedule = get().getRetrySchedule(failureType);
        const delay = schedule.baseDelayHours * Math.pow(schedule.backoffMultiplier, attempt - 1);
        return Math.min(delay, schedule.maxDelayHours);
      },

      getEntry: (subscriptionId) => get().entries.find((e) => e.subscriptionId === subscriptionId),

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
        const retryAnalytics = get().getRetryAnalytics();
        return {
          totalActiveDunning: totalActive,
          stageBreakdown: breakdown,
          recoveryRate: retryAnalytics.successRate,
          totalRecovered: retryAnalytics.successfulRetries,
          totalLost,
          averageDaysToRecovery: retryAnalytics.averageTimeToRecovery,
          stageSuccessRates: { retry: 0, warn: 0, suspend: 0, cancel: 0 },
        };
      },

      getRetryAnalytics: (): RetryAnalytics => {
        const entries = get().entries;
        const history = get().retryHistory;

        const totalRetries = history.length;
        const successfulRetries = history.filter((h) => h.success).length;
        const failedRetries = totalRetries - successfulRetries;

        const retriesByFailureType: Record<FailureType, number> = {
          insufficient_funds: 0,
          card_declined: 0,
          expired_card: 0,
          network_error: 0,
          processing_error: 0,
          auth_required: 0,
          unknown: 0,
        };

        const retriesByStage: Record<DunningStage, number> = {
          retry: 0,
          warn: 0,
          suspend: 0,
          cancel: 0,
        };

        for (const entry of entries) {
          retriesByStage[entry.currentStage] = (retriesByStage[entry.currentStage] ?? 0) + 1;
        }

        for (const h of history) {
          retriesByFailureType[h.failureType] = (retriesByFailureType[h.failureType] ?? 0) + 1;
        }

        const successfulSubscriptionIds = new Set(
          history.filter((h) => h.success).map((h) => h.subscriptionId)
        );

        const recoveryTimes: number[] = [];
        for (const subId of successfulSubscriptionIds) {
          const subHistory = history.filter((h) => h.subscriptionId === subId);
          if (subHistory.length >= 2) {
            const first = subHistory[0];
            const last = subHistory[subHistory.length - 1];
            recoveryTimes.push((last.timestamp - first.timestamp) / ONE_DAY_MS);
          }
        }

        const avgRecoveryTime =
          recoveryTimes.length > 0
            ? recoveryTimes.reduce((s, t) => s + t, 0) / recoveryTimes.length
            : 0;

        const attemptsPerSuccess: number[] = [];
        for (const subId of successfulSubscriptionIds) {
          const subHistory = history.filter((h) => h.subscriptionId === subId);
          attemptsPerSuccess.push(subHistory.length);
        }

        return {
          totalRetries,
          successfulRetries,
          failedRetries,
          retryRate: totalRetries > 0 ? Math.round((failedRetries / totalRetries) * 100) : 0,
          successRate: totalRetries > 0 ? Math.round((successfulRetries / totalRetries) * 100) : 0,
          averageRetriesBeforeSuccess:
            attemptsPerSuccess.length > 0
              ? Math.round(
                  attemptsPerSuccess.reduce((s, a) => s + a, 0) / attemptsPerSuccess.length
                )
              : 0,
          retriesByFailureType,
          retriesByStage,
          averageTimeToRecovery: Math.round(avgRecoveryTime * 10) / 10,
        };
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (s) => ({
        entries: s.entries,
        configurations: s.configurations,
        retrySchedules: s.retrySchedules,
        retryHistory: s.retryHistory,
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[dunningStore] Hydration error — resetting to defaults:', error);
          useDunningStore.setState({
            entries: [],
            configurations: { default: DEFAULT_CONFIG },
            isLoading: false,
            error: null,
          });
        }
      },
    }
  )
);
