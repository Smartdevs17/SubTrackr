// ════════════════════════════════════════════════════════════════
// METERING STORE - real-time usage tracking and usage-based billing
// ════════════════════════════════════════════════════════════════
//
// Mirrors the `subtrackr-metering` Soroban contract: reporters push usage
// increments per (subscription, metric); the store aggregates into period
// buckets, fires alerts on thresholds, exposes trends, and computes usage
// charges over a time range.

import { create } from 'zustand';

export interface MeteredUsage {
  metric: string;
  value: number;
  timestamp: number;
}

export interface UsageBucket {
  start: number;
  units: number;
}

export interface MeterState {
  metric: string;
  total: number;
  lastTimestamp: number;
  periodSecs: number;
  includedUnits: number;
  unitPrice: number;
  alertThreshold: number;
  alertFired: boolean;
  buckets: UsageBucket[];
}

export interface ChargeLine {
  metric: string;
  units: number;
  billableUnits: number;
  unitPrice: number;
  amount: number;
}

export interface Charge {
  subscriptionId: string;
  currency: string;
  total: number;
  lines: ChargeLine[];
}

export interface TimeRange {
  start: number;
  end: number;
}

export const DEFAULT_PERIOD_SECS = 86_400;
const MAX_BUCKETS = 90;

export const bucketStart = (now: number, periodSecs: number): number =>
  periodSecs === 0 ? now : now - (now % periodSecs);

export const billableUnits = (used: number, included: number): number => Math.max(0, used - included);

/** A subscription's meters, keyed by metric. */
type MeterMap = Record<string, MeterState>;

interface MeteringStoreState {
  meters: Record<string, MeterMap>; // subscriptionId -> metric -> state
  now: () => number;
  alerts: { subscriptionId: string; metric: string; total: number }[];

  registerMeter: (
    subscriptionId: string,
    metric: string,
    config: { unitPrice: number; includedUnits: number; periodSecs?: number; alertThreshold?: number },
  ) => void;
  recordUsage: (subscriptionId: string, metric: string, value: number) => MeteredUsage | null;
  calculateUsageCharge: (subscriptionId: string, period: TimeRange) => Charge;
  getMeters: (subscriptionId: string) => MeterState[];
  getUsageTotal: (subscriptionId: string, metric: string) => number;
}

const newMeter = (metric: string, periodSecs: number): MeterState => ({
  metric,
  total: 0,
  lastTimestamp: 0,
  periodSecs,
  includedUnits: 0,
  unitPrice: 0,
  alertThreshold: 0,
  alertFired: false,
  buckets: [],
});

export const useMeteringStore = create<MeteringStoreState>()((set, get) => {
  const metersFor = (sub: string): MeterMap => get().meters[sub] ?? {};

  const commit = (sub: string, map: MeterMap) =>
    set((s) => ({ meters: { ...s.meters, [sub]: map } }));

  const addToBucket = (state: MeterState, now: number, value: number) => {
    const start = bucketStart(now, state.periodSecs);
    const last = state.buckets[state.buckets.length - 1];
    if (last && last.start === start) {
      state.buckets = [
        ...state.buckets.slice(0, -1),
        { start, units: last.units + value },
      ];
    } else {
      state.buckets = [...state.buckets, { start, units: value }];
      if (state.buckets.length > MAX_BUCKETS) state.buckets = state.buckets.slice(-MAX_BUCKETS);
    }
  };

  return {
    meters: {},
    now: () => Math.floor(Date.now() / 1000),
    alerts: [],

    registerMeter: (sub, metric, config) => {
      const map = { ...metersFor(sub) };
      const existing = map[metric] ?? newMeter(metric, config.periodSecs ?? DEFAULT_PERIOD_SECS);
      const state: MeterState = {
        ...existing,
        periodSecs: config.periodSecs ?? existing.periodSecs ?? DEFAULT_PERIOD_SECS,
        includedUnits: config.includedUnits,
        unitPrice: config.unitPrice,
        alertThreshold: config.alertThreshold ?? 0,
        alertFired:
          (config.alertThreshold ?? 0) !== 0 && existing.total >= (config.alertThreshold ?? 0),
      };
      map[metric] = state;
      commit(sub, map);
    },

    recordUsage: (sub, metric, value) => {
      if (value <= 0) return null;
      const now = get().now();
      const map = { ...metersFor(sub) };
      const state: MeterState = { ...(map[metric] ?? newMeter(metric, DEFAULT_PERIOD_SECS)) };
      state.total += value;
      state.lastTimestamp = now;
      addToBucket(state, now, value);
      if (state.alertThreshold !== 0 && !state.alertFired && state.total >= state.alertThreshold) {
        state.alertFired = true;
        set((s) => ({ alerts: [...s.alerts, { subscriptionId: sub, metric, total: state.total }] }));
      }
      map[metric] = state;
      commit(sub, map);
      return { metric, value, timestamp: now };
    },

    calculateUsageCharge: (sub, period) => {
      const map = metersFor(sub);
      const lines: ChargeLine[] = [];
      let total = 0;
      for (const metric of Object.keys(map)) {
        const state = map[metric];
        const used = state.buckets.reduce(
          (sum, b) => (b.start >= period.start && b.start <= period.end ? sum + b.units : sum),
          0,
        );
        const billable = billableUnits(used, state.includedUnits);
        const amount = billable * state.unitPrice;
        total += amount;
        lines.push({ metric, units: used, billableUnits: billable, unitPrice: state.unitPrice, amount });
      }
      return { subscriptionId: sub, currency: 'USD', total, lines };
    },

    getMeters: (sub) => Object.values(metersFor(sub)),
    getUsageTotal: (sub, metric) => metersFor(sub)[metric]?.total ?? 0,
  };
});
