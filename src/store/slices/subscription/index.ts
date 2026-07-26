import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../../../utils/storage';
import { initialSubscriptionDataState, createSubscriptionDataSlice } from './dataSlice';
import { initialSubscriptionStatsState, createSubscriptionStatsSlice } from './statsSlice';
import { initialSubscriptionPlanState, createSubscriptionPlanSlice } from './planSlice';
import { initialSubscriptionChainState, createSubscriptionChainSlice } from './chainSlice';
import { initialSubscriptionSyncState, createSubscriptionSyncSlice } from './syncSlice';
import { createSubscriptionBillingSlice } from './billingSlice';
import type { Subscription } from '../../../types/subscription';
import type { SubscriptionStats } from '../../../types/subscription';
import type { SubscriptionChange } from '../../../types/subscription';

export interface SubscriptionState {
  subscriptions: Subscription[];
  stats: SubscriptionStats;
  isLoading: boolean;
  error: unknown;
  prorationPreview: unknown;
  creditMemos: Record<string, unknown>;
  planChanges: SubscriptionChange[];
  chainFilter: unknown;
  syncStatus: string;
  crdtMetadata: Record<string, object>;
  addSubscription: (data: unknown) => Promise<void>;
  updateSubscription: (id: string, data: unknown) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;
  previewPlanChange: (id: string, newPrice: number, effectiveDate: string) => unknown;
  executePlanChange: (id: string, data: unknown, effectiveDate: string) => Promise<void>;
  applyCreditToSubscription: (id: string) => Promise<void>;
  queuePlanChange: (id: string, data: unknown, effectiveDate: string) => void;
  approvePlanChange: (changeId: string) => Promise<void>;
  rejectPlanChange: (changeId: string) => void;
  getChangeHistory: (subscriptionId: string) => SubscriptionChange[];
  setChainFilter: (filter: unknown) => void;
  getFilteredSubscriptions: () => Subscription[];
  getSubscriptionsByChain: (chainType: string) => Subscription[];
  initiateCrossChainTransfer: (
    id: string,
    targetChainType: string,
    targetChainId: number
  ) => Promise<void>;
  approveCrossChainTransfer: (id: string) => Promise<void>;
  aggregateCrossChainBilling: () => Promise<{
    totalInPreferredCurrency: number;
    chainBreakdown: Record<string, number>;
    conversionRates: Record<string, number>;
  }>;
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  setSyncStatus: (status: string) => void;
  syncWithServer: () => Promise<void>;
}

const STORAGE_KEY = 'subtrackr-subscriptions';
const STORE_VERSION = 2;

const serializeForStorage = (state: any) => ({
  subscriptions: (state.subscriptions || []).map((sub: any) => ({
    ...sub,
    nextBillingDate: new Date(sub.nextBillingDate),
    createdAt: new Date(sub.createdAt),
    updatedAt: new Date(sub.updatedAt),
  })),
  planChanges: (state.planChanges || []).map((change: any) => ({
    ...change,
    createdAt: new Date(change.createdAt),
  })),
  crdtMetadata: state.crdtMetadata || {},
  syncStatus: state.syncStatus || 'idle',
});

const migratePersistedState = (persisted: unknown, _version: number): any => {
  if (!persisted || typeof persisted !== 'object') {
    return { subscriptions: [], planChanges: [], crdtMetadata: {}, syncStatus: 'idle' };
  }

  const raw = persisted as Record<string, unknown>;
  const subscriptions = Array.isArray(raw.subscriptions)
    ? raw.subscriptions.map((entry: any) => ({
        ...entry,
        nextBillingDate: new Date(entry.nextBillingDate),
        createdAt: new Date(entry.createdAt),
        updatedAt: new Date(entry.updatedAt),
      }))
    : [];

  const planChanges = Array.isArray(raw.planChanges)
    ? raw.planChanges.map((entry: any) => ({ ...entry, createdAt: new Date(entry.createdAt) }))
    : [];

  return {
    subscriptions,
    planChanges,
    crdtMetadata: raw.crdtMetadata || {},
    syncStatus: raw.syncStatus || 'idle',
  };
};

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      ...initialSubscriptionDataState,
      ...initialSubscriptionStatsState,
      ...initialSubscriptionPlanState,
      ...initialSubscriptionChainState,
      ...initialSubscriptionSyncState,
      ...createSubscriptionDataSlice(set, get),
      ...createSubscriptionStatsSlice(set, get),
      ...createSubscriptionPlanSlice(set, get),
      ...createSubscriptionChainSlice(set, get),
      ...createSubscriptionSyncSlice(set, get),
      ...createSubscriptionBillingSlice(set, get),
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => debouncedAsyncStorageAdapter),
      partialize: (state: any) => serializeForStorage(state),
      migrate: (persistedState: unknown, _version: number) =>
        migratePersistedState(persistedState, _version),
      merge: (persistedState: unknown, currentState: any) => ({
        ...currentState,
        ...migratePersistedState(persistedState, STORE_VERSION),
      }),
      onRehydrateStorage: () => (_state: any, error: unknown) => {
        if (error) {
          console.warn('[subscriptionStore] Hydration error — resetting to defaults:', error);
          const store = useSubscriptionStore;
          store.setState({
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
