/**
 * billingStore.ts — Legacy adapter for the billing slice.
 *
 * Issue #2045 — Collapse repeated Zustand stores into feature-scoped slices.
 *
 * Calendar-based billing schedule and invoice state now lives in the
 * slices-pattern root store (src/store/slices/billingSlice.ts) and is exposed
 * through the combined `useAppStore`. This adapter keeps existing consumers
 * (`useBillingStore`, its types, `calculateNextBillingDate`) working without
 * changes.
 */
export { useAppStore as useBillingStore } from '../../src/store/slices';

export type {
  BillingSlice,
  BillingStoreState,
  AdjustmentPolicy,
  CalendarBilling,
  CalendarInvoice,
  InvoiceStatus,
  MerchantBillingSchedule,
} from '../../src/store/slices';

export { calculateNextBillingDate, calculateProRataAmount } from '../../src/store/slices';
