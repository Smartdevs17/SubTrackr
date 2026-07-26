import AsyncStorage from '@react-native-async-storage/async-storage';
import { networkMonitor } from '../../../services/network/networkMonitor';
import { syncRenewalReminders } from '../../../services/notificationService';
import { useCalendarStore } from '../../calendarStore';
import { SubscriptionCRDT, CRDTSubscriptionState } from '../../../services/cache/crdt';
import { errorHandler } from '../../../services/errorHandler';
import type { Subscription } from '../../../types/subscription';

export const initialSubscriptionSyncState = {
  syncStatus: 'idle' as const,
  crdtMetadata: {} as Record<string, object>,
};

export function createSubscriptionSyncSlice(set: any, get: any) {
  return {
    ...initialSubscriptionSyncState,

    setSyncStatus: (status: 'idle' | 'pending' | 'syncing' | 'conflict' | 'error') =>
      set({ syncStatus: status }),

    syncWithServer: async () => {
      if (!networkMonitor.isOnline()) {
        set({ syncStatus: 'pending' });
        return;
      }
      if (get().syncStatus === 'syncing') return;

      set({ syncStatus: 'syncing', error: null });
      try {
        const localState = {
          subscriptions: get().subscriptions.reduce(
            (acc: Record<string, Subscription>, sub: Subscription) => {
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
        });

        get().calculateStats();
        await syncRenewalReminders(get().subscriptions);
        await useCalendarStore.getState().syncSubscriptions(get().subscriptions);
      } catch (err) {
        set({
          syncStatus: 'error',
          error: errorHandler.handleError(err as Error, { action: 'syncWithServer' }),
        });
      }
    },
  };
}

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
