import { networkMonitor } from '../../../services/network/networkMonitor';
import { syncRenewalReminders } from '../../../services/notificationService';
import { useCalendarStore } from '../../calendarStore';
import { errorHandler } from '../../../services/errorHandler';
import { Subscription, SubscriptionFormData } from '../../../types/subscription';
import { SubscriptionCRDT } from '../../../services/cache/crdt';

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

export const initialSubscriptionDataState = {
  subscriptions: [] as Subscription[],
  isLoading: true,
  error: null as unknown,
};

export function createSubscriptionDataSlice(set: any, get: any) {
  return {
    ...initialSubscriptionDataState,

    addSubscription: async (data: SubscriptionFormData) => {
      set({ isLoading: true, error: null });
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
      set((state: any) => ({
        subscriptions: [...state.subscriptions, newSubscription],
        syncStatus: 'pending',
        isLoading: false,
      }));
      try {
        get().calculateStats();
      } catch {}
      try {
        await syncRenewalReminders(get().subscriptions);
      } catch {}
    },

    updateSubscription: async (id: string, data: Partial<Subscription>) => {
      set({ isLoading: true, error: null });
      const subs = get().subscriptions;
      const sub = subs.find((s: Subscription) => s.id === id);
      if (!sub) {
        set({ isLoading: false });
        return;
      }
      const updatedSubscription = { ...sub, ...data, updatedAt: new Date() };
      set((state: any) => ({
        subscriptions: state.subscriptions.map((s: Subscription) =>
          s.id === id ? updatedSubscription : s
        ),
        isLoading: false,
      }));
      try {
        get().calculateStats();
      } catch {}
      try {
        await syncRenewalReminders(get().subscriptions);
      } catch {}
    },

    deleteSubscription: async (id: string) => {
      try {
        const current = get().subscriptions.find((sub: Subscription) => sub.id === id);
        if (!current) throw new Error('Subscription not found');

        const timestamp = Date.now();
        const currentMeta = SubscriptionCRDT.createMetadata(current, timestamp - 1000);
        const updatedMetadata = { ...currentMeta, deletedAt: timestamp };

        set((state: any) => ({
          subscriptions: state.subscriptions.filter((sub: Subscription) => sub.id !== id),
          crdtMetadata: { ...state.crdtMetadata, [id]: updatedMetadata },
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
        set({ error: appError, isLoading: false });
      }
    },

    toggleSubscriptionStatus: async (id: string) => {
      set({ isLoading: true, error: null });
      try {
        const sub = get().subscriptions.find((s: Subscription) => s.id === id);
        if (!sub) throw new Error('Subscription not found');

        const updatedSubscription = { ...sub, isActive: !sub.isActive, updatedAt: new Date() };
        const timestamp = Date.now();
        const currentMeta = SubscriptionCRDT.createMetadata(sub, timestamp - 1000);
        const updatedMetadata = SubscriptionCRDT.updateMetadata(
          currentMeta,
          { isActive: !sub.isActive },
          timestamp
        );

        set((state: any) => ({
          subscriptions: state.subscriptions.map((s: Subscription) =>
            s.id === id ? updatedSubscription : s
          ),
          crdtMetadata: { ...state.crdtMetadata, [id]: updatedMetadata },
          syncStatus: 'pending',
          isLoading: false,
        }));

        get().calculateStats();
        await syncRenewalReminders(get().subscriptions);
        const updated = get().subscriptions.find((s: Subscription) => s.id === id);
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
        set({ error: appError, isLoading: false });
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
          error: errorHandler.handleError(error as Error, { action: 'fetchSubscriptions' }),
          isLoading: false,
        });
      }
    },
  };
}
