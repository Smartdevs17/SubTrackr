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
    useMeteringStore.getState().resetStore();
  });

  it('exports functioning useMeteringStore instance', () => {
    const metric = useMeteringStore.getState().registerMetric({
      subscriptionId: 'sub-test',
      metricType: 'api_calls',
      metricName: 'API',
      unitName: 'calls',
      unitRate: 0.01,
    });

    expect(metric.id).toBeDefined();
    expect(useMeteringStore.getState().getSubscriptionMetrics('sub-test').length).toBe(1);
  });
});
