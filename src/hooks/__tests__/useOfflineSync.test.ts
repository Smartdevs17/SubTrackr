import { renderHook, act } from '@testing-library/react-hooks';
import { useOfflineSync } from '../useOfflineSync';
import { networkMonitor } from '../../services/network/networkMonitor';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals';

jest.mock('../../services/network/networkMonitor', () => {
  let isOnlineValue = true;
  const listeners /*: Set<(b: boolean) => void>*/ = new Set();
  return {
    networkMonitor: {
      isOnline: () => isOnlineValue,
      subscribe: (cb) => {
        listeners.add(cb);
        cb(isOnlineValue);
        return () => listeners.delete(cb);
      },
      setOnline: (status) => {
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
    const syncSpy = jest.fn(() => {
      return Promise.reject(new Error('Sync failed'));
    });

    useSubscriptionStore.setState({
      syncWithServer: syncSpy,
    });

    networkMonitor.setOnline(true);
    await act(async () => {
      renderHook(() => useOfflineSync());
    });

    expect(syncSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1100);
    });

    expect(syncSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(2100);
    });
    expect(syncSpy).toHaveBeenCalledTimes(3);
  });
});
