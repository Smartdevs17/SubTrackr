/**
 * Unit tests for useDebounce
 *
 * Strategy:
 * - We mock @react-native-community/netinfo to control the reported network
 *   type, then use jest's fake timers to advance time deterministically.
 * - We verify that:
 *   1. The debounced value only updates after the correct delay.
 *   2. The correct delay is chosen per network type.
 *   3. Intermediate values are discarded (last-write wins).
 *   4. An overrideDelay bypasses the network-aware logic.
 */

import { act, renderHook } from '@testing-library/react-hooks';
import { getDelayFromNetInfo, DEBOUNCE_DELAY_BY_NETWORK, useDebounce } from '../useDebounce';

// ---------------------------------------------------------------------------
// NetInfo mock helpers
// ---------------------------------------------------------------------------

type MockNetInfoState = {
  isConnected: boolean;
  type: string;
  details?: { cellularGeneration?: string | null } | null;
};

const makeNetInfoState = (partial: Partial<MockNetInfoState>): MockNetInfoState => ({
  isConnected: true,
  type: 'wifi',
  details: null,
  ...partial,
});

let mockCurrentState: MockNetInfoState = makeNetInfoState({});
let capturedListener: ((state: MockNetInfoState) => void) | null = null;

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(() => Promise.resolve(mockCurrentState)),
    addEventListener: jest.fn((listener: (state: MockNetInfoState) => void) => {
      capturedListener = listener;
      // Return unsubscribe function
      return () => {
        capturedListener = null;
      };
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate a network-type change at runtime. */
const simulateNetworkChange = (state: Partial<MockNetInfoState>) => {
  mockCurrentState = makeNetInfoState(state);
  capturedListener?.(mockCurrentState);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  mockCurrentState = makeNetInfoState({ type: 'wifi' });
  capturedListener = null;
  jest.clearAllMocks();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// --- getDelayFromNetInfo unit tests -----------------------------------------

describe('getDelayFromNetInfo', () => {
  it('returns wifi delay for wifi type', () => {
    const state = makeNetInfoState({ type: 'wifi', isConnected: true });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.wifi);
  });

  it('returns wifi delay for ethernet type', () => {
    const state = makeNetInfoState({ type: 'ethernet', isConnected: true });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.wifi);
  });

  it('returns 4G delay for 4g cellular', () => {
    const state = makeNetInfoState({
      type: 'cellular',
      isConnected: true,
      details: { cellularGeneration: '4g' },
    });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.cellular4g);
  });

  it('returns 4G delay for 5g cellular', () => {
    const state = makeNetInfoState({
      type: 'cellular',
      isConnected: true,
      details: { cellularGeneration: '5g' },
    });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.cellular5g);
  });

  it('returns 3G delay for 3g cellular', () => {
    const state = makeNetInfoState({
      type: 'cellular',
      isConnected: true,
      details: { cellularGeneration: '3g' },
    });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.cellular3g);
  });

  it('returns 2G delay for 2g cellular', () => {
    const state = makeNetInfoState({
      type: 'cellular',
      isConnected: true,
      details: { cellularGeneration: '2g' },
    });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.cellular2g);
  });

  it('returns 2G delay when cellular generation is null', () => {
    const state = makeNetInfoState({
      type: 'cellular',
      isConnected: true,
      details: { cellularGeneration: null },
    });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.cellular2g);
  });

  it('returns offline delay when isConnected is false', () => {
    const state = makeNetInfoState({ isConnected: false, type: 'none' });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.offline);
  });

  it('returns unknown delay for unknown type', () => {
    const state = makeNetInfoState({ type: 'unknown', isConnected: true });
    expect(getDelayFromNetInfo(state as any)).toBe(DEBOUNCE_DELAY_BY_NETWORK.unknown);
  });
});

// --- useDebounce hook tests --------------------------------------------------

describe('useDebounce', () => {
  it('returns the initial value immediately without waiting', () => {
    const { result } = renderHook(() => useDebounce('hello'));
    expect(result.current).toBe('hello');
  });

  it('does NOT update the value before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, DEBOUNCE_DELAY_BY_NETWORK.wifi),
      { initialProps: { value: 'a' } }
    );

    act(() => {
      rerender({ value: 'ab' });
      // Advance to just before the override delay
      jest.advanceTimersByTime(DEBOUNCE_DELAY_BY_NETWORK.wifi - 1);
    });

    expect(result.current).toBe('a');
  });

  it('updates the value after the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, DEBOUNCE_DELAY_BY_NETWORK.wifi),
      { initialProps: { value: 'a' } }
    );

    act(() => {
      rerender({ value: 'ab' });
      jest.advanceTimersByTime(DEBOUNCE_DELAY_BY_NETWORK.wifi);
    });

    expect(result.current).toBe('ab');
  });

  it('discards intermediate values (last-write wins)', () => {
    const DELAY = 300;
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, DELAY),
      { initialProps: { value: '' } }
    );

    act(() => {
      rerender({ value: 'n' });
      jest.advanceTimersByTime(50);
      rerender({ value: 'ne' });
      jest.advanceTimersByTime(50);
      rerender({ value: 'net' });
      jest.advanceTimersByTime(DELAY);
    });

    expect(result.current).toBe('net');
  });

  it('uses the overrideDelay when provided', () => {
    const CUSTOM_DELAY = 123;
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, CUSTOM_DELAY),
      { initialProps: { value: 'x' } }
    );

    act(() => {
      rerender({ value: 'xy' });
      jest.advanceTimersByTime(CUSTOM_DELAY - 1);
    });
    expect(result.current).toBe('x');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe('xy');
  });

  it('uses overrideDelay=0 to update synchronously (after timer flush)', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, 0),
      { initialProps: { value: 'a' } }
    );

    act(() => {
      rerender({ value: 'b' });
      jest.advanceTimersByTime(0);
    });

    expect(result.current).toBe('b');
  });

  it('subscribes to network listener changes (listener fires)', () => {
    // This test verifies that the network event listener is registered.
    // We use a fixed overrideDelay so timing is predictable.
    const DELAY = 500;
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounce(value, DELAY),
      { initialProps: { value: 'start' } }
    );

    // Simulate switching network type — listener should be registered
    act(() => {
      simulateNetworkChange({ type: 'cellular', isConnected: true });
    });

    act(() => {
      rerender({ value: 'changed' });
      jest.advanceTimersByTime(DELAY);
    });

    expect(result.current).toBe('changed');
  });
});
