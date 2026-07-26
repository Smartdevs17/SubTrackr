import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { UsageRecord, Quota, QuotaMetric, QuotaStatus, getDefaultQuotas } from '../types/usage';
import { errorHandler } from '../services/errorHandler';

export interface MeterConsumption {
  metric: QuotaMetric;
  current: number;
  limit: number;
  status: QuotaStatus;
  percentage: number;
}

interface UsageState {
  records: Record<string, UsageRecord[]>; // subscriptionId -> records
  quotas: Record<string, Quota[]>; // planId -> quotas
  subscriptionPlans: Record<string, string>; // subscriptionId -> planId
  isLoading: boolean;
  error: string | null;

  fetchUsage: (subscriptionId: string, planId: string) => Promise<void>;
  recordUsage: (subscriptionId: string, metric: QuotaMetric, amount: number) => Promise<void>;
  getQuotaStatus: (subscriptionId: string, metric: QuotaMetric) => QuotaStatus;
  getQuotaForMetric: (
    subscriptionId: string,
    planId: string,
    metric: QuotaMetric
  ) => Quota | undefined;
  getCurrentPeriodConsumption: (subscriptionId: string, planId: string) => MeterConsumption[];
}

export const useUsageStore = create<UsageState>()(
  persist(
    (set, get) => ({
      records: {},
      quotas: {},
      subscriptionPlans: {},
      isLoading: false,
      error: null,

      fetchUsage: async (subscriptionId, planId) => {
        set({ isLoading: true, error: null });
        try {
          // In a real app, this would call the Soroban metering contract.
          // We still seed default quotas for the plan so the dashboard and
          // threshold checks have real limits to work against.
          set((state) => ({
            quotas: state.quotas[planId]
              ? state.quotas
              : { ...state.quotas, [planId]: getDefaultQuotas(planId) },
            records: state.records[subscriptionId]
              ? state.records
              : { ...state.records, [subscriptionId]: [] },
            subscriptionPlans: { ...state.subscriptionPlans, [subscriptionId]: planId },
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'fetchUsage',
            metadata: { subscriptionId, planId },
          });
          set({ error: appError.userMessage, isLoading: false });
        }
      },

      recordUsage: async (subscriptionId, metric, amount) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate contract call
          set((state) => {
            const currentRecords = state.records[subscriptionId] || [];
            const recordIdx = currentRecords.findIndex((r) => r.metric === metric);

            let updatedRecords;
            if (recordIdx > -1) {
              updatedRecords = [...currentRecords];
              updatedRecords[recordIdx] = {
                ...updatedRecords[recordIdx],
                currentUsage: updatedRecords[recordIdx].currentUsage + amount,
              };
            } else {
              updatedRecords = [
                ...currentRecords,
                {
                  subscriptionId,
                  metric,
                  currentUsage: amount,
                  periodStart: new Date(),
                  rolloverBalance: 0,
                },
              ];
            }

            return {
              records: { ...state.records, [subscriptionId]: updatedRecords },
              isLoading: false,
            };
          });
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'recordUsage',
            metadata: { subscriptionId, metric, amount },
          });
          set({ error: appError.userMessage, isLoading: false });
        }
      },

      getQuotaStatus: (subscriptionId, metric) => {
        const records = get().records[subscriptionId] || [];
        const record = records.find((r) => r.metric === metric);
        if (!record) return QuotaStatus.WITHIN_LIMIT;

        const planId = get().subscriptionPlans[subscriptionId];
        const quotas = planId ? (get().quotas[planId] ?? getDefaultQuotas(planId)) : [];
        const limit = quotas.find((q) => q.metric === metric)?.limit ?? Infinity;
        const usage = record.currentUsage;

        if (usage >= limit) return QuotaStatus.HARD_LIMIT_REACHED;
        if (usage >= limit * 0.8) return QuotaStatus.SOFT_LIMIT_REACHED;
        return QuotaStatus.WITHIN_LIMIT;
      },

      getQuotaForMetric: (_subscriptionId, planId, metric) => {
        const quotas = get().quotas[planId] ?? getDefaultQuotas(planId);
        return quotas.find((q) => q.metric === metric);
      },

      getCurrentPeriodConsumption: (subscriptionId, planId) => {
        const records = get().records[subscriptionId] || [];
        const quotas = get().quotas[planId] ?? getDefaultQuotas(planId);

        return quotas.map((quota) => {
          const record = records.find((r) => r.metric === quota.metric);
          const current = record?.currentUsage ?? 0;
          const percentage =
            quota.limit > 0 ? Math.min(100, Math.round((current / quota.limit) * 100)) : 0;

          let status = QuotaStatus.WITHIN_LIMIT;
          if (current >= quota.limit) status = QuotaStatus.HARD_LIMIT_REACHED;
          else if (current >= quota.limit * 0.8) status = QuotaStatus.SOFT_LIMIT_REACHED;

          return { metric: quota.metric, current, limit: quota.limit, status, percentage };
        });
      },
    }),
    {
      name: 'subtrackr-usage-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
