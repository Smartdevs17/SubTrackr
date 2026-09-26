/**
 * transactionStore.ts — Transaction history state (slices pattern).
 *
 * Delegates to the combined `useAppStore` (see slices/index.ts). The legacy
 * `useTransactionStore` hook is preserved for compatibility.
 */

import { useAppStore, TransactionSlice } from './slices';
import { Transaction, TransactionStatus } from '../types/transaction';

export type TransactionState = TransactionSlice;

export const useTransactionStore = useAppStore;

export const selectTransactions = (s: TransactionState) => s.transactions;

export type { Transaction, TransactionStatus };
