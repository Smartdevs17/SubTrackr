import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  UsageMetric,
  UsageEvent,
  UsageAlert,
  RegisterMetricParams,
  RecordUsageParams,
} from '../types/metering';

const STORAGE_KEY = 'subtrackr-metering-storage';
const STORE_VERSION = 1;

export interface MeteringState {
  metrics: Record<string, UsageMetric>;
  events: UsageEvent[];
  alerts: UsageAlert[];
  subscriptionMetricsMap: Record<string, string[]>;

  // Actions
  registerMetric: (params: RegisterMetricParams) => UsageMetric;
  recordUsage: (params: RecordUsageParams) => { metric: UsageMetric; newAlerts: UsageAlert[] };
  setUsageLimit: (subscriptionId: string, metricId: string, limit: number) => UsageMetric | undefined;
  resetCycleUsage: (subscriptionId: string, metricId?: string) => void;
  getAccruedBill: (subscriptionId: string) => number;
  getSubscriptionMetrics: (subscriptionId: string) => UsageMetric[];
  getUsageHistory: (subscriptionId: string, metricId?: string) => UsageEvent[];
  getAlerts: (subscriptionId?: string, unacknowledgedOnly?: boolean) => UsageAlert[];
  acknowledgeAlert: (alertId: string) => void;
  clearUsageHistory: (subscriptionId?: string) => void;
  simulateTelemetry: (subscriptionId: string, metricId: string, quantity?: number) => UsageEvent;
  resetStore: () => void;
}

const generateId = (prefix: string): string => {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${randomStr}`;
};

const calculateAccruedCost = (metric: UsageMetric): number => {
  if (metric.currentUsage <= metric.includedUnits) {
    return 0;
  }
  const excessUnits = metric.currentUsage - metric.includedUnits;
  return Number((excessUnits * metric.unitRate).toFixed(2));
};

const checkThresholdAlerts = (
  metric: UsageMetric,
  prevUsage: number,
  newUsage: number
): UsageAlert[] => {
  if (!metric.usageLimit || metric.usageLimit <= 0) return [];

  const prevPercent = (prevUsage / metric.usageLimit) * 100;
  const newPercent = (newUsage / metric.usageLimit) * 100;

  const thresholds = [80, 90, 100];
  const newAlerts: UsageAlert[] = [];

  for (const threshold of thresholds) {
    if (prevPercent < threshold && newPercent >= threshold) {
      newAlerts.push({
        id: generateId('alert'),
        subscriptionId: metric.subscriptionId,
        metricId: metric.id,
        thresholdPercent: threshold,
        message:
          threshold >= 100
            ? `Usage limit (100%) reached for ${metric.metricName} on subscription ${metric.subscriptionId}`
            : `Usage reached ${threshold}% of limit for ${metric.metricName} on subscription ${metric.subscriptionId}`,
        triggeredAt: new Date().toISOString(),
        acknowledged: false,
      });
    }
  }

  return newAlerts;
};

export const useMeteringStore = create<MeteringState>()(
  persist(
    (set, get) => ({
      metrics: {},
      events: [],
      alerts: [],
      subscriptionMetricsMap: {},

      registerMetric: (params: RegisterMetricParams): UsageMetric => {
        const now = new Date();
        const cycleEnd = new Date(now);
        cycleEnd.setDate(cycleEnd.getDate() + (params.billingCycleDays ?? 30));

        const id = generateId('metric');
        const newMetric: UsageMetric = {
          id,
          subscriptionId: params.subscriptionId,
          metricType: params.metricType,
          metricName: params.metricName,
          unitName: params.unitName,
          unitRate: params.unitRate,
          includedUnits: params.includedUnits ?? 0,
          currentUsage: 0,
          cumulativeUsage: 0,
          usageLimit: params.usageLimit ?? 0,
          accruedCost: 0,
          lastUpdated: now.toISOString(),
          billingCycleStart: now.toISOString(),
          billingCycleEnd: cycleEnd.toISOString(),
        };

        set((state) => {
          const currentMap = state.subscriptionMetricsMap[params.subscriptionId] ?? [];
          return {
            metrics: { ...state.metrics, [id]: newMetric },
            subscriptionMetricsMap: {
              ...state.subscriptionMetricsMap,
              [params.subscriptionId]: [...currentMap, id],
            },
          };
        });

        return newMetric;
      },

      recordUsage: (params: RecordUsageParams) => {
        const { metrics, events, alerts } = get();
        const targetMetric = metrics[params.metricId];

        if (!targetMetric) {
          throw new Error(`Metric with ID ${params.metricId} not found`);
        }

        if (params.quantity <= 0) {
          throw new Error('Quantity must be greater than zero');
        }

        const prevUsage = targetMetric.currentUsage;
        const newCurrentUsage = prevUsage + params.quantity;

        if (targetMetric.usageLimit > 0 && newCurrentUsage > targetMetric.usageLimit) {
          throw new Error(
            `Recording ${params.quantity} ${targetMetric.unitName} exceeds usage limit of ${targetMetric.usageLimit}`
          );
        }

        const nowIso = new Date().toISOString();
        const updatedMetric: UsageMetric = {
          ...targetMetric,
          currentUsage: newCurrentUsage,
          cumulativeUsage: targetMetric.cumulativeUsage + params.quantity,
          lastUpdated: nowIso,
          accruedCost: calculateAccruedCost({
            ...targetMetric,
            currentUsage: newCurrentUsage,
          }),
        };

        const newAlerts = checkThresholdAlerts(targetMetric, prevUsage, newCurrentUsage);

        const newEvent: UsageEvent = {
          id: generateId('event'),
          subscriptionId: params.subscriptionId,
          metricId: params.metricId,
          quantity: params.quantity,
          timestamp: nowIso,
          reportedBy: params.reportedBy ?? 'user',
          metadata: params.metadata,
        };

        set((state) => ({
          metrics: { ...state.metrics, [params.metricId]: updatedMetric },
          events: [newEvent, ...state.events],
          alerts: [...newAlerts, ...state.alerts],
        }));

        return { metric: updatedMetric, newAlerts };
      },

      setUsageLimit: (subscriptionId: string, metricId: string, limit: number) => {
        const { metrics } = get();
        const targetMetric = metrics[metricId];
        if (!targetMetric || targetMetric.subscriptionId !== subscriptionId) {
          return undefined;
        }

        if (limit < 0) {
          throw new Error('Usage limit cannot be negative');
        }

        const updatedMetric: UsageMetric = {
          ...targetMetric,
          usageLimit: limit,
          lastUpdated: new Date().toISOString(),
        };

        set((state) => ({
          metrics: { ...state.metrics, [metricId]: updatedMetric },
        }));

        return updatedMetric;
      },

      resetCycleUsage: (subscriptionId: string, metricId?: string) => {
        const { metrics, subscriptionMetricsMap } = get();
        const targetMetricIds = metricId
          ? [metricId]
          : subscriptionMetricsMap[subscriptionId] ?? [];

        const now = new Date();
        const nextEnd = new Date(now);
        nextEnd.setDate(nextEnd.getDate() + 30);

        const updatedMetrics = { ...metrics };
        for (const id of targetMetricIds) {
          if (updatedMetrics[id]) {
            updatedMetrics[id] = {
              ...updatedMetrics[id],
              currentUsage: 0,
              accruedCost: 0,
              billingCycleStart: now.toISOString(),
              billingCycleEnd: nextEnd.toISOString(),
              lastUpdated: now.toISOString(),
            };
          }
        }

        set({ metrics: updatedMetrics });
      },

      getAccruedBill: (subscriptionId: string): number => {
        const metrics = get().getSubscriptionMetrics(subscriptionId);
        const totalMeteredCost = metrics.reduce((sum, m) => sum + m.accruedCost, 0);
        return Number(totalMeteredCost.toFixed(2));
      },

      getSubscriptionMetrics: (subscriptionId: string): UsageMetric[] => {
        const { metrics, subscriptionMetricsMap } = get();
        const ids = subscriptionMetricsMap[subscriptionId] ?? [];
        return ids.map((id) => metrics[id]).filter(Boolean);
      },

      getUsageHistory: (subscriptionId: string, metricId?: string): UsageEvent[] => {
        const { events } = get();
        return events.filter(
          (e) =>
            e.subscriptionId === subscriptionId &&
            (!metricId || e.metricId === metricId)
        );
      },

      getAlerts: (subscriptionId?: string, unacknowledgedOnly = false): UsageAlert[] => {
        const { alerts } = get();
        return alerts.filter((alert) => {
          if (subscriptionId && alert.subscriptionId !== subscriptionId) {
            return false;
          }
          if (unacknowledgedOnly && alert.acknowledged) {
            return false;
          }
          return true;
        });
      },

      acknowledgeAlert: (alertId: string) => {
        set((state) => ({
          alerts: state.alerts.map((alert) =>
            alert.id === alertId ? { ...alert, acknowledged: true } : alert
          ),
        }));
      },

      clearUsageHistory: (subscriptionId?: string) => {
        set((state) => ({
          events: subscriptionId
            ? state.events.filter((e) => e.subscriptionId !== subscriptionId)
            : [],
        }));
      },

      simulateTelemetry: (subscriptionId: string, metricId: string, quantity = 1): UsageEvent => {
        const result = get().recordUsage({
          subscriptionId,
          metricId,
          quantity,
          reportedBy: 'telemetry_simulator',
          metadata: { simulated: true },
        });
        return get().events.find((e) => e.metricId === metricId) ?? {
          id: generateId('event'),
          subscriptionId,
          metricId,
          quantity,
          timestamp: new Date().toISOString(),
          reportedBy: 'telemetry_simulator',
        };
      },

      resetStore: () => {
        set({
          metrics: {},
          events: [],
          alerts: [],
          subscriptionMetricsMap: {},
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
