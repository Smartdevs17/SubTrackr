import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import {
  TrialConfig,
  ABTestAssignment,
  ConversionFunnelEvent,
  TrialReminderSchedule,
  TrialReminder,
  TrialStatus,
  TrialDuration,
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

  createTrialConfig: (config: Omit<TrialConfig, 'id' | 'createdAt' | 'updatedAt'>) => Promise<TrialConfig>;
  updateTrialConfig: (id: string, updates: Partial<TrialConfig>) => Promise<void>;
  assignABTest: (assignment: Omit<ABTestAssignment, 'id' | 'assignedAt'>) => Promise<ABTestAssignment>;
  recordFunnelEvent: (event: Omit<ConversionFunnelEvent, 'id' | 'timestamp'>) => Promise<ConversionFunnelEvent>;
  scheduleReminder: (schedule: Omit<TrialReminderSchedule, 'id' | 'createdAt'>) => Promise<TrialReminderSchedule>;
  convertTrial: (trialId: string) => Promise<void>;
  expireTrial: (trialId: string) => Promise<void>;
  getConversionStats: (abTestId?: string) => {
    totalTrials: number;
    convertedTrials: number;
    conversionRate: number;
  };
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
                ? { ...tc, status: TrialStatus.CONVERTED, convertedAt: new Date(), updatedAt: new Date() }
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
              tc.id === trialId
                ? { ...tc, status: TrialStatus.EXPIRED, updatedAt: new Date() }
                : tc
            ),
            isLoading: false,
          }));
        } catch (error) {
          set({ error: 'Failed to expire trial', isLoading: false });
          throw error;
        }
      },

      getConversionStats: (abTestId?: string) => {
        const configs = get().trialConfigs;
        const filtered = abTestId
          ? configs.filter((tc) => tc.abTestId === abTestId)
          : configs;
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
