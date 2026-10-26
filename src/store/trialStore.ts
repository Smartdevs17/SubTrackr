import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import {
  TrialConfig,
  ABTestAssignment,
  ConversionFunnelEvent,
  TrialReminderSchedule,
  TrialStatus,
  TrialDuration,
  TrialExtensionRule,
  TrialExtension,
  TrialAnalytics,
} from '../types/trial';

const STORAGE_KEY = 'subtrackr-trials';
const STORE_VERSION = 1;

interface TrialState {
  trialConfigs: TrialConfig[];
  abTestAssignments: ABTestAssignment[];
  conversionFunnel: ConversionFunnelEvent[];
  trialReminders: TrialReminderSchedule[];
  isLoading: boolean;
  error: string | null;

  createTrialConfig: (
    config: Omit<TrialConfig, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<TrialConfig>;
  updateTrialConfig: (id: string, updates: Partial<TrialConfig>) => Promise<void>;
  assignABTest: (
    assignment: Omit<ABTestAssignment, 'id' | 'assignedAt'>
  ) => Promise<ABTestAssignment>;
  recordFunnelEvent: (
    event: Omit<ConversionFunnelEvent, 'id' | 'timestamp'>
  ) => Promise<ConversionFunnelEvent>;
  scheduleReminder: (
    schedule: Omit<TrialReminderSchedule, 'id' | 'createdAt'>
  ) => Promise<TrialReminderSchedule>;
  convertTrial: (trialId: string) => Promise<void>;
  expireTrial: (trialId: string) => Promise<void>;
  getConversionStats: (abTestId?: string) => {
    totalTrials: number;
    convertedTrials: number;
    conversionRate: number;
  };
  extendTrial: (trialId: string, ruleId: string) => Promise<void>;
  startTrial: (subscriptionId: string, duration: TrialDuration) => Promise<TrialConfig>;
  autoConvertEligibleTrials: () => Promise<void>;
  getTrialAnalytics: () => TrialAnalytics;
  extensionRules: TrialExtensionRule[];
  addExtensionRule: (rule: Omit<TrialExtensionRule, 'id'>) => void;
  extensions: TrialExtension[];
}

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
};

export const useTrialStore = create<TrialState>()(
  persist(
    (set, get) => ({
      trialConfigs: [],
      abTestAssignments: [],
      conversionFunnel: [],
      trialReminders: [],
      isLoading: false,
      error: null,
      extensionRules: [],
      extensions: [],

      createTrialConfig: async (config) => {
        set({ isLoading: true, error: null });
        try {
          const now = new Date();
          const trialConfig: TrialConfig = {
            ...config,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
          };
          set((state) => ({
            trialConfigs: [...state.trialConfigs, trialConfig],
            isLoading: false,
          }));
          return trialConfig;
        } catch (error) {
          set({ error: 'Failed to create trial config', isLoading: false });
          throw error;
        }
      },

      updateTrialConfig: async (id, updates) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            trialConfigs: state.trialConfigs.map((tc) =>
              tc.id === id ? { ...tc, ...updates, updatedAt: new Date() } : tc
            ),
            isLoading: false,
          }));
        } catch (error) {
          set({ error: 'Failed to update trial config', isLoading: false });
          throw error;
        }
      },

      assignABTest: async (assignment) => {
        set({ isLoading: true, error: null });
        try {
          const abTestAssignment: ABTestAssignment = {
            ...assignment,
            id: generateId(),
            assignedAt: new Date(),
          };
          set((state) => ({
            abTestAssignments: [...state.abTestAssignments, abTestAssignment],
            isLoading: false,
          }));
          return abTestAssignment;
        } catch (error) {
          set({ error: 'Failed to assign A/B test', isLoading: false });
          throw error;
        }
      },

      recordFunnelEvent: async (event) => {
        set({ isLoading: true, error: null });
        try {
          const funnelEvent: ConversionFunnelEvent = {
            ...event,
            id: generateId(),
            timestamp: new Date(),
          };
          set((state) => ({
            conversionFunnel: [...state.conversionFunnel, funnelEvent],
            isLoading: false,
          }));
          return funnelEvent;
        } catch (error) {
          set({ error: 'Failed to record funnel event', isLoading: false });
          throw error;
        }
      },

      scheduleReminder: async (schedule) => {
        set({ isLoading: true, error: null });
        try {
          const reminderSchedule: TrialReminderSchedule = {
            ...schedule,
            id: generateId(),
            createdAt: new Date(),
          };
          set((state) => ({
            trialReminders: [...state.trialReminders, reminderSchedule],
            isLoading: false,
          }));
          return reminderSchedule;
        } catch (error) {
          set({ error: 'Failed to schedule reminder', isLoading: false });
          throw error;
        }
      },

      convertTrial: async (trialId) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            trialConfigs: state.trialConfigs.map((tc) =>
              tc.id === trialId
                ? {
                    ...tc,
                    status: TrialStatus.CONVERTED,
                    convertedAt: new Date(),
                    updatedAt: new Date(),
                  }
                : tc
            ),
            isLoading: false,
          }));
        } catch (error) {
          set({ error: 'Failed to convert trial', isLoading: false });
          throw error;
        }
      },

      expireTrial: async (trialId) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            trialConfigs: state.trialConfigs.map((tc) =>
              tc.id === trialId ? { ...tc, status: TrialStatus.EXPIRED, updatedAt: new Date() } : tc
            ),
            isLoading: false,
          }));
        } catch (error) {
          set({ error: 'Failed to expire trial', isLoading: false });
          throw error;
        }
      },

      startTrial: async (subscriptionId, duration) => {
        set({ isLoading: true, error: null });
        try {
          const now = new Date();
          const endDate = new Date(now);
          switch (duration) {
            case TrialDuration.SEVEN_DAYS:
              endDate.setDate(endDate.getDate() + 7);
              break;
            case TrialDuration.FOURTEEN_DAYS:
              endDate.setDate(endDate.getDate() + 14);
              break;
            case TrialDuration.TWENTY_ONE_DAYS:
              endDate.setDate(endDate.getDate() + 21);
              break;
            case TrialDuration.THIRTY_DAYS:
              endDate.setDate(endDate.getDate() + 30);
              break;
          }
          const trialConfig: TrialConfig = {
            id: generateId(),
            subscriptionId,
            duration,
            featureAccess: 'full' as any,
            paymentRequirement: 'required' as any,
            status: TrialStatus.ACTIVE,
            startDate: now,
            endDate,
            createdAt: now,
            updatedAt: now,
          };
          set((state) => ({
            trialConfigs: [...state.trialConfigs, trialConfig],
            isLoading: false,
          }));
          return trialConfig;
        } catch (error) {
          set({ error: 'Failed to start trial', isLoading: false });
          throw error;
        }
      },

      extendTrial: async (trialId, ruleId) => {
        set({ isLoading: true, error: null });
        try {
          const state = get();
          const trialConfig = state.trialConfigs.find((tc) => tc.id === trialId);
          if (!trialConfig) {
            throw new Error('Trial config not found');
          }
          if (trialConfig.status !== TrialStatus.ACTIVE) {
            throw new Error('Can only extend active trials');
          }

          const rule = state.extensionRules.find((r) => r.id === ruleId);
          if (!rule) {
            throw new Error('Extension rule not found');
          }

          const existingExtensions = state.extensions.filter(
            (e) => e.trialConfigId === trialId && e.ruleId === ruleId
          );
          if (existingExtensions.length >= rule.maxExtensions) {
            throw new Error('Maximum extensions reached for this rule');
          }

          const previousEndDate = trialConfig.endDate ? new Date(trialConfig.endDate) : new Date();
          const newEndDate = new Date(previousEndDate);
          newEndDate.setDate(newEndDate.getDate() + rule.extensionDurationDays);

          const extension: TrialExtension = {
            id: generateId(),
            trialConfigId: trialId,
            ruleId,
            extendedAt: new Date(),
            previousEndDate,
            newEndDate,
            extensionCount: existingExtensions.length + 1,
          };

          set((state) => ({
            extensions: [...state.extensions, extension],
            trialConfigs: state.trialConfigs.map((tc) =>
              tc.id === trialId ? { ...tc, endDate: newEndDate, updatedAt: new Date() } : tc
            ),
            isLoading: false,
          }));
        } catch (error) {
          set({ error: (error as Error).message || 'Failed to extend trial', isLoading: false });
          throw error;
        }
      },

      addExtensionRule: (rule) => {
        const newRule: TrialExtensionRule = {
          ...rule,
          id: generateId(),
        };
        set((state) => ({
          extensionRules: [...state.extensionRules, newRule],
        }));
      },

      autoConvertEligibleTrials: async () => {
        set({ isLoading: true, error: null });
        try {
          const state = get();
          const now = new Date();
          const expiredTrials = state.trialConfigs.filter(
            (tc) => tc.status === TrialStatus.ACTIVE && tc.endDate && new Date(tc.endDate) < now
          );
          for (const trial of expiredTrials) {
            await get().expireTrial(trial.id);
          }
          set({ isLoading: false });
        } catch (error) {
          set({ error: 'Failed to auto-convert eligible trials', isLoading: false });
          throw error;
        }
      },

      getTrialAnalytics: (): TrialAnalytics => {
        const state = get();
        const { trialConfigs, conversionFunnel, extensions } = state;

        const totalTrials = trialConfigs.length;
        const activeTrials = trialConfigs.filter((tc) => tc.status === TrialStatus.ACTIVE).length;
        const convertedTrials = trialConfigs.filter(
          (tc) => tc.status === TrialStatus.CONVERTED
        ).length;
        const expiredTrials = trialConfigs.filter((tc) => tc.status === TrialStatus.EXPIRED).length;
        const cancelledTrials = trialConfigs.filter(
          (tc) => tc.status === TrialStatus.CANCELLED
        ).length;
        const conversionRate = totalTrials > 0 ? convertedTrials / totalTrials : 0;

        let avgTimeToConvert = 0;
        const convertedConfigs = trialConfigs.filter(
          (tc) => tc.status === TrialStatus.CONVERTED && tc.startDate && tc.convertedAt
        );
        if (convertedConfigs.length > 0) {
          const totalTime = convertedConfigs.reduce((sum, tc) => {
            const start = new Date(tc.startDate!).getTime();
            const converted = new Date(tc.convertedAt!).getTime();
            return sum + (converted - start);
          }, 0);
          avgTimeToConvert = totalTime / convertedConfigs.length / (1000 * 60 * 60 * 24);
        }

        let avgTimeToExpire = 0;
        const expiredConfigs = trialConfigs.filter(
          (tc) => tc.status === TrialStatus.EXPIRED && tc.startDate && tc.endDate
        );
        if (expiredConfigs.length > 0) {
          const totalTime = expiredConfigs.reduce((sum, tc) => {
            const start = new Date(tc.startDate!).getTime();
            const end = new Date(tc.endDate!).getTime();
            return sum + (end - start);
          }, 0);
          avgTimeToExpire = totalTime / expiredConfigs.length / (1000 * 60 * 60 * 24);
        }

        const funnelStepRates: Record<string, number> = {};
        const eventCounts: Record<string, number> = {};
        conversionFunnel.forEach((event) => {
          eventCounts[event.eventType] = (eventCounts[event.eventType] || 0) + 1;
        });
        const startedCount = eventCounts['trial_started'] || 1;
        Object.entries(eventCounts).forEach(([step, count]) => {
          funnelStepRates[step] = count / startedCount;
        });

        const variantStats: Record<
          string,
          { trials: number; conversions: number; conversionRate: number }
        > = {};
        trialConfigs.forEach((tc) => {
          const abId = tc.abTestId || 'default';
          if (!variantStats[abId]) {
            variantStats[abId] = { trials: 0, conversions: 0, conversionRate: 0 };
          }
          variantStats[abId].trials += 1;
          if (tc.status === TrialStatus.CONVERTED) {
            variantStats[abId].conversions += 1;
          }
        });
        Object.values(variantStats).forEach((v) => {
          v.conversionRate = v.trials > 0 ? v.conversions / v.trials : 0;
        });

        const dailyMap: Record<string, number> = {};
        trialConfigs
          .filter((tc) => tc.status === TrialStatus.CONVERTED && tc.convertedAt)
          .forEach((tc) => {
            const date = new Date(tc.convertedAt!).toISOString().split('T')[0];
            dailyMap[date] = (dailyMap[date] || 0) + 1;
          });
        const dailyConversions = Object.entries(dailyMap)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const funnelSteps = [
          'trial_started',
          'feature_accessed',
          'dashboard_visited',
          'payment_clicked',
          'payment_completed',
          'trial_converted',
        ];
        const dropOffPoints: Array<{ step: string; dropOffRate: number }> = [];
        for (let i = 1; i < funnelSteps.length; i++) {
          const prevRate = funnelStepRates[funnelSteps[i - 1]] || 1;
          const currRate = funnelStepRates[funnelSteps[i]] || 0;
          dropOffPoints.push({
            step: `${funnelSteps[i - 1]} → ${funnelSteps[i]}`,
            dropOffRate: prevRate > 0 ? 1 - currRate / prevRate : 0,
          });
        }

        return {
          totalTrials,
          activeTrials,
          convertedTrials,
          expiredTrials,
          cancelledTrials,
          conversionRate,
          avgTimeToConvert,
          avgTimeToExpire,
          extensionCount: extensions.length,
          funnelStepRates,
          variantStats,
          dailyConversions,
          dropOffPoints,
        };
      },

      getConversionStats: (abTestId?: string) => {
        const configs = get().trialConfigs;
        const filtered = abTestId ? configs.filter((tc) => tc.abTestId === abTestId) : configs;
        const totalTrials = filtered.length;
        const convertedTrials = filtered.filter((tc) => tc.status === TrialStatus.CONVERTED).length;
        const conversionRate = totalTrials > 0 ? convertedTrials / totalTrials : 0;
        return { totalTrials, convertedTrials, conversionRate };
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => debouncedAsyncStorageAdapter),
    }
  )
);
