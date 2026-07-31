/**
 * Lightweight Jest mock for @react-native-community/netinfo.
 *
 * This prevents the native NetInfo module from crashing Jest workers in the
 * Node test environment. The mock defaults to reporting a WiFi connection so
 * that useDebounce behaves predictably (fastest debounce) in tests that do
 * not override this themselves.
 *
 * Tests that need to exercise network-type-specific debounce delays should
 * call `jest.mock('@react-native-community/netinfo', ...)` in their own file
 * to override this default.
 */

const wifiState = {
  type: 'wifi',
  isConnected: true,
  isInternetReachable: true,
  details: { isConnectionExpensive: false },
};

const NetInfoMock = {
  fetch: jest.fn(() => Promise.resolve(wifiState)),
  addEventListener: jest.fn(() => {
    // Return a no-op unsubscribe function
    return jest.fn();
  }),
  configure: jest.fn(),
  refresh: jest.fn(() => Promise.resolve(wifiState)),
};

module.exports = {
  __esModule: true,
  default: NetInfoMock,
  NetInfoStateType: {
    unknown: 'unknown',
    none: 'none',
    cellular: 'cellular',
    wifi: 'wifi',
    bluetooth: 'bluetooth',
    ethernet: 'ethernet',
    wimax: 'wimax',
    vpn: 'vpn',
    other: 'other',
  },
  NetInfoCellularGeneration: {
    '2g': '2g',
    '3g': '3g',
    '4g': '4g',
    '5g': '5g',
  },
};
