import { useEffect, useState, useRef, useCallback } from 'react';
import { networkMonitor } from '../services/network/networkMonitor';
import { useSubscriptionStore } from '../store/subscriptionStore';

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(networkMonitor.isOnline());
  const syncStatus = useSubscriptionStore((state) => state.syncStatus);
  const syncWithServer = useSubscriptionStore((state) => state.syncWithServer);

  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const backoffDelayRef = useRef<number>(1000); // start with 1 second

  const triggerSyncWithBackoff = useCallback(async () => {
    // Clear any pending retries
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (!networkMonitor.isOnline()) {
      return;
    }

    try {
      await syncWithServer();
      // On success, reset the backoff delay
      backoffDelayRef.current = 1000;
    } catch (err) {
      // Exponential backoff
      const nextDelay = Math.min(backoffDelayRef.current * 2, 60000); // cap at 60s
      console.warn(`Sync failed, retrying in ${backoffDelayRef.current}ms`, err);
      
      retryTimeoutRef.current = setTimeout(() => {
        triggerSyncWithBackoff();
      }, backoffDelayRef.current);
      
      backoffDelayRef.current = nextDelay;
    }
  }, [syncWithServer]);

  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((connected) => {
      setIsOnline(connected);
      if (connected) {
        // Reset backoff delay on new connection recovery
        backoffDelayRef.current = 1000;
        triggerSyncWithBackoff();
      }
    });

    return () => {
      unsubscribe();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [triggerSyncWithBackoff]);

  return {
    isOnline,
    syncStatus,
    sync: triggerSyncWithBackoff,
  };
}
