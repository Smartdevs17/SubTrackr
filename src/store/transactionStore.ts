import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Transaction, TransactionStatus, TransactionType } from '../types/transaction';

const STORAGE_KEY = 'subtrackr-transaction-history';
const MAX_RECORDS = 500;

interface TransactionState {
  transactions: Transaction[];

  // Actions
  addTransaction: (tx: Omit<Transaction, 'id' | 'date'>) => Transaction;
  updateTransactionStatus: (
    id: string,
    status: TransactionStatus,
    failureReason?: string
  ) => void;
  getBySubscription: (subscriptionId: string) => Transaction[];
  getByStatus: (status: TransactionStatus) => Transaction[];
  clearHistory: () => void;
}

export const useTransactionStore = create<TransactionState>()(
  persist(
    (set, get) => ({
      transactions: [],

      addTransaction: (tx) => {
        const newTx: Transaction = {
          ...tx,
          id: `txhist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          date: new Date().toISOString(),
        };

        set((state) => {
          const next = [newTx, ...state.transactions];
          // Prune oldest beyond limit
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
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
