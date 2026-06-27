import { useEffect } from 'react';

import { useStore } from '../store';

export function useTransactionQueue(): void {
  useEffect(() => {
    const unsubscribe = useStore.getState().initializeConnectivityListener();
    void useStore.getState().refreshConnectivity();
    void useStore.getState().processQueue();

    return unsubscribe;
  }, []);
}
