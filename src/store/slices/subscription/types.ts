import type { Subscription } from '../../../types/subscription';
import type { SubscriptionStats } from '../../../types/subscription';
import type { SubscriptionFormData } from '../../../types/subscription';
import type { SubscriptionChange } from '../../../types/subscription';
import type { SubscriptionMetadata } from '../../../services/cache/crdt';

export interface SubscriptionDataSlice {
  subscriptions: Subscription[];
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
}

export interface SubscriptionStatsSlice {
  stats: SubscriptionStats;
  calculateStats: () => void;
}

export interface SubscriptionPlanSlice {
  prorationPreview: unknown | null;
  creditMemos: Record<string, unknown>;
  planChanges: SubscriptionChange[];
  previewPlanChange: (
    id: string,
    newPrice: number,
    effectiveDate: 'immediate' | 'end_of_period'
  ) => unknown;
  executePlanChange: (
    id: string,
    newPlanData: Partial<Subscription>,
    effectiveDate: 'immediate' | 'end_of_period'
  ) => Promise<void>;
  applyCreditToSubscription: (id: string) => Promise<void>;
  queuePlanChange: (id: string, newPlanData: Partial<Subscription>, effectiveDate: string) => void;
  approvePlanChange: (changeId: string) => Promise<void>;
  rejectPlanChange: (changeId: string) => void;
  getChangeHistory: (subscriptionId: string) => SubscriptionChange[];
}

export interface SubscriptionChainSlice {
  chainFilter: unknown;
  setChainFilter: (filter: unknown) => void;
  getFilteredSubscriptions: () => Subscription[];
  initiateCrossChainTransfer: (
    id: string,
    targetChainType: string,
    targetChainId: number
  ) => Promise<void>;
  approveCrossChainTransfer: (id: string) => Promise<void>;
  getSubscriptionsByChain: (chainType: string) => Subscription[];
  aggregateCrossChainBilling: () => Promise<{
    totalInPreferredCurrency: number;
    chainBreakdown: Record<string, number>;
    conversionRates: Record<string, number>;
  }>;
}

export interface SubscriptionSyncSlice {
  syncStatus: 'idle' | 'pending' | 'syncing' | 'conflict' | 'error';
  crdtMetadata: Record<string, SubscriptionMetadata>;
  setSyncStatus: (status: 'idle' | 'pending' | 'syncing' | 'conflict' | 'error') => void;
  syncWithServer: () => Promise<void>;
}

export interface SubscriptionErrorSlice {
  isLoading: boolean;
  error: unknown;
}
