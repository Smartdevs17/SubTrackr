/**
 * meteringStore.ts — Legacy adapter for the metering slice.
 *
 * Usage tracking state and actions now live in the slices-pattern root store
 * (src/store/slices/meteringSlice.ts, Issue #944) and are exposed through
 * the combined `useAppStore`. This adapter keeps existing consumers
 * (`useMeteringStore`) working without changes.
 */
export { useAppStore as useMeteringStore } from '../../src/store/slices';

export type {
  MeteringSlice,
  MeteringStoreState,
  MeteredUsage,
  UsageBucket,
  MeterState,
  ChargeLine,
  Charge,
  TimeRange,
  UsageAlertEntry,
  UsageTrend,
  UsageAnalytics,
} from '../../src/store/slices';

export { DEFAULT_PERIOD_SECS, bucketStart, billableUnits } from '../../src/store/slices';