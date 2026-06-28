/**
 * useCachedSubscriptions — thin hook that layers CacheService over subscriptionStore.
 *
 * - Reads from cache first; falls back to store on miss.
 * - Writes through to both cache and store.
 * - Enqueues mutations to the offline queue when offline.
 * - Exposes prefetch for navigation hints.
 */

import { useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { cacheService } from '../services/cache/cacheService';
import type { Subscription, SubscriptionFormData } from '../types/subscription';

const SUBS_CACHE_KEY = 'subscriptions:all';
const SUBS_TAG = 'subscriptions';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export function useCachedSubscriptions() {
  const store = useSubscriptionStore();

  const isOnline = useCallback(async (): Promise<boolean> => {
    const state = await NetInfo.fetch();
    return state.isConnected === true;
  }, []);

  /** Fetch subscriptions — cache-first, then store. */
  const fetchSubscriptions = useCallback(async (): Promise<Subscription[]> => {
    const cached = await cacheService.get<Subscription[]>(SUBS_CACHE_KEY);
    if (cached) return cached;

    await store.fetchSubscriptions();
    const fresh = store.subscriptions;
    await cacheService.set(SUBS_CACHE_KEY, fresh, { ttl: CACHE_TTL, tags: [SUBS_TAG] });
    return fresh;
  }, [store]);

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
      await store.addSubscription(data);
      await cacheService.invalidateByTag(SUBS_TAG);
    },
    [store, isOnline]
  );

  /** Update — write-through; enqueue offline if no connectivity. */
  const updateSubscription = useCallback(
    async (id: string, data: Partial<Subscription>): Promise<void> => {
      const online = await isOnline();
      if (!online) {
        await cacheService.enqueueOfflineOperation(`update:${id}`, data, `update:${id}`);
        return;
      }
      await store.updateSubscription(id, data);
      await cacheService.invalidateByTag(SUBS_TAG);
    },
    [store, isOnline]
  );

  /** Delete — write-through; enqueue offline if no connectivity. */
  const deleteSubscription = useCallback(
    async (id: string): Promise<void> => {
      const online = await isOnline();
      if (!online) {
        await cacheService.enqueueOfflineOperation(`delete:${id}`, { id }, `delete:${id}`);
        return;
      }
      await store.deleteSubscription(id);
      await cacheService.invalidateByTag(SUBS_TAG);
    },
    [store, isOnline]
  );

  /** Flush offline queue when connectivity is restored. */
  const syncOfflineQueue = useCallback(async (): Promise<void> => {
    const ops = await cacheService.flushOfflineQueue();
    for (const op of ops) {
      const key = op.key;
      if (key.startsWith('add:')) {
        await store.addSubscription(op.value as SubscriptionFormData);
      } else if (key.startsWith('update:')) {
        const id = key.replace('update:', '');
        await store.updateSubscription(id, op.value as Partial<Subscription>);
      } else if (key.startsWith('delete:')) {
        const id = (op.value as { id: string }).id;
        await store.deleteSubscription(id);
      }
    }
    await cacheService.invalidateByTag(SUBS_TAG);
  }, [store]);

  /** Prefetch subscriptions for a navigation transition. */
  const prefetchSubscriptions = useCallback(async (): Promise<void> => {
    await cacheService.prefetch(
      SUBS_CACHE_KEY,
      async () => {
        await store.fetchSubscriptions();
        return store.subscriptions;
      },
      { ttl: CACHE_TTL, tags: [SUBS_TAG] }
    );
  }, [store]);

  return {
    subscriptions: store.subscriptions,
    stats: store.stats,
    isLoading: store.isLoading,
    error: store.error,
    fetchSubscriptions,
    addSubscription,
    updateSubscription,
    deleteSubscription,
    syncOfflineQueue,
    prefetchSubscriptions,
    cacheMetrics: cacheService.getMetrics(),
  };
}
