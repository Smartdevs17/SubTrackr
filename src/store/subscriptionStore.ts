import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Subscription,
  SubscriptionFormData,
  SubscriptionStats,
  SubscriptionCategory,
  BillingCycle,
} from '../types/subscription';
import { dummySubscriptions } from '../utils/dummyData';
import { advanceBillingDate } from '../utils/billingDate';
import {
  syncRenewalReminders,
  presentChargeSuccessNotification,
  presentChargeFailedNotification,
} from '../services/notificationService';

const STORAGE_KEY = 'subtrackr-subscriptions';
const STORE_VERSION = 1;
const WRITE_DEBOUNCE_MS = 400;

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
    id: raw.id ?? Date.now().toString(),
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
  error: string | null;

  // Actions
  addSubscription: (data: SubscriptionFormData) => Promise<void>;
  updateSubscription: (id: string, data: Partial<Subscription>) => Promise<void>;
  deleteSubscription: (id: string) => Promise<void>;
  toggleSubscriptionStatus: (id: string) => Promise<void>;
  /** Simulate or record a billing result (fires local notifications when enabled for this sub). */
  recordBillingOutcome: (id: string, outcome: 'success' | 'failed') => Promise<void>;
  fetchSubscriptions: () => Promise<void>;
  calculateStats: () => void;
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
      // Hydration state: keep loading true until persisted state is read.
      isLoading: true,
      error: null,

      addSubscription: async (data: SubscriptionFormData) => {
        set({ isLoading: true, error: null });
        try {
          const newSubscription: Subscription = {
            id: Date.now().toString(),
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
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to add subscription',
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
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to update subscription',
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
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to delete subscription',
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
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to toggle subscription',
            isLoading: false,
          });
        }
      },

      recordBillingOutcome: async (id: string, outcome: 'success' | 'failed') => {
        const sub = get().subscriptions.find((s) => s.id === id);
        if (!sub) return;

        if (sub.notificationsEnabled !== false) {
          if (outcome === 'success') {
            await presentChargeSuccessNotification(sub);
          } else {
            await presentChargeFailedNotification(sub);
          }
        }

        if (outcome === 'success') {
          const next = advanceBillingDate(new Date(sub.nextBillingDate), sub.billingCycle);
          set((state) => ({
            subscriptions: state.subscriptions.map((s) =>
              s.id === id ? { ...s, nextBillingDate: next, updatedAt: new Date() } : s
            ),
          }));
          get().calculateStats();
          await syncRenewalReminders(get().subscriptions);
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
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch subscriptions',
            isLoading: false,
          });
        }
      },

      calculateStats: () => {
        const { subscriptions } = get();

        // Safety check: ensure subscriptions is an array
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

        const activeSubs = subscriptions.filter((sub) => sub.isActive);

        const totalMonthlySpend = activeSubs.reduce((total, sub) => {
          if (sub.billingCycle === 'monthly') return total + sub.price;
          if (sub.billingCycle === 'yearly') return total + sub.price / 12;
          if (sub.billingCycle === 'weekly') return total + sub.price * 4;
          return total + sub.price;
        }, 0);

        const totalYearlySpend = activeSubs.reduce((total, sub) => {
          if (sub.billingCycle === 'yearly') return total + sub.price;
          if (sub.billingCycle === 'monthly') return total + sub.price * 12;
          if (sub.billingCycle === 'weekly') return total + sub.price * 52;
          return total + sub.price * 12;
        }, 0);

        const categoryBreakdown = activeSubs.reduce(
          (acc, sub) => {
            acc[sub.category] = (acc[sub.category] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        set({
          stats: {
            totalActive: activeSubs.length,
            totalMonthlySpend,
            totalYearlySpend,
            categoryBreakdown,
          },
        });
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
            error: 'Stored subscription data is corrupted. Loaded fallback data.',
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
      },
    }
  )
);
