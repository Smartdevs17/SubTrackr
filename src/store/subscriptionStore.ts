import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Subscription, // eslint-disable-line
  SubscriptionFormData,
  SubscriptionStats,
  SubscriptionCategory, // eslint-disable-line
  BillingCycle, // eslint-disable-line
} from '../types/subscription';
import { dummySubscriptions } from '../utils/dummyData'; // eslint-disable-line
import { calculateSubscriptionStats } from '../utils/stats';
import { advanceBillingDate } from '../utils/billingDate';
import { buildBillingPeriod } from '../utils/invoice';
import { CACHE_CONSTANTS } from '../utils/constants/values';
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
import {
  previewProration,
  generateCreditMemo,
  applyCreditMemo,
  ProrationPreview,
  CreditMemo,
} from '../utils/proration';

export type ProrationEffectiveType = 'immediate' | 'end_of_period' | 'custom_date';

export interface SubscriptionChange {
  id: string;
  subscriptionId: string;
  fromPrice: number;
  toPrice: number;
  fromPlan: Partial<Subscription>;
  toPlan: Partial<Subscription>;
  effectiveDate: Date;
  effectiveType: ProrationEffectiveType;
  proration: ProrationPreview;
  status: 'pending' | 'approved' | 'executed' | 'rejected';
  createdAt: Date;
  minimumCommitmentDays?: number;
}

const STORAGE_KEY = 'subtrackr-subscriptions';
const STORE_VERSION = 1;
const WRITE_DEBOUNCE_MS = CACHE_CONSTANTS.WRITE_DEBOUNCE_MS;

/**
 * Generate a unique ID for subscriptions
 * Uses timestamp + random component to prevent collisions
 */
const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

type PersistedSubscriptionSlice = Pick<SubscriptionState, 'subscriptions'>;

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
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
  };
};

const serializeForStorage = (state: PersistedSubscriptionSlice): PersistedSubscriptionSlice => ({
  subscriptions: state.subscriptions.map((sub) => ({
    ...sub,
    nextBillingDate: new Date(sub.nextBillingDate),
    createdAt: new Date(sub.createdAt),
    updatedAt: new Date(sub.updatedAt),
  })),
});

const migratePersistedState = (
  persisted: unknown,
  _version: number
): PersistedSubscriptionSlice => {
  if (!persisted || typeof persisted !== 'object') {
    return { subscriptions: [] };
  }

  const maybeState = persisted as Partial<PersistedSubscriptionSlice>;
  const subscriptions = Array.isArray(maybeState.subscriptions)
    ? maybeState.subscriptions.map((entry) => normalizeSubscription(entry as Partial<Subscription>))
    : [];

  return { subscriptions };
};

const pendingWrites = new Map<string, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue = Promise.resolve();

const flushPendingWrites = async (): Promise<void> => {
  if (pendingWrites.size === 0) return;

  const writes = Array.from(pendingWrites.entries());
  pendingWrites.clear();

  writeQueue = writeQueue.then(async () => {
    await Promise.all(writes.map(([key, value]) => AsyncStorage.setItem(key, value)));
  });

  try {
    await writeQueue;
  } catch (error) {
    console.warn('Failed to persist subscriptions:', error);
  }
};

const debouncedAsyncStorage: StateStorage = {
  getItem: async (name) => {
    if (pendingWrites.has(name)) return pendingWrites.get(name) ?? null;
    await writeQueue;
    return AsyncStorage.getItem(name);
  },
  setItem: async (name, value) => {
    pendingWrites.set(name, value);
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      void flushPendingWrites();
    }, WRITE_DEBOUNCE_MS);
  },
  removeItem: async (name) => {
    pendingWrites.delete(name);
    if (writeTimer && pendingWrites.size === 0) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    await writeQueue;
    await AsyncStorage.removeItem(name);
  },
};

interface SubscriptionState {
  subscriptions: Subscription[];
  stats: SubscriptionStats;
  isLoading: boolean;
  error: AppError | null;
  prorationPreview: ProrationPreview | null;
  creditMemos: Record<string, CreditMemo>;
  changeHistory: SubscriptionChange[];
  pendingChanges: SubscriptionChange[];

  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  // new actions added
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
  /** Simulate or record a billing result (fires local notifications when enabled for this sub). */
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  /**
   * Refresh subscriptions with proper race condition handling.
   * Fetches fresh data and updates state atomically to prevent stale data.
   */
  refreshSubscriptions: () => Promise<void>;
  calculateStats: () => void;
  queuePlanChange: (
    id: string,
    newPlanData: Partial<Subscription>,
    effectiveType: ProrationEffectiveType,
    customDate?: Date,
    minimumCommitmentDays?: number
  ) => SubscriptionChange;
  approvePlanChange: (changeId: string) => Promise<void>;
  rejectPlanChange: (changeId: string) => void;
  getChangeHistory: (subscriptionId: string) => SubscriptionChange[];
}

export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set, get) => ({
      subscriptions: dummySubscriptions,
      stats: {
        totalActive: 0,
        totalMonthlySpend: 0,
        totalYearlySpend: 0,
        categoryBreakdown: {} as Record<string, number>,
      },
      prorationPreview: null,
      creditMemos: {},
      changeHistory: [],
      pendingChanges: [],

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

          // Generate credit memo if downgrade
          const updatedCreditMemos = { ...get().creditMemos };
          if (preview.isCredit && preview.amount > 0) {
            const memo = generateCreditMemo(id, preview.amount, preview.description);
            updatedCreditMemos[id] = memo;
          }

          // Update subscription
          const updates: Partial<Subscription> = {
            ...newPlanData,
            updatedAt: new Date(),
          };

          if (effectiveDate === 'immediate') {
            // Reset billing cycle
            updates.nextBillingDate = advanceBillingDate(
              new Date(),
              newPlanData.billingCycle ?? sub.billingCycle
            );
          }

          set((state) => ({
            subscriptions: state.subscriptions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
            creditMemos: updatedCreditMemos,
            prorationPreview: null,
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
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

        const { finalCharge, updatedMemo } = applyCreditMemo(sub.price, memo);

        set((state) => ({
          creditMemos: {
            ...state.creditMemos,
            [id]: updatedMemo,
          },
        }));

        // Could trigger a reduced charge here
        console.log(`Applied credit: final charge ${finalCharge}`);
      },

      queuePlanChange: (
        id: string,
        newPlanData: Partial<Subscription>,
        effectiveType: ProrationEffectiveType,
        customDate?: Date,
        minimumCommitmentDays?: number
      ) => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) throw new Error('Subscription not found');

        const newPrice = newPlanData.price ?? sub.price;
        const prorationType = effectiveType === 'end_of_period' ? 'end_of_period' : 'immediate';
        const proration = previewProration(sub, newPrice, prorationType);
        const effectiveDate =
          effectiveType === 'custom_date' && customDate ? customDate : new Date();

        const change: SubscriptionChange = {
          id: generateUniqueId(),
          subscriptionId: id,
          fromPrice: sub.price,
          toPrice: newPrice,
          fromPlan: { price: sub.price, billingCycle: sub.billingCycle },
          toPlan: newPlanData,
          effectiveDate,
          effectiveType,
          proration,
          status: 'pending',
          createdAt: new Date(),
          minimumCommitmentDays,
        };

        set((state) => ({ pendingChanges: [...state.pendingChanges, change] }));
        return change;
      },

      approvePlanChange: async (changeId: string) => {
        const change = get().pendingChanges.find((c) => c.id === changeId);
        if (!change) throw new Error('Change request not found');

        if (change.minimumCommitmentDays) {
          const daysSinceCreated =
            (new Date().getTime() - change.createdAt.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceCreated < change.minimumCommitmentDays) {
            throw new Error(
              `Cannot approve: minimum commitment of ${change.minimumCommitmentDays} days not met`
            );
          }
        }

        const prorationType =
          change.effectiveType === 'end_of_period' ? 'end_of_period' : 'immediate';
        await get().executePlanChange(change.subscriptionId, change.toPlan, prorationType);

        const executed: SubscriptionChange = { ...change, status: 'executed' };
        set((state) => ({
          pendingChanges: state.pendingChanges.filter((c) => c.id !== changeId),
          changeHistory: [...state.changeHistory, executed],
        }));
      },

      rejectPlanChange: (changeId: string) => {
        const change = get().pendingChanges.find((c) => c.id === changeId);
        if (!change) return;
        const rejected: SubscriptionChange = { ...change, status: 'rejected' };
        set((state) => ({
          pendingChanges: state.pendingChanges.filter((c) => c.id !== changeId),
          changeHistory: [...state.changeHistory, rejected],
        }));
      },

      getChangeHistory: (subscriptionId: string) => {
        return [
          ...get().pendingChanges.filter((c) => c.subscriptionId === subscriptionId),
          ...get().changeHistory.filter((c) => c.subscriptionId === subscriptionId),
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      },

      // Hydration state: keep loading true until persisted state is read.
      isLoading: true,
      error: null,

      addSubscription: async (data: SubscriptionFormData) => {
        set({ isLoading: true, error: null });
        try {
          const newSubscription: Subscription = {
            id: generateUniqueId(),
            ...data,
            isActive: true,
            notificationsEnabled: data.notificationsEnabled !== false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          set((state) => ({
            subscriptions: [...state.subscriptions, newSubscription],
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptionToCalendars(newSubscription);

          // Gamification Triggers
          const gamificationStore = useGamificationStore.getState();
          gamificationStore.addPoints(10); // 10 points for adding a subscription
          gamificationStore.checkAchievements(AchievementTrigger.SUBSCRIPTION_ADDED, {
            totalSubscriptions: get().subscriptions.length,
            price: data.price,
            category: data.category,
          });
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
          set((state) => ({
            subscriptions: state.subscriptions.map((sub) =>
              sub.id === id ? { ...sub, ...data, updatedAt: new Date() } : sub
            ),
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updatedSubscription = get().subscriptions.find((sub) => sub.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
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
          set((state) => ({
            subscriptions: state.subscriptions.filter((sub) => sub.id !== id),
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().removeSubscriptionFromCalendars(id);
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
          set((state) => ({
            subscriptions: state.subscriptions.map((sub) =>
              sub.id === id ? { ...sub, isActive: !sub.isActive, updatedAt: new Date() } : sub
            ),
            isLoading: false,
          }));

          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          const updatedSubscription = get().subscriptions.find((sub) => sub.id === id);
          if (updatedSubscription) {
            await useCalendarStore.getState().syncSubscriptionToCalendars(updatedSubscription);
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
          const simulatedGas = 0.01 + Math.random() * 0.005; // Simulate 0.01 - 0.015 XLM gas
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
        }
      },

      fetchSubscriptions: async () => {
        set({ isLoading: true, error: null });
        try {
          // TODO: Replace with remote sync; local storage remains source-of-truth offline.
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

      refreshSubscriptions: async () => {
        set({ isLoading: true, error: null });
        try {
          // Fetch fresh data first
          // TODO: Replace with remote sync; local storage remains source-of-truth offline.
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Update state atomically after fetch completes
          // This prevents showing stale/empty data during the fetch
          set({ isLoading: false });
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
          await useCalendarStore.getState().syncSubscriptions(get().subscriptions);
        } catch (error) {
          set({
            error: errorHandler.handleError(error as Error, {
              action: 'refreshSubscriptions',
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
            },
          });
          return;
        }

        const { preferredCurrency, exchangeRates } = useSettingsStore.getState();
        const rates = exchangeRates?.rates || {};

        const totalMonthlySpend = activeSubs.reduce((total, sub) => {
          const priceInPreferred = currencyService.convert(
            sub.price,
            sub.currency,
            preferredCurrency,
            rates
          );
          if (sub.billingCycle === 'monthly') return total + priceInPreferred;
          if (sub.billingCycle === 'yearly') return total + priceInPreferred / 12;
          if (sub.billingCycle === 'weekly')
            return total + priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_MONTH;
          return total + priceInPreferred;
        }, 0);

        const totalYearlySpend = activeSubs.reduce((total, sub) => {
          const priceInPreferred = currencyService.convert(
            sub.price,
            sub.currency,
            preferredCurrency,
            rates
          );
          if (sub.billingCycle === 'yearly') return total + priceInPreferred;
          if (sub.billingCycle === 'monthly')
            return total + priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
          if (sub.billingCycle === 'weekly')
            return total + priceInPreferred * BILLING_CONVERSIONS.WEEKS_PER_YEAR;
          return total + priceInPreferred * BILLING_CONVERSIONS.MONTHS_PER_YEAR;
        }, 0);

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

        set({ stats });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => debouncedAsyncStorage),
      partialize: (state) => serializeForStorage({ subscriptions: state.subscriptions }),
      migrate: (persistedState, version) => migratePersistedState(persistedState, version),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedState(persistedState, STORE_VERSION),
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useSubscriptionStore.setState({
            error: errorHandler.createError(
              new Error('Stored subscription data is corrupted. Loaded fallback data.'),
              { action: 'rehydrateSubscriptions' },
              true
            ),
            subscriptions: [...dummySubscriptions],
            isLoading: false,
          });
          useSubscriptionStore.getState().calculateStats();
          void syncRenewalReminders(useSubscriptionStore.getState().subscriptions);
          return;
        }

        const subscriptions = Array.isArray(state?.subscriptions)
          ? state.subscriptions
          : [...dummySubscriptions];
        useSubscriptionStore.setState({
          subscriptions,
          isLoading: false,
          error: null,
        });
        useSubscriptionStore.getState().calculateStats();
        void syncRenewalReminders(useSubscriptionStore.getState().subscriptions);
        void useCalendarStore
          .getState()
          .syncSubscriptions(useSubscriptionStore.getState().subscriptions);
      },
    }
  )
);
