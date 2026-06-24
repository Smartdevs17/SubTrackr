import { useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState, NetInfoCellularGeneration } from '@react-native-community/netinfo';

/**
 * Debounce delays per network condition.
 *
 * - WiFi / Ethernet: 300 ms  — fast, responsive UX
 * - 4G / 5G cellular: 400 ms — still quick but slightly conservative
 * - 3G cellular: 700 ms      — gives the network more breathing room
 * - 2G / GPRS / EDGE: 1000 ms — prevents request congestion on very slow links
 * - Offline / unknown: 800 ms — no point firing quickly; queue requests less
 */
const DEBOUNCE_DELAY_BY_NETWORK = {
  wifi: 300,
  cellular5g: 400,
  cellular4g: 400,
  cellular3g: 700,
  cellular2g: 1000,
  offline: 800,
  unknown: 500,
} as const;

/** Derives the debounce delay from a NetInfo state snapshot. */
function getDelayFromNetInfo(state: NetInfoState): number {
  if (!state.isConnected) {
    return DEBOUNCE_DELAY_BY_NETWORK.offline;
  }

  switch (state.type) {
    case 'wifi':
    case 'ethernet':
      return DEBOUNCE_DELAY_BY_NETWORK.wifi;

    case 'cellular': {
      const gen: NetInfoCellularGeneration | null | undefined =
        state.details?.cellularGeneration;
      if (gen === '5g' || gen === '4g') {
        return DEBOUNCE_DELAY_BY_NETWORK.cellular4g;
      }
      if (gen === '3g') {
        return DEBOUNCE_DELAY_BY_NETWORK.cellular3g;
      }
      // '2g' or null (undetectable generation) — assume worst case
      return DEBOUNCE_DELAY_BY_NETWORK.cellular2g;
    }

    default:
      return DEBOUNCE_DELAY_BY_NETWORK.unknown;
  }
}

/**
 * `useDebounce` — returns a debounced copy of `value`.
 *
 * The debounce delay is **network-aware**: it is derived from the current
 * network connection type via `@react-native-community/netinfo` so that
 * search inputs are responsive on fast links and conservative on slow ones.
 *
 * @param value  The value to debounce (typically a search query string).
 * @param overrideDelay  Optional fixed delay (ms) to use regardless of network.
 *                       Useful in tests or when the caller wants to opt out of
 *                       the adaptive behaviour.
 */
export function useDebounce<T>(value: T, overrideDelay?: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const delayRef = useRef<number>(DEBOUNCE_DELAY_BY_NETWORK.unknown);

  // Subscribe to network changes and keep delayRef up to date.
  useEffect(() => {
    if (overrideDelay !== undefined) {
      delayRef.current = overrideDelay;
      return;
    }

    // Fetch the current state immediately so the first debounce uses the right
    // delay rather than the default fallback.
    NetInfo.fetch().then((state) => {
      delayRef.current = getDelayFromNetInfo(state);
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      delayRef.current = getDelayFromNetInfo(state);
    });

    return unsubscribe;
  }, [overrideDelay]);

  // Re-schedule the debounce whenever `value` changes, using the current delay.
  useEffect(() => {
    const delay = overrideDelay !== undefined ? overrideDelay : delayRef.current;
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, overrideDelay]);

  return debouncedValue;
}

export { getDelayFromNetInfo, DEBOUNCE_DELAY_BY_NETWORK };
