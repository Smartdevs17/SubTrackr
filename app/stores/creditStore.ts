/**
 * creditStore.ts — Legacy adapter for the credit slice.
 *
 * Credit state and actions now live in the slices-pattern root store
 * (src/store/slices/creditSlice.ts, Issue #944) and are exposed through
 * the combined `useAppStore`. This adapter keeps existing consumers
 * (`useCreditStore`, its types and actions) working without changes.
 */
export { useAppStore as useCreditStore } from '../../src/store/slices';

export type {
  CreditSlice,
  CreditStoreState,
  CreditTxKind,
  ExpirationPolicy,
  CreditLot,
  CreditTransaction,
  AccountCredit,
  CreditApplied,
  PrepaymentWallet,
  PrepaymentTxKind,
  PrepaymentTransaction,
  PrepaymentSnapshot,
} from '../../src/store/slices';