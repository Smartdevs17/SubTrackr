import { useEffect } from 'react';

import { useTransactionQueueStore } from '../store/transactionQueueStore';

export function useTransactionQueue(): void {
  useEffect(() => {
    const unsubscribe = useTransactionQueueStore.getState().initializeConnectivityListener();
    void useTransactionQueueStore.getState().refreshConnectivity();
    void useTransactionQueueStore.getState().processQueue();

    return unsubscribe;
  }, []);
}
