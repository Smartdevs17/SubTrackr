import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import type {
  Partner,
  SplitConfiguration,
  PayoutRecord,
  SplitExecution,
  PartnerEarnings,
  PartnerStatus,
  SplitType,
  PartnerPayoutSchedule,
} from '../types/partner';
import { errorHandler, AppError } from '../services/errorHandler';
import { partnerService } from '../services/partnerService';

const STORAGE_KEY = 'subtrackr-partners';

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

interface PartnerState {
  partners: Partner[];
  splitConfigurations: SplitConfiguration[];
  payoutRecords: PayoutRecord[];
  splitExecutions: SplitExecution[];
  isLoading: boolean;
  error: AppError | null;

  onboardPartner: (
    data: Omit<Partner, 'id' | 'createdAt' | 'updatedAt' | 'onboardedAt'>
  ) => Promise<Partner>;
  updatePartner: (id: string, data: Partial<Partner>) => Promise<void>;
  verifyPartner: (id: string) => Promise<void>;
  rejectPartner: (id: string, reason: string) => Promise<void>;
  suspendPartner: (id: string) => Promise<void>;
  reactivatePartner: (id: string) => Promise<void>;
  configureSplit: (
    data: Omit<SplitConfiguration, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<SplitConfiguration>;
  updateSplitConfiguration: (id: string, data: Partial<SplitConfiguration>) => Promise<void>;
  executeSplit: (
    splitConfigurationId: string,
    transactionId: string,
    grossAmount: number
  ) => Promise<SplitExecution>;
  recordPayout: (data: Omit<PayoutRecord, 'id' | 'createdAt'>) => Promise<PayoutRecord>;
  getPartnerEarnings: (partnerId: string, startDate?: Date, endDate?: Date) => PartnerEarnings;
  getPartnerPayouts: (partnerId: string) => PayoutRecord[];
  getSubscriptionSplits: (subscriptionId: string) => SplitConfiguration[];
  deleteSplitConfiguration: (id: string) => Promise<void>;
}

export const usePartnerStore = create<PartnerState>()(
  persist(
    (set, get) => ({
      partners: [],
      splitConfigurations: [],
      payoutRecords: [],
      splitExecutions: [],
      isLoading: false,
      error: null,

      onboardPartner: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const partner: Partner = {
            ...data,
            id: generateUniqueId(),
            onboardedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          set((state) => ({
            partners: [...state.partners, partner],
            isLoading: false,
          }));
          return partner;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'onboardPartner',
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },

      updatePartner: async (id, data) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            partners: state.partners.map((p) =>
              p.id === id ? { ...p, ...data, updatedAt: new Date() } : p
            ),
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'updatePartner',
            partnerId: id,
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },

      verifyPartner: async (id) => {
        await get().updatePartner(id, {
          status: 'verified' as PartnerStatus,
          verifiedAt: new Date(),
        });
      },

      rejectPartner: async (id, reason) => {
        await get().updatePartner(id, {
          status: 'rejected' as PartnerStatus,
          rejectionReason: reason,
          suspendedAt: new Date(),
        });
      },

      suspendPartner: async (id) => {
        await get().updatePartner(id, {
          status: 'suspended' as PartnerStatus,
          suspendedAt: new Date(),
        });
      },

      reactivatePartner: async (id) => {
        await get().updatePartner(id, {
          status: 'verified' as PartnerStatus,
          suspendedAt: undefined,
          rejectionReason: undefined,
        });
      },

      configureSplit: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const validation = partnerService.validateSplitConfig(data);
          if (!validation.isValid) {
            throw new Error(`Invalid split configuration: ${validation.errors.join(', ')}`);
          }

          const config: SplitConfiguration = {
            ...data,
            id: generateUniqueId(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          set((state) => ({
            splitConfigurations: [...state.splitConfigurations, config],
            isLoading: false,
          }));
          return config;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'configureSplit',
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },

      updateSplitConfiguration: async (id, data) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            splitConfigurations: state.splitConfigurations.map((c) =>
              c.id === id ? { ...c, ...data, updatedAt: new Date() } : c
            ),
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'updateSplitConfiguration',
            splitConfigurationId: id,
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },

      executeSplit: async (splitConfigurationId, transactionId, grossAmount) => {
        set({ isLoading: true, error: null });
        try {
          const config = get().splitConfigurations.find((c) => c.id === splitConfigurationId);
          if (!config) {
            throw new Error('Split configuration not found');
          }

          const result = partnerService.calculateSplit(config, grossAmount);
          const execution: SplitExecution = {
            id: generateUniqueId(),
            splitConfigurationId,
            subscriptionId: config.subscriptionId,
            transactionId,
            grossAmount,
            splits: result.splits,
            platformRevenue: result.platformRevenue,
            executedAt: new Date(),
            status: 'completed',
          };

          set((state) => ({
            splitExecutions: [...state.splitExecutions, execution],
            isLoading: false,
          }));

          return execution;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'executeSplit',
            splitConfigurationId,
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },

      recordPayout: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const record: PayoutRecord = {
            ...data,
            id: generateUniqueId(),
            createdAt: new Date(),
          };
          set((state) => ({
            payoutRecords: [...state.payoutRecords, record],
            isLoading: false,
          }));
          return record;
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'recordPayout',
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },

      getPartnerEarnings: (partnerId, startDate, endDate) => {
        const payouts = get().payoutRecords.filter((p) => p.partnerId === partnerId);
        const start = startDate ?? new Date(0);
        const end = endDate ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

        const filtered = payouts.filter((p) => {
          const createdAt = new Date(p.createdAt);
          return createdAt >= start && createdAt <= end && p.status === 'completed';
        });

        const totalEarnings = filtered.reduce((sum, p) => sum + p.netAmount, 0);
        const pendingPayouts = payouts
          .filter((p) => p.status === 'pending')
          .reduce((sum, p) => sum + p.netAmount, 0);
        const completedPayouts = filtered.reduce((sum, p) => sum + p.netAmount, 0);

        const bySubscription: Record<string, number> = {};
        filtered.forEach((p) => {
          bySubscription[p.subscriptionId] = (bySubscription[p.subscriptionId] || 0) + p.netAmount;
        });

        return {
          partnerId,
          totalEarnings,
          pendingPayouts,
          completedPayouts,
          currency: filtered[0]?.currency ?? 'USD',
          periodStart: start,
          periodEnd: end,
          bySubscription,
        };
      },

      getPartnerPayouts: (partnerId) => {
        return get()
          .payoutRecords.filter((p) => p.partnerId === partnerId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      },

      getSubscriptionSplits: (subscriptionId) => {
        return get().splitConfigurations.filter((c) => c.subscriptionId === subscriptionId);
      },

      deleteSplitConfiguration: async (id) => {
        set({ isLoading: true, error: null });
        try {
          set((state) => ({
            splitConfigurations: state.splitConfigurations.filter((c) => c.id !== id),
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'deleteSplitConfiguration',
            splitConfigurationId: id,
          });
          set({ error: appError, isLoading: false });
          throw appError;
        }
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => debouncedAsyncStorageAdapter),
      partialize: (state) => ({
        partners: state.partners,
        splitConfigurations: state.splitConfigurations,
        payoutRecords: state.payoutRecords,
        splitExecutions: state.splitExecutions,
      }),
    }
  )
);
