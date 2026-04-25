import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UsageRecord, Quota, QuotaMetric, QuotaStatus, UsageReport } from '../types/usage';
import { errorHandler } from '../services/errorHandler';

interface UsageState {
  records: Record<string, UsageRecord[]>; // subscriptionId -> records
  quotas: Record<string, Quota[]>; // planId -> quotas
  isLoading: boolean;
  error: string | null;

  fetchUsage: (subscriptionId: string, planId: string) => Promise<void>;
  recordUsage: (subscriptionId: string, metric: QuotaMetric, amount: number) => Promise<void>;
  getQuotaStatus: (subscriptionId: string, metric: QuotaMetric) => QuotaStatus;
}

export const useUsageStore = create<UsageState>()(
  persist(
    (set, get) => ({
      records: {},
      quotas: {},
      isLoading: false,
      error: null,

      fetchUsage: async (subscriptionId, planId) => {
        set({ isLoading: true, error: null });
        try {
          // In a real app, this would call the Soroban contract
          // For this implementation, we simulate fetching/caching
          
          // const response = await sorobanService.getUsage(subscriptionId);
          // set((state) => ({ 
          //   records: { ...state.records, [subscriptionId]: response } 
          // }));
          
          set({ isLoading: false });
        } catch (error) {
          const appError = errorHandler.handle(error);
          set({ error: appError.userMessage, isLoading: false });
        }
      },

      recordUsage: async (subscriptionId, metric, amount) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate contract call
          set((state) => {
            const currentRecords = state.records[subscriptionId] || [];
            const recordIdx = currentRecords.findIndex(r => r.metric === metric);
            
            let updatedRecords;
            if (recordIdx > -1) {
              updatedRecords = [...currentRecords];
              updatedRecords[recordIdx] = {
                ...updatedRecords[recordIdx],
                currentUsage: updatedRecords[recordIdx].currentUsage + amount,
              };
            } else {
              updatedRecords = [...currentRecords, {
                subscriptionId,
                metric,
                currentUsage: amount,
                periodStart: new Date(),
                rolloverBalance: 0,
              }];
            }

            return {
              records: { ...state.records, [subscriptionId]: updatedRecords },
              isLoading: false,
            };
          });
        } catch (error) {
          const appError = errorHandler.handle(error);
          set({ error: appError.userMessage, isLoading: false });
        }
      },

      getQuotaStatus: (subscriptionId, metric) => {
        const records = get().records[subscriptionId] || [];
        const record = records.find(r => r.metric === metric);
        if (!record) return QuotaStatus.WITHIN_LIMIT;

        // Simplified check (we should fetch plan quotas too)
        // For demonstration, let's assume some defaults if not found
        const limit = 1000; // Default limit for demo
        const usage = record.currentUsage;

        if (usage >= limit) return QuotaStatus.HARD_LIMIT_REACHED;
        if (usage >= limit * 0.8) return QuotaStatus.SOFT_LIMIT_REACHED;
        return QuotaStatus.WITHIN_LIMIT;
      },
    }),
    {
      name: 'subtrackr-usage-store',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
