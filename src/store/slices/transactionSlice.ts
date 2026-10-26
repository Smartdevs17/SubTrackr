/**
 * transactionSlice.ts — Transaction history slice for the slices-pattern store.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';
import { Transaction, TransactionStatus } from '../../types/transaction';

const MAX_RECORDS = 500;

export interface TransactionSlice {
  transactions: Transaction[];

  addTransaction: (tx: Omit<Transaction, 'id' | 'date'>) => Transaction;
  updateTransactionStatus: (id: string, status: TransactionStatus, failureReason?: string) => void;
  getBySubscription: (subscriptionId: string) => Transaction[];
  getByStatus: (status: TransactionStatus) => Transaction[];
  clearHistory: () => void;
}

export type TransactionStoreState = AppState;

export const createTransactionSlice: SliceCreator<TransactionSlice> = (set, get) => ({
  transactions: [],

  addTransaction: (tx) => {
    const newTx: Transaction = {
      ...tx,
      id: `txhist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
    };

    set((state) => {
      const next = [newTx, ...state.transactions];
      return { transactions: next.slice(0, MAX_RECORDS) };
    });

    return newTx;
  },

  updateTransactionStatus: (id, status, failureReason) => {
    set((state) => ({
      transactions: state.transactions.map((tx) =>
        tx.id === id ? { ...tx, status, ...(failureReason ? { failureReason } : {}) } : tx
      ),
    }));
  },

  getBySubscription: (subscriptionId) =>
    get().transactions.filter((tx) => tx.subscriptionId === subscriptionId),

  getByStatus: (status) => get().transactions.filter((tx) => tx.status === status),

  clearHistory: () => set({ transactions: [] }),
});
