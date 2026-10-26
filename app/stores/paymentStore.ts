/**
 * paymentStore.ts — Legacy adapter for the payment slice.
 *
 * Payment state and actions now live in the slices-pattern root store
 * (src/store/slices/paymentSlice.ts, Issue #944) and are exposed through
 * the combined `useAppStore`. This adapter keeps existing consumers
 * (`usePaymentStore`) working without changes.
 *
 * The combined store keeps the usage-analytics action on the metering slice
 * under `getAnalytics`, so the payment analytics action is named
 * `getPaymentAnalytics` there. This module re-exposes it under the legacy
 * `getAnalytics` name on the combined handle so `PaymentMethodsScreen` and
 * other consumers keep working.
 */
import { useAppStore } from '../../src/store/slices';
import type { AppState } from '../../src/store/slices';

useAppStore.setState({
  getAnalytics: () => useAppStore.getState().getPaymentAnalytics(),
} as Partial<AppState>);

export { useAppStore as usePaymentStore } from '../../src/store/slices';

export type {
  PaymentSlice,
  PaymentStoreState,
  PaymentPriority,
  PaymentMethod,
  PaymentFailureReason,
  PaymentAttemptResult,
  FallbackChain,
  ChainValidation,
  ExpiryAlertSeverity,
  ExpiryAlert,
  PaymentMethodStats,
  PaymentAnalytics,
} from '../../src/store/slices';

export { MAX_CHAIN_LENGTH, EXPIRY_CRITICAL_DAYS } from '../../src/store/slices';