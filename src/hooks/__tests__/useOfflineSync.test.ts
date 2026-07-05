import { renderHook, act } from '@testing-library/react-hooks';
import { useOfflineSync } from '../useOfflineSync';
import { networkMonitor } from '../../services/network/networkMonitor';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('../../services/network/networkMonitor', () => {
  let isOnlineValue = true;
  const listeners = new Set<(connected: boolean) => void>();
  return {
    networkMonitor: {
      isOnline: () => isOnlineValue,
      subscribe: (cb: (connected: boolean) => void) => {
        listeners.add(cb);
        cb(isOnlineValue);
        return () => listeners.delete(cb);
      },
      setOnline: (status: boolean) => {
        isOnlineValue = status;
        listeners.forEach((cb) => cb(status));
      },
    },
  };
});

describe('useOfflineSync hook', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useSubscriptionStore.setState({
      syncStatus: 'idle',
      subscriptions: [],
      crdtMetadata: {},
      syncWithServer: jest.fn(() => Promise.resolve()),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initially returns online status and store syncStatus', () => {
    networkMonitor.setOnline(true);
    const { result } = renderHook(() => useOfflineSync());

    expect(result.current.isOnline).toBe(true);
    expect(result.current.syncStatus).toBe('idle');
  });

  it('updates online status when network changes', () => {
    const { result } = renderHook(() => useOfflineSync());

    act(() => {
      networkMonitor.setOnline(false);
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('triggers syncWithServer immediately when connection is restored', () => {
    const syncSpy = jest.fn(() => Promise.resolve());
    useSubscriptionStore.setState({
      syncWithServer: syncSpy,
    });

    networkMonitor.setOnline(false);
    renderHook(() => useOfflineSync());

    act(() => {
      networkMonitor.setOnline(true);
    });

    expect(syncSpy).toHaveBeenCalledTimes(1);
  });

  it('retries sync operation with exponential backoff on failure', async () => {
    let callCount = 0;
    const syncSpy = jest.fn(() => {
      callCount++;
      return Promise.reject(new Error('Sync failed'));
    });

    useSubscriptionStore.setState({
      syncWithServer: syncSpy,
    });

    networkMonitor.setOnline(true);
    renderHook(() => useOfflineSync());

    expect(syncSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(syncSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(syncSpy).toHaveBeenCalledTimes(3);
  });
});
