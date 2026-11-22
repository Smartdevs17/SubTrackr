import { expect, describe, it, beforeEach, jest } from '@jest/globals';
import { useMeteringStore } from '../meteringStore';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

describe('src/store/meteringStore re-export', () => {
  beforeEach(() => {
    useMeteringStore.setState({
      meters: {},
      alerts: [],
      usageHistory: [],
    });
    jest.clearAllMocks();
  });

  it('exports a functioning metering store against the combined slice', () => {
    useMeteringStore.getState().registerMeter('sub-test', 'api_calls', {
      unitPrice: 0.01,
      includedUnits: 100,
    });
    useMeteringStore.getState().recordUsage('sub-test', 'api_calls', 120);

    expect(useMeteringStore.getState().getUsageTotal('sub-test', 'api_calls')).toBe(120);
    expect(useMeteringStore.getState().getMeters('sub-test')).toHaveLength(1);

    const charge = useMeteringStore.getState().calculateUsageCharge('sub-test', {
      start: 0,
      end: Date.now(),
    });
    expect(charge.lines).toHaveLength(1);
    expect(charge.lines[0].billableUnits).toBe(20);
    expect(charge.total).toBeCloseTo(0.2);
  });

  it('reports usage analytics with alerts over the combined slice', () => {
    useMeteringStore.getState().registerMeter('sub-test', 'api_calls', {
      unitPrice: 0.01,
      includedUnits: 0,
      alertThreshold: 10,
    });
    useMeteringStore.getState().recordUsage('sub-test', 'api_calls', 15);

    const analytics = useMeteringStore.getState().getAnalytics('sub-test');
    expect(analytics.totalUsage).toBe(15);
    expect(analytics.alertsCount).toBe(1);
    expect(useMeteringStore.getState().getActiveAlerts('sub-test')).toHaveLength(1);
  });
});
