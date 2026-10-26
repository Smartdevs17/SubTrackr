/**
 * analyticsStore.ts — Legacy adapter for the analytics slice.
 *
 * Analytics state and actions now live in the slices-pattern root store
 * (src/store/slices/analyticsSlice.ts, Issue #944) and are exposed through
 * the combined `useAppStore`. This adapter keeps existing consumers
 * (`useAnalyticsStore`, `DEFAULT_WIDGETS`, `CreditMetricSnapshot`) working
 * without changes.
 */
export { useAppStore as useAnalyticsStore, DEFAULT_WIDGETS } from '../../src/store/slices';

export type { AnalyticsSlice, AnalyticsStoreState, CreditMetricSnapshot } from '../../src/store/slices';