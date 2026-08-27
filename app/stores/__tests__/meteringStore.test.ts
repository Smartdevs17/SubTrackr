import { expect, describe, it, beforeEach, jest } from '@jest/globals';
import { useMeteringStore } from '../meteringStore';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

describe('meteringStore', () => {
  beforeEach(() => {
    useMeteringStore.getState().resetStore();
  });

  describe('Metric Registration', () => {
    it('registers a new usage metric successfully', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-123',
        metricType: 'api_calls',
        metricName: 'API Requests',
        unitName: 'calls',
        unitRate: 0.05,
        includedUnits: 100,
        usageLimit: 1000,
      });

      expect(metric.id).toBeDefined();
      expect(metric.subscriptionId).toBe('sub-123');
      expect(metric.metricType).toBe('api_calls');
      expect(metric.unitRate).toBe(0.05);
      expect(metric.includedUnits).toBe(100);
      expect(metric.currentUsage).toBe(0);

      const subMetrics = useMeteringStore.getState().getSubscriptionMetrics('sub-123');
      expect(subMetrics.length).toBe(1);
      expect(subMetrics[0].id).toBe(metric.id);
    });
  });

  describe('Usage Recording & Accrued Cost Calculation', () => {
    it('records usage within included units with zero accrued cost', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-100',
        metricType: 'storage_gb',
        metricName: 'Cloud Storage',
        unitName: 'GB',
        unitRate: 2.0,
        includedUnits: 50,
      });

      const { metric: updated } = useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-100',
        metricId: metric.id,
        quantity: 30,
      });

      expect(updated.currentUsage).toBe(30);
      expect(updated.cumulativeUsage).toBe(30);
      expect(updated.accruedCost).toBe(0);
    });

    it('accrues cost correctly when usage exceeds included units', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-101',
        metricType: 'compute_minutes',
        metricName: 'GPU Compute',
        unitName: 'minutes',
        unitRate: 0.1,
        includedUnits: 100,
      });

      // Record 150 minutes -> 50 excess minutes * 0.10 = $5.00 accrued cost
      const { metric: updated } = useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-101',
        metricId: metric.id,
        quantity: 150,
      });

      expect(updated.currentUsage).toBe(150);
      expect(updated.accruedCost).toBe(5.0);

      const bill = useMeteringStore.getState().getAccruedBill('sub-101');
      expect(bill).toBe(5.0);
    });

    it('throws error when recording negative or zero quantity', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-102',
        metricType: 'custom',
        metricName: 'Custom Units',
        unitName: 'units',
        unitRate: 1.0,
      });

      expect(() => {
        useMeteringStore.getState().recordUsage({
          subscriptionId: 'sub-102',
          metricId: metric.id,
          quantity: 0,
        });
      }).toThrow('Quantity must be greater than zero');
    });

    it('throws error when metric ID is not found', () => {
      expect(() => {
        useMeteringStore.getState().recordUsage({
          subscriptionId: 'sub-999',
          metricId: 'invalid-id',
          quantity: 10,
        });
      }).toThrow('Metric with ID invalid-id not found');
    });
  });

  describe('Usage Limit Enforcement & Threshold Alerts', () => {
    it('throws error when usage exceeds hard cap limit', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-200',
        metricType: 'data_transfer_gb',
        metricName: 'Bandwidth',
        unitName: 'GB',
        unitRate: 0.5,
        includedUnits: 10,
        usageLimit: 100,
      });

      expect(() => {
        useMeteringStore.getState().recordUsage({
          subscriptionId: 'sub-200',
          metricId: metric.id,
          quantity: 110,
        });
      }).toThrow(/exceeds usage limit/);
    });

    it('triggers alerts at 80%, 90%, and 100% threshold crossings', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-300',
        metricType: 'api_calls',
        metricName: 'API Tier',
        unitName: 'calls',
        unitRate: 0.01,
        includedUnits: 0,
        usageLimit: 100,
      });

      // Jump directly to 85 units (85%)
      const { newAlerts: alerts1 } = useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-300',
        metricId: metric.id,
        quantity: 85,
      });

      expect(alerts1.length).toBe(1);
      expect(alerts1[0].thresholdPercent).toBe(80);

      // Jump from 85 to 95 units (crosses 90%)
      const { newAlerts: alerts2 } = useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-300',
        metricId: metric.id,
        quantity: 10,
      });

      expect(alerts2.length).toBe(1);
      expect(alerts2[0].thresholdPercent).toBe(90);

      // Jump to 100 units (crosses 100%)
      const { newAlerts: alerts3 } = useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-300',
        metricId: metric.id,
        quantity: 5,
      });

      expect(alerts3.length).toBe(1);
      expect(alerts3[0].thresholdPercent).toBe(100);

      const unacknowledged = useMeteringStore.getState().getAlerts('sub-300', true);
      expect(unacknowledged.length).toBe(3);
    });

    it('allows updating usage limit dynamically', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-400',
        metricType: 'api_calls',
        metricName: 'API Calls',
        unitName: 'calls',
        unitRate: 0.01,
        usageLimit: 50,
      });

      useMeteringStore.getState().setUsageLimit('sub-400', metric.id, 200);

      const updated = useMeteringStore.getState().metrics[metric.id];
      expect(updated.usageLimit).toBe(200);

      // Should now allow recording 100 units without throwing
      const { metric: recorded } = useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-400',
        metricId: metric.id,
        quantity: 100,
      });
      expect(recorded.currentUsage).toBe(100);
    });
  });

  describe('Cycle Reset & History', () => {
    it('resets current cycle usage while preserving cumulative usage', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-500',
        metricType: 'storage_gb',
        metricName: 'Storage',
        unitName: 'GB',
        unitRate: 1.0,
        includedUnits: 10,
      });

      useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-500',
        metricId: metric.id,
        quantity: 25,
      });

      useMeteringStore.getState().resetCycleUsage('sub-500');

      const resetMetric = useMeteringStore.getState().metrics[metric.id];
      expect(resetMetric.currentUsage).toBe(0);
      expect(resetMetric.accruedCost).toBe(0);
      expect(resetMetric.cumulativeUsage).toBe(25);
    });

    it('tracks and filters usage history logs correctly', () => {
      const metric1 = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-600',
        metricType: 'api_calls',
        metricName: 'API Calls',
        unitName: 'calls',
        unitRate: 0.01,
      });

      const metric2 = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-600',
        metricType: 'compute_minutes',
        metricName: 'Compute',
        unitName: 'min',
        unitRate: 0.1,
      });

      useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-600',
        metricId: metric1.id,
        quantity: 10,
      });

      useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-600',
        metricId: metric2.id,
        quantity: 5,
      });

      const allHistory = useMeteringStore.getState().getUsageHistory('sub-600');
      expect(allHistory.length).toBe(2);

      const metric1History = useMeteringStore.getState().getUsageHistory('sub-600', metric1.id);
      expect(metric1History.length).toBe(1);
      expect(metric1History[0].quantity).toBe(10);
    });
  });

  describe('Telemetry & Alerts Management', () => {
    it('simulates telemetry input correctly', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-700',
        metricType: 'api_calls',
        metricName: 'API Requests',
        unitName: 'calls',
        unitRate: 0.01,
      });

      const event = useMeteringStore.getState().simulateTelemetry('sub-700', metric.id, 15);
      expect(event.quantity).toBe(15);
      expect(event.reportedBy).toBe('telemetry_simulator');

      const updated = useMeteringStore.getState().metrics[metric.id];
      expect(updated.currentUsage).toBe(15);
    });

    it('acknowledges alerts', () => {
      const metric = useMeteringStore.getState().registerMetric({
        subscriptionId: 'sub-800',
        metricType: 'api_calls',
        metricName: 'Calls',
        unitName: 'calls',
        unitRate: 0.01,
        usageLimit: 10,
      });

      useMeteringStore.getState().recordUsage({
        subscriptionId: 'sub-800',
        metricId: metric.id,
        quantity: 9,
      });

      const alerts = useMeteringStore.getState().getAlerts('sub-800', true);
      expect(alerts.length).toBe(1);

      useMeteringStore.getState().acknowledgeAlert(alerts[0].id);

      const unackAfter = useMeteringStore.getState().getAlerts('sub-800', true);
      expect(unackAfter.length).toBe(0);
    });
  });
});
