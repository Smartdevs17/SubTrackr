/**
 * useCachedSubscriptions — thin hook that layers CacheService over subscriptionStore.
 *
 * - Reads from cache first; falls back to store on miss.
 * - Writes through to both cache and store.
 * - Enqueues mutations to the offline queue when offline.
 * - Exposes prefetch for navigation hints.
 */

import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import NetInfo from '@react-native-community/netinfo';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { cacheService } from '../services/cache/cacheService';
import type { Subscription, SubscriptionFormData } from '../types/subscription';

const SUBS_CACHE_KEY = 'subscriptions:all';
const SUBS_TAG = 'subscriptions';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export function useCachedSubscriptions() {
  const {
    subscriptions,
    stats,
    isLoading,
    error,
    fetchSubscriptions: storeFetchSubscriptions,
    addSubscription: storeAddSubscription,
    updateSubscription: storeUpdateSubscription,
    deleteSubscription: storeDeleteSubscription,
  } = useSubscriptionStore(
    useShallow((s) => ({
      subscriptions: s.subscriptions,
      stats: s.stats,
      isLoading: s.isLoading,
      error: s.error,
      fetchSubscriptions: s.fetchSubscriptions,
      addSubscription: s.addSubscription,
      updateSubscription: s.updateSubscription,
      deleteSubscription: s.deleteSubscription,
    }))
  );

  const isOnline = useCallback(async (): Promise<boolean> => {
    const state = await NetInfo.fetch();
    return state.isConnected === true;
  }, []);

  /** Fetch subscriptions — cache-first, then store. */
  const fetchSubscriptions = useCallback(async (): Promise<Subscription[]> => {
    const cached = await cacheService.get<Subscription[]>(SUBS_CACHE_KEY);
    if (cached) return cached;

    await storeFetchSubscriptions();
    const fresh = useSubscriptionStore.getState().subscriptions;
    await cacheService.set(SUBS_CACHE_KEY, fresh, { ttl: CACHE_TTL, tags: [SUBS_TAG] });
    return fresh;
  }, [storeFetchSubscriptions]);

  /** Add — write-through; enqueue offline if no connectivity. */
  const addSubscription = useCallback(
    async (data: SubscriptionFormData): Promise<void> => {
      const online = await isOnline();
      if (!online) {
        await cacheService.enqueueOfflineOperation(
          `add:${data.name}:${Date.now()}`,
          data,
          `add:${data.name}`
        );
        return;
      }
      await storeAddSubscription(data);
      await cacheService.invalidateByTag(SUBS_TAG);
    },
    [storeAddSubscription, isOnline]
  );

  /** Update — write-through; enqueue offline if no connectivity. */
  const updateSubscription = useCallback(
    async (id: string, data: Partial<Subscription>): Promise<void> => {
      const online = await isOnline();
      if (!online) {
        await cacheService.enqueueOfflineOperation(`update:${id}`, data, `update:${id}`);
        return;
      }
      await storeUpdateSubscription(id, data);
      await cacheService.invalidateByTag(SUBS_TAG);
    },
    [storeUpdateSubscription, isOnline]
  );

  /** Delete — write-through; enqueue offline if no connectivity. */
  const deleteSubscription = useCallback(
    async (id: string): Promise<void> => {
      const online = await isOnline();
      if (!online) {
        await cacheService.enqueueOfflineOperation(`delete:${id}`, { id }, `delete:${id}`);
        return;
      }
      await storeDeleteSubscription(id);
      await cacheService.invalidateByTag(SUBS_TAG);
    },
    [storeDeleteSubscription, isOnline]
  );

  /** Flush offline queue when connectivity is restored. */
  const syncOfflineQueue = useCallback(async (): Promise<void> => {
    const ops = await cacheService.flushOfflineQueue();
    for (const op of ops) {
      const key = op.key;
      if (key.startsWith('add:')) {
        await storeAddSubscription(op.value as SubscriptionFormData);
      } else if (key.startsWith('update:')) {
        const id = key.replace('update:', '');
        await storeUpdateSubscription(id, op.value as Partial<Subscription>);
      } else if (key.startsWith('delete:')) {
        const id = (op.value as { id: string }).id;
        await storeDeleteSubscription(id);
      }
    }
    await cacheService.invalidateByTag(SUBS_TAG);
  }, [storeAddSubscription, storeUpdateSubscription, storeDeleteSubscription]);

  /** Prefetch subscriptions for a navigation transition. */
  const prefetchSubscriptions = useCallback(async (): Promise<void> => {
    await cacheService.prefetch(
      SUBS_CACHE_KEY,
      async () => {
        await storeFetchSubscriptions();
        return useSubscriptionStore.getState().subscriptions;
      },
      { ttl: CACHE_TTL, tags: [SUBS_TAG] }
    );
  }, [storeFetchSubscriptions]);

  return {
    subscriptions,
    stats,
    isLoading,
    error,
    fetchSubscriptions,
    addSubscription,
    updateSubscription,
    deleteSubscription,
    syncOfflineQueue,
    prefetchSubscriptions,
    cacheMetrics: cacheService.getMetrics(),
  };
}
