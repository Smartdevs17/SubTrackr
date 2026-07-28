import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import {
  SubscriptionMetadata,
  CRDTSubscriptionState,
  SubscriptionCRDT,
} from '../services/cache/crdt';
import { networkMonitor } from '../services/network/networkMonitor';
import {
  Subscription,
  SubscriptionFormData,
  SubscriptionStats,
  SubscriptionCategory,
  BillingCycle,
  ChainSpendBreakdown,
  CrossChainTransfer,
  UnifiedSubscriptionFilter,
} from '../types/subscription';
import { ChainType } from '../types/wallet';
import { dummySubscriptions } from '../utils/dummyData';
import { advanceBillingDate } from '../utils/billingDate';
import { buildBillingPeriod } from '../utils/invoice';
import { BILLING_CONVERSIONS } from '../utils/constants/values';
import {
  syncRenewalReminders,
  presentChargeSuccessNotification,
  presentChargeFailedNotification,
  presentDunningRetryNotification,
  presentDunningWarningNotification,
  presentDunningSuspendedNotification,
  presentDunningCancelledNotification,
  presentDunningRecoveryNotification,
} from '../services/notificationService';
import { useCalendarStore } from './calendarStore';
import { useGamificationStore } from './gamificationStore';
import { useInvoiceStore } from './invoiceStore';
import { AchievementTrigger } from '../types/gamification';
import { errorHandler, AppError } from '../services/errorHandler';
import { useSettingsStore } from './settingsStore';
import { currencyService } from '../services/currencyService';
import { useSupportStore } from './supportStore';
import { buildSupportEventMessage } from '../services/ticketingService';
import { SubscriptionSupportContext, TicketIssueType } from '../types/support';
import {
  previewProration,
  generateCreditMemo,
  applyCreditMemo,
  ProrationPreview,
  CreditMemo,
} from '../utils/proration';
import { crossChainRoutingService } from '../services/crossChainRoutingService';
import { crossChainNotificationService } from '../services/crossChainNotificationService';

const STORAGE_KEY = 'subtrackr-subscriptions';
const STORE_VERSION = 2;

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

const toValidDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};

const normalizeSubscription = (raw: Partial<Subscription>): Subscription => {
  const now = new Date();
  return {
    id: raw.id ?? generateUniqueId(),
    name: raw.name ?? 'Untitled',
    description: raw.description,
    category: raw.category ?? SubscriptionCategory.OTHER,
    price: Number.isFinite(raw.price) ? (raw.price as number) : 0,
    currency: raw.currency ?? 'USD',
    billingCycle: raw.billingCycle ?? BillingCycle.MONTHLY,
    nextBillingDate: toValidDate(raw.nextBillingDate, now),
    isActive: raw.isActive ?? true,
    notificationsEnabled: raw.notificationsEnabled ?? true,
    isCryptoEnabled: raw.isCryptoEnabled ?? false,
    cryptoStreamId: raw.cryptoStreamId,
    cryptoToken: raw.cryptoToken,
    cryptoAmount: raw.cryptoAmount,
    chainType: raw.chainType ?? ChainType.EVM,
    chainId: raw.chainId ?? 1,
    crossChainTransfer: raw.crossChainTransfer,
    billingAggregationId: raw.billingAggregationId,
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
  };
};

const buildSupportContext = (
  subscription: Subscription,
  history: string[]
): SubscriptionSupportContext => ({
  subscriptionName: subscription.name,
  planName: subscription.name,
  planTier: subscription.category,
  billingCycle: subscription.billingCycle,
  status: subscription.isActive ? 'active' : 'paused',
  amount: subscription.price,
  currency: subscription.currency,
  createdAt: subscription.createdAt.toISOString(),
  nextBillingDate:
    subscription.nextBillingDate?.toISOString?.() ??
    new Date(subscription.nextBillingDate).toISOString(),
  failedPayments: subscription.chargeCount ? Math.max(subscription.chargeCount - 1, 0) : 0,
  chargeCount: subscription.chargeCount ?? 0,
  history,
});

const createSupportEvent = (
  subscription: Subscription,
  issueType: TicketIssueType,
  history: string[],
  actorId = 'system'
) => {
  const context = buildSupportContext(subscription, history);
  return {
    subscriptionId: subscription.id,
    issueType,
    message: buildSupportEventMessage(context, issueType),
    occurredAt: new Date(),
    context,
    dedupeKey: `${subscription.id}:${issueType}`,
    actorId,
  };
};

export type ProrationEffectiveType = 'immediate' | 'end_of_period' | 'custom_date';

export interface SubscriptionChange {
  id: string;
  subscriptionId: string;
  fromPrice: number;
  toPrice: number;
  effectiveType: ProrationEffectiveType;
  status: 'pending' | 'executed' | 'rejected';
  proration: ProrationPreview;
  createdAt: Date;
  newPlanData: Partial<Subscription>;
}

export interface PauseRecord {
  id: string;
  subscriptionId: string;
  pausedAt: Date;
  resumeAt?: Date;
  plannedResumeDate?: Date;
  reason?: string;
  billingAdjustment: number;
  status: 'active' | 'resumed' | 'expired';
}

export interface PauseAnalytics {
  totalPauses: number;
  totalResumes: number;
  pauseRate: number;
  resumeRate: number;
  averagePauseDurationDays: number;
  activePauses: number;
  totalBillingAdjusted: number;
}

interface SubscriptionState {
  subscriptions: Subscription[];
  stats: SubscriptionStats;
  isLoading: boolean;
  error: AppError | null;
  prorationPreview: ProrationPreview | null;
  creditMemos: Record<string, CreditMemo>;
  planChanges: SubscriptionChange[];
  pauseRecords: PauseRecord[];
  pauseAnalytics: PauseAnalytics;

  // Multi-chain filter
  chainFilter: UnifiedSubscriptionFilter;

  // Offline-first & CRDT Sync
  syncStatus: 'idle' | 'pending' | 'syncing' | 'conflict' | 'error';
  crdtMetadata: Record<string, SubscriptionMetadata>;
  syncWithServer: () => Promise<void>;
  setSyncStatus: (status: 'idle' | 'pending' | 'syncing' | 'conflict' | 'error') => void;

  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  previewPlanChange: (
    id: string,
    newPrice: number,
    effectiveDate: 'immediate' | 'end_of_period'
  ) => ProrationPreview;
  executePlanChange: (
    id: string,
    newPlanData: Partial<Subscription>,
    effectiveDate: 'immediate' | 'end_of_period'
  ) => Promise<void>;
  applyCreditToSubscription: (id: string) => Promise<void>;
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;
  queuePlanChange: (
    id: string,
    newPlanData: Partial<Subscription>,
    effectiveDate: ProrationEffectiveType
  ) => void;
  approvePlanChange: (changeId: string) => Promise<void>;
  rejectPlanChange: (changeId: string) => void;
  getChangeHistory: (subscriptionId: string) => SubscriptionChange[];

  // Multi-chain actions
  setChainFilter: (filter: UnifiedSubscriptionFilter) => void;
  getFilteredSubscriptions: () => Subscription[];
  initiateCrossChainTransfer: (
    id: string,
    targetChainType: ChainType,
    targetChainId: number
  ) => Promise<void>;
  approveCrossChainTransfer: (id: string) => Promise<void>;
  getSubscriptionsByChain: (chainType: ChainType) => Subscription[];
  aggregateCrossChainBilling: () => Promise<{
    totalInPreferredCurrency: number;
    chainBreakdown: Record<string, number>;
    conversionRates: Record<string, number>;
  }>;
  pauseSubscription: (id: string, durationDays: number, reason?: string) => void;
  resumeSubscription: (id: string) => void;
  getPauseHistory: (subscriptionId: string) => PauseRecord[];
  calculatePauseAnalytics: (subscriptionId?: string) => PauseAnalytics;
}

type PersistedSubscriptionSlice = Pick<
  SubscriptionState,
  'subscriptions' | 'planChanges' | 'crdtMetadata' | 'syncStatus'
>;

const serializeForStorage = (state: PersistedSubscriptionSlice): PersistedSubscriptionSlice => ({
  subscriptions: (state.subscriptions || []).map((sub) => ({
    ...sub,
    nextBillingDate: new Date(sub.nextBillingDate),
    createdAt: new Date(sub.createdAt),
    updatedAt: new Date(sub.updatedAt),
  })),
  planChanges: (state.planChanges || []).map((change) => ({
    ...change,
    createdAt: new Date(change.createdAt),
  })),
  crdtMetadata: state.crdtMetadata || {},
  syncStatus: state.syncStatus || 'idle',
});

const migratePersistedState = (
  persisted: unknown,
  _version: number
): PersistedSubscriptionSlice => {
  if (!persisted || typeof persisted !== 'object') {
    return { subscriptions: [], planChanges: [], crdtMetadata: {}, syncStatus: 'idle' };
  }

  const maybeState = persisted as Partial<PersistedSubscriptionSlice>;
  const subscriptions = Array.isArray(maybeState.subscriptions)
    ? maybeState.subscriptions.map((entry) => normalizeSubscription(entry as Partial<Subscription>))
    : [];

  const planChanges = Array.isArray(maybeState.planChanges)
    ? maybeState.planChanges.map((entry) => ({
        ...entry,
        createdAt: new Date(entry.createdAt),
      }))
    : [];

  const crdtMetadata = maybeState.crdtMetadata || {};
  const syncStatus = maybeState.syncStatus || 'idle';

  return { subscriptions, planChanges, crdtMetadata, syncStatus };
};

async function mockSyncApiCall(localState: CRDTSubscriptionState): Promise<CRDTSubscriptionState> {
  await new Promise((resolve) => setTimeout(resolve, 300));

  const serverStateRaw = await AsyncStorage.getItem('subtrackr-server-db');
  const serverState: CRDTSubscriptionState = serverStateRaw
    ? JSON.parse(serverStateRaw)
    : { subscriptions: {}, metadata: {} };

  const mergedServerState = SubscriptionCRDT.merge(serverState, localState);
  await AsyncStorage.setItem('subtrackr-server-db', JSON.stringify(mergedServerState));

  return mergedServerState;
}

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      subscriptions: dummySubscriptions.map((s) => ({
        ...s,
        chainType: (s as any).chainType ?? ChainType.EVM,
        chainId: (s as any).chainId ?? 1,
      })),
      stats: {
        totalActive: 0,
        totalMonthlySpend: 0,
        totalYearlySpend: 0,
        categoryBreakdown: {} as Record<SubscriptionCategory, number>,
        chainBreakdown: { stellar: 0, evm: {} },
        crossChainTotalMonthlySpend: 0,
        crossChainTotalYearlySpend: 0,
      } as SubscriptionStats,
      isLoading: true,
      error: null,
      prorationPreview: null,
      creditMemos: {},
      planChanges: [],
      chainFilter: {},

      syncStatus: 'idle',
      crdtMetadata: {},

      pauseRecords: [],
      pauseAnalytics: {
        totalPauses: 0,
        totalResumes: 0,
        pauseRate: 0,
        resumeRate: 0,
        averagePauseDurationDays: 0,
        activePauses: 0,
        totalBillingAdjusted: 0,
      },

      setSyncStatus: (status) => set({ syncStatus: status }),

      setChainFilter: (filter: UnifiedSubscriptionFilter) => set({ chainFilter: filter }),

      getFilteredSubscriptions: () => {
        const { subscriptions, chainFilter } = get();
        if (!chainFilter || Object.keys(chainFilter).length === 0) return subscriptions;

        return subscriptions.filter((sub) => {
          if (chainFilter.chainType !== undefined && sub.chainType !== chainFilter.chainType)
            return false;
          if (chainFilter.chainId !== undefined && sub.chainId !== chainFilter.chainId)
            return false;
          if (chainFilter.status === 'active' && !sub.isActive) return false;
          if (chainFilter.status === 'paused' && sub.isActive) return false;
          if (chainFilter.searchQuery) {
            const query = chainFilter.searchQuery.toLowerCase();
            if (
              !sub.name.toLowerCase().includes(query) &&
              !sub.category.toLowerCase().includes(query)
            )
              return false;
          }
          return true;
        });
      },

      getSubscriptionsByChain: (chainType: ChainType) => {
        return get().subscriptions.filter((s) => s.chainType === chainType);
      },

      initiateCrossChainTransfer: async (
        id: string,
        targetChainType: ChainType,
        targetChainId: number
      ) => {
        set({ isLoading: true, error: null });
        try {
          const sub = get().subscriptions.find((s) => s.id === id);
          if (!sub) throw new Error('Subscription not found');

          const subChainType = sub.chainType ?? ChainType.EVM;
          const subChainId = sub.chainId ?? 1;

          const transfer: CrossChainTransfer = {
            sourceChainType: subChainType,
            sourceChainId: subChainId,
            targetChainType,
            targetChainId,
            status: 'pending',
            initiatedAt: new Date(),
          };

          const route = await crossChainRoutingService.findPaymentRoute({
            sourceChainType: subChainType,
            sourceChainId: subChainId,
            targetChainType,
            targetChainId,
            tokenSymbol: sub.cryptoToken || sub.currency,
            amount: sub.price.toString(),
          });

          const _txHash = await crossChainRoutingService.executePayment(route);

          set((state) => ({
            subscriptions: state.subscriptions.map((s) =>
              s.id === id
                ? {
                    ...s,
                    crossChainTransfer: { ...transfer, status: 'pending' },
                    updatedAt: new Date(),
                  }
                : s
            ),
            isLoading: false,
          }));

          crossChainNotificationService.notifyCrossChainTransfer(id, subChainType, targetChainType);
          get().calculateStats();
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'initiateCrossChainTransfer',
            subscriptionId: id,
          });
          set({ error: appError, isLoading: false });
        }
      },

      approveCrossChainTransfer: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          const sub = get().subscriptions.find((s) => s.id === id);
          if (!sub || !sub.crossChainTransfer) throw new Error('No pending transfer');

          set((state) => ({
            subscriptions: state.subscriptions.map((s) =>
              s.id === id
                ? {
                    ...s,
                    chainType: s.crossChainTransfer!.targetChainType,
                    chainId: s.crossChainTransfer!.targetChainId,
                    crossChainTransfer: {
                      ...s.crossChainTransfer!,
                      status: 'completed',
                      completedAt: new Date(),
                    },
                    updatedAt: new Date(),
                  }
                : s
            ),
            isLoading: false,
          }));

          get().calculateStats();
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'approveCrossChainTransfer',
            subscriptionId: id,
          });
          set({ error: appError, isLoading: false });
        }
      },

      aggregateCrossChainBilling: async () => {
        const { subscriptions } = get();
        const activeSubs = subscriptions.filter((s) => s.isActive);

        const billingItems = activeSubs.map((sub) => ({
          chainType: sub.chainType ?? ChainType.EVM,
          amount: sub.price,
          currency: sub.currency,
        }));

        const result = await crossChainRoutingService.aggregateBilling(billingItems);
        return result;
      },

      syncWithServer: async () => {
        if (!networkMonitor.isOnline()) {
          set({ syncStatus: 'pending' });
          return;
        }
        if (get().syncStatus === 'syncing') return;

        set({ syncStatus: 'syncing', error: null });

        try {
          const localState: CRDTSubscriptionState = {
            subscriptions: get().subscriptions.reduce(
              (acc, sub) => {
                acc[sub.id] = sub;
                return acc;
              },
              {} as Record<string, Subscription>
            ),
            metadata: get().crdtMetadata || {},
          };

          const mergedState = await mockSyncApiCall(localState);
          const subscriptionsArray = Object.values(mergedState.subscriptions);

          set({
            subscriptions: subscriptionsArray,
            crdtMetadata: mergedState.metadata,
            syncStatus: 'idle',
            isLoading: false,
          });

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptions(get().subscriptions);
        } catch (err) {
          const appError = errorHandler.handleError(err as Error, {
            action: 'syncWithServer',
          });
          set({
            syncStatus: 'error',
            error: appError,
          });
        }
      },

      previewPlanChange: (
        id: string,
        newPrice: number,
        effectiveDate: 'immediate' | 'end_of_period'
      ) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) {
          throw new Error('Subscription not found');
        }

        const preview = previewProration(sub, newPrice, effectiveDate);
        set({ prorationPreview: preview });
        return preview;
      },

      executePlanChange: async (
        id: string,
        newPlanData: Partial<Subscription>,
        effectiveDate: 'immediate' | 'end_of_period'
      ) => {
        set({ isLoading: true, error: null });
        try {
          const sub = get().subscriptions.find((s) => s.id === id);
          if (!sub) throw new Error('Subscription not found');

          const preview = previewProration(sub, newPlanData.price ?? sub.price, effectiveDate);

          const updatedCreditMemos = { ...get().creditMemos };
          if (preview.isCredit && preview.amount > 0) {
            const memo = generateCreditMemo(id, preview.amount, preview.description);
            updatedCreditMemos[id] = memo;
          }

          const updates: Partial<Subscription> = {
            ...newPlanData,
            updatedAt: new Date(),
          };

          if (effectiveDate === 'immediate') {
            updates.nextBillingDate = advanceBillingDate(
              new Date(),
              newPlanData.billingCycle ?? sub.billingCycle
            );
          }

          const timestamp = Date.now();
          const currentMeta =
            (get().crdtMetadata || {})[id] ||
            SubscriptionCRDT.createMetadata(sub, timestamp - 1000);
          const updatedMetadata = SubscriptionCRDT.updateMetadata(currentMeta, updates, timestamp);

          set((state) => ({
            subscriptions: state.subscriptions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
            crdtMetadata: {
              ...(state.crdtMetadata || {}),
              [id]: updatedMetadata,
            },
            syncStatus: 'pending',
            creditMemos: updatedCreditMemos,
            prorationPreview: null,
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);

          if (networkMonitor.isOnline()) {
            await get().syncWithServer();
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'executePlanChange',
            subscriptionId: id,
          });
          set({ error: appError, isLoading: false });
        }
      },

      applyCreditToSubscription: async (id: string) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        const memo = get().creditMemos[id];
        if (!sub || !memo || memo.applied) return;

        const { updatedMemo } = applyCreditMemo(sub.price, memo);

        set((state) => ({
          creditMemos: {
            ...state.creditMemos,
            [id]: updatedMemo,
          },
        }));
      },

      queuePlanChange: (
        id: string,
        newPlanData: Partial<Subscription>,
        effectiveDate: ProrationEffectiveType
      ) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) throw new Error('Subscription not found');
        const preview = previewProration(
          sub,
          newPlanData.price ?? sub.price,
          effectiveDate === 'end_of_period' ? 'end_of_period' : 'immediate'
        );
        const change: SubscriptionChange = {
          id: generateUniqueId(),
          subscriptionId: id,
          fromPrice: sub.price,
          toPrice: newPlanData.price ?? sub.price,
          effectiveType: effectiveDate,
          status: 'pending',
          proration: preview,
          createdAt: new Date(),
          newPlanData,
        };
        set((state) => ({
          planChanges: [...(state.planChanges || []), change],
        }));
      },

      approvePlanChange: async (changeId: string) => {
        const change = (get().planChanges || []).find((c) => c.id === changeId);
        if (!change) throw new Error('Change request not found');
        if (change.status !== 'pending') throw new Error('Change request is not pending');

        await get().executePlanChange(
          change.subscriptionId,
          change.newPlanData,
          change.effectiveType === 'end_of_period' ? 'end_of_period' : 'immediate'
        );

        set((state) => ({
          planChanges: (state.planChanges || []).map((c) =>
            c.id === changeId ? { ...c, status: 'executed' } : c
          ),
        }));
      },

      rejectPlanChange: (changeId: string) => {
        set((state) => ({
          planChanges: (state.planChanges || []).map((c) =>
            c.id === changeId ? { ...c, status: 'rejected' } : c
          ),
        }));
      },

      getChangeHistory: (subscriptionId: string) => {
        return (get().planChanges || []).filter((c) => c.subscriptionId === subscriptionId);
      },

      pauseSubscription: (id: string, durationDays: number, reason?: string) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) throw new Error('Subscription not found');

        const billingAdjustment = (sub.price / 30) * durationDays;
        const plannedResumeDate = new Date();
        plannedResumeDate.setDate(plannedResumeDate.getDate() + durationDays);

        const record: PauseRecord = {
          id: `pause_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          subscriptionId: id,
          pausedAt: new Date(),
          plannedResumeDate,
          reason,
          billingAdjustment: Math.round(billingAdjustment * 100) / 100,
          status: 'active',
        };

        set((state) => ({
          subscriptions: state.subscriptions.map((s) =>
            s.id === id ? { ...s, isActive: false, updatedAt: new Date() } : s
          ),
          pauseRecords: [...state.pauseRecords, record],
        }));

        get().calculateStats();
        get().calculatePauseAnalytics();
      },

      resumeSubscription: (id: string) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) throw new Error('Subscription not found');

        const activePause = get().pauseRecords.find(
          (p) => p.subscriptionId === id && p.status === 'active'
        );

        if (activePause) {
          const resumeAt = new Date();
          const pauseDays = Math.ceil(
            (resumeAt.getTime() - new Date(activePause.pausedAt).getTime()) / (1000 * 60 * 60 * 24)
          );
          const actualAdjustment = (sub.price / 30) * pauseDays;

          set((state) => ({
            pauseRecords: state.pauseRecords.map((p) =>
              p.id === activePause.id
                ? {
                    ...p,
                    resumeAt,
                    status: 'resumed' as const,
                    billingAdjustment: Math.round(actualAdjustment * 100) / 100,
                  }
                : p
            ),
          }));
        }

        set((state) => ({
          subscriptions: state.subscriptions.map((s) =>
            s.id === id ? { ...s, isActive: true, updatedAt: new Date() } : s
          ),
        }));

        get().calculateStats();
        get().calculatePauseAnalytics();
      },

      getPauseHistory: (subscriptionId: string) => {
        return (get().pauseRecords || []).filter((p) => p.subscriptionId === subscriptionId);
      },

      calculatePauseAnalytics: (subscriptionId?: string) => {
        const records = subscriptionId
          ? (get().pauseRecords || []).filter((p) => p.subscriptionId === subscriptionId)
          : get().pauseRecords || [];

        const totalPauses = records.length;
        const totalResumes = records.filter((p) => p.status === 'resumed').length;
        const activePauses = records.filter((p) => p.status === 'active').length;

        const pauseRate =
          totalPauses > 0
            ? Math.round((totalPauses / Math.max(totalPauses + totalResumes, 1)) * 100)
            : 0;
        const resumeRate = totalPauses > 0 ? Math.round((totalResumes / totalPauses) * 100) : 0;

        const resumedRecords = records.filter((p) => p.resumeAt && p.pausedAt);
        const avgDuration =
          resumedRecords.length > 0
            ? resumedRecords.reduce((sum, p) => {
                const days = Math.ceil(
                  (new Date(p.resumeAt!).getTime() - new Date(p.pausedAt).getTime()) /
                    (1000 * 60 * 60 * 24)
                );
                return sum + days;
              }, 0) / resumedRecords.length
            : 0;

        const totalBillingAdjusted = records.reduce((sum, p) => sum + p.billingAdjustment, 0);

        const analytics: PauseAnalytics = {
          totalPauses,
          totalResumes,
          pauseRate,
          resumeRate,
          averagePauseDurationDays: Math.round(avgDuration * 10) / 10,
          activePauses,
          totalBillingAdjusted: Math.round(totalBillingAdjusted * 100) / 100,
        };

        set({ pauseAnalytics: analytics });
        return analytics;
      },

      addSubscription: async (data: SubscriptionFormData) => {
        set({ isLoading: true, error: null });
        try {
          const newSubscription: Subscription = {
            id: generateUniqueId(),
            ...data,
            isActive: true,
            notificationsEnabled: data.notificationsEnabled !== false,
            chainType: data.chainType,
            chainId: data.chainId,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const timestamp = Date.now();
          const newMetadata = SubscriptionCRDT.createMetadata(newSubscription, timestamp);

          set((state) => ({
            subscriptions: [...state.subscriptions, newSubscription],
            crdtMetadata: {
              ...(state.crdtMetadata || {}),
              [newSubscription.id]: newMetadata,
            },
            syncStatus: 'pending',
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptionToCalendars(newSubscription);

          const gamificationStore = useGamificationStore.getState();
          gamificationStore.addPoints(10);
          gamificationStore.checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
            totalSubscriptions: get().subscriptions.length,
            price: data.price,
            category: data.category,
          });

          if (networkMonitor.isOnline()) {
            await get().syncWithServer();
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'addSubscription',
            subscriptionId: 'new',
            metadata: { formData: data },
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      updateSubscription: async (id: string, data: Partial<Subscription>) => {
        set({ isLoading: true, error: null });
        try {
          const sub = get().subscriptions.find((s) => s.id === id);
          if (!sub) throw new Error('Subscription not found');

          const updatedSubscription = {
            ...sub,
            ...data,
            updatedAt: new Date(),
          };

          const timestamp = Date.now();
          const currentMeta =
            (get().crdtMetadata || {})[id] ||
            SubscriptionCRDT.createMetadata(sub, timestamp - 1000);
          const updatedMetadata = SubscriptionCRDT.updateMetadata(currentMeta, data, timestamp);

          set((state) => ({
            subscriptions: state.subscriptions.map((s) => (s.id === id ? updatedSubscription : s)),
            crdtMetadata: {
              ...(state.crdtMetadata || {}),
              [id]: updatedMetadata,
            },
            syncStatus: 'pending',
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updated = get().subscriptions.find((s) => s.id === id);
          if (updated) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updated);
          }

          if (networkMonitor.isOnline()) {
            await get().syncWithServer();
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'updateSubscription',
            subscriptionId: id,
            metadata: { updateData: data },
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      deleteSubscription: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          const current = get().subscriptions.find((sub) => sub.id === id);
          if (!current) throw new Error('Subscription not found');

          const timestamp = Date.now();
          const currentMeta =
            (get().crdtMetadata || {})[id] ||
            SubscriptionCRDT.createMetadata(current, timestamp - 1000);
          const updatedMetadata = {
            ...currentMeta,
            deletedAt: timestamp,
          };

          useSupportStore
            .getState()
            .createTicket(
              createSupportEvent(current, 'cancellation', [
                'Cancellation requested from subscription management',
                'Subscription marked for removal',
              ])
            );

          set((state) => ({
            subscriptions: state.subscriptions.filter((sub) => sub.id !== id),
            crdtMetadata: {
              ...(state.crdtMetadata || {}),
              [id]: updatedMetadata,
            },
            syncStatus: 'pending',
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().removeSubscriptionFromCalendars(id);

          if (networkMonitor.isOnline()) {
            await get().syncWithServer();
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'deleteSubscription',
            subscriptionId: id,
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      toggleSubscriptionStatus: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          const sub = get().subscriptions.find((s) => s.id === id);
          if (!sub) throw new Error('Subscription not found');

          const updatedSubscription = {
            ...sub,
            isActive: !sub.isActive,
            updatedAt: new Date(),
          };

          const timestamp = Date.now();
          const currentMeta =
            (get().crdtMetadata || {})[id] ||
            SubscriptionCRDT.createMetadata(sub, timestamp - 1000);
          const updatedMetadata = SubscriptionCRDT.updateMetadata(
            currentMeta,
            { isActive: !sub.isActive },
            timestamp
          );

          set((state) => ({
            subscriptions: state.subscriptions.map((s) => (s.id === id ? updatedSubscription : s)),
            crdtMetadata: {
              ...(state.crdtMetadata || {}),
              [id]: updatedMetadata,
            },
            syncStatus: 'pending',
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updated = get().subscriptions.find((s) => s.id === id);
          if (updated) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updated);
          }

          if (networkMonitor.isOnline()) {
            await get().syncWithServer();
          }
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'toggleSubscriptionStatus',
            subscriptionId: id,
          });
          set({
            error: appError,
            isLoading: false,
          });
        }
      },

      recordBillingOutcome: async (id: string, outcome: 'success' | 'failed') => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) return;

        if (outcome === 'failed') {
          const dunningEntries = JSON.parse(
            (await AsyncStorage.getItem('subtrackr-dunning-entries')) || '{}'
          );
          const entry = dunningEntries[id];
          const attempt = (entry?.failedAttempts ?? 0) + 1;

          dunningEntries[id] = {
            failedAttempts: attempt,
            lastFailureAt: new Date().toISOString(),
            currentStage:
              attempt <= 3 ? 'retry' : attempt <= 5 ? 'warn' : attempt <= 7 ? 'suspend' : 'cancel',
          };
          await AsyncStorage.setItem('subtrackr-dunning-entries', JSON.stringify(dunningEntries));

          crossChainNotificationService.notifyPaymentFailed(
            id,
            sub.chainType ?? ChainType.EVM,
            sub.chainId ?? 1,
            `Attempt ${attempt}`
          );

          if (sub.notificationsEnabled !== false) {
            await presentChargeFailedNotification(sub);
            if (attempt <= 3) {
              await presentDunningRetryNotification(sub, attempt, 3);
            } else if (attempt <= 5) {
              await presentDunningWarningNotification(sub, attempt);
            } else if (attempt <= 7) {
              await presentDunningSuspendedNotification(sub);
            } else {
              await presentDunningCancelledNotification(sub);
            }
          }

          set({ isLoading: false });
          return;
        }

        if (outcome === 'success') {
          crossChainNotificationService.notifyPaymentSuccess(
            id,
            sub.chainType ?? ChainType.EVM,
            sub.chainId ?? 1,
            sub.price.toString()
          );

          const hasDunningEntry = await AsyncStorage.getItem('subtrackr-dunning-entries');
          if (hasDunningEntry) {
            await AsyncStorage.removeItem('subtrackr-dunning-entries');
            if (sub.notificationsEnabled !== false) {
              await presentDunningRecoveryNotification(sub);
            }
          }
          await presentChargeSuccessNotification(sub);
          const billingPeriod = buildBillingPeriod(sub);
          const next = advanceBillingDate(new Date(sub.nextBillingDate), sub.billingCycle);
          const simulatedGas = 0.01 + Math.random() * 0.005;
          set((state) => ({
            subscriptions: state.subscriptions.map((s) =>
              s.id === id
                ? {
                    ...s,
                    nextBillingDate: next,
                    updatedAt: new Date(),
                    totalGasSpent: (s.totalGasSpent || 0) + simulatedGas,
                    chargeCount: (s.chargeCount || 0) + 1,
                    lastGasCost: simulatedGas,
                    gasBudget: s.gasBudget || 0.05,
                  }
                : s
            ),
          }));
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updatedSubscription = get().subscriptions.find((entry) => entry.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
          }

          await useInvoiceStore.getState().generateInvoiceFromSubscription(
            {
              subscription: sub,
              period: billingPeriod,
              region: 'GLOBAL',
              currency: sub.currency,
              recipientEmail: `${sub.name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@billing.local`,
            },
            0
          );
        } else {
          useSupportStore
            .getState()
            .createTicket(
              createSupportEvent(sub, 'failed_charge', [
                'Payment failure recorded during billing run',
                `Next billing date remains ${sub.nextBillingDate.toISOString()}`,
                `Notifications ${sub.notificationsEnabled === false ? 'disabled' : 'enabled'}`,
              ])
            );
        }
      },

      fetchSubscriptions: async () => {
        set({ isLoading: true, error: null });
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          set({ isLoading: false });
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptions(get().subscriptions);
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'fetchSubscriptions',
            }),
            isLoading: false,
          });
        }
      },

      calculateStats: () => {
        const { subscriptions } = get();

        if (!subscriptions || !Array.isArray(subscriptions)) {
          set({
            stats: {
              totalActive: 0,
              totalMonthlySpend: 0,
              totalYearlySpend: 0,
              categoryBreakdown: {} as Record<SubscriptionCategory, number>,
              chainBreakdown: { stellar: 0, evm: {} },
              crossChainTotalMonthlySpend: 0,
              crossChainTotalYearlySpend: 0,
            } as SubscriptionStats,
          });
          return;
        }

        const activeSubs = subscriptions.filter((sub) => sub.isActive);

        const { preferredCurrency, exchangeRates } = useSettingsStore.getState();
        const rates = exchangeRates?.rates || {};

        let totalMonthlySpend = 0;
        let totalYearlySpend = 0;
        const chainBreakdown: ChainSpendBreakdown = { stellar: 0, evm: {} };

        for (const sub of activeSubs) {
          const priceInPreferred = currencyService.convert(
            sub.price,
            sub.currency,
            preferredCurrency,
            rates
          );

          let monthlyAmount = 0;
          let yearlyAmount = 0;

          if (sub.billingCycle === 'monthly') {
            monthlyAmount = priceInPreferred;
            yearlyAmount = priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
          } else if (sub.billingCycle === 'yearly') {
            monthlyAmount = priceInPreferred / 12;
            yearlyAmount = priceInPreferred;
          } else if (sub.billingCycle === 'weekly') {
            monthlyAmount = priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
            yearlyAmount = priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
          } else {
            monthlyAmount = priceInPreferred;
            yearlyAmount = priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
          }

          totalMonthlySpend += monthlyAmount;
          totalYearlySpend += yearlyAmount;

          const chainType = sub.chainType ?? ChainType.EVM;
          const chainId = sub.chainId ?? 1;
          if (chainType === ChainType.STELLAR) {
            chainBreakdown.stellar += monthlyAmount;
          } else {
            if (!chainBreakdown.evm[chainId]) {
              chainBreakdown.evm[chainId] = 0;
            }
            chainBreakdown.evm[chainId] += monthlyAmount;
          }
        }

        const categoryBreakdown = activeSubs.reduce(
          (acc, sub) => {
            acc[sub.category] = (acc[sub.category] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        const totalGasSpent = activeSubs.reduce(
          (total, sub) => total + (sub.totalGasSpent || 0),
          0
        );

        set({
          stats: {
            totalActive: activeSubs.length,
            totalMonthlySpend,
            totalYearlySpend,
            categoryBreakdown,
            totalGasSpent,
            chainBreakdown,
            crossChainTotalMonthlySpend: totalMonthlySpend,
            crossChainTotalYearlySpend: totalYearlySpend,
          } as SubscriptionStats,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => debouncedAsyncStorageAdapter),
      partialize: (state) =>
        serializeForStorage({
          subscriptions: state.subscriptions,
          planChanges: state.planChanges,
          crdtMetadata: state.crdtMetadata,
          syncStatus: state.syncStatus,
        }),
      migrate: (persistedState, version) => migratePersistedState(persistedState, version),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedState(persistedState, STORE_VERSION),
      }),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[subscriptionStore] Hydration error — resetting to defaults:', error);
          useSubscriptionStore.setState({
            subscriptions: [],
            planChanges: [],
            isLoading: false,
            error: null,
            prorationPreview: null,
            creditMemos: {},
          });
        }
      },
    }
  )
);
