import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoSubscription } from '@react-native-community/netinfo';

import walletServiceManager from '../services/walletService';
import { presentTransactionQueueNotification } from '../services/notificationService';

export type QueuedTransactionProtocol = 'superfluid' | 'sablier';

export interface QueuedTransactionPayload {
  protocol: QueuedTransactionProtocol;
  token: string;
  amount: string;
  recipientAddress: string;
  chainId: number;
  startTime?: number;
  stopTime?: number;
}

export interface QueuedTransaction {
  id: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  conflictKey: string;
  status: 'pending' | 'processing';
  payload: QueuedTransactionPayload;
  lastError?: string;
}

export interface ExecuteOrQueueResult {
  queued: boolean;
  transactionId: string;
  streamId?: string;
  txHash?: string;
}

interface TransactionQueueState {
  isOnline: boolean;
  isProcessing: boolean;
  queuedTransactions: QueuedTransaction[];
  lastError: string | null;

  initializeConnectivityListener: () => () => void;
  refreshConnectivity: () => Promise<void>;
  queueTransaction: (
    payload: QueuedTransactionPayload,
    errorMessage?: string
  ) => Promise<{ transactionId: string; replacedExisting: boolean }>;
  executeOrQueueTransaction: (payload: QueuedTransactionPayload) => Promise<ExecuteOrQueueResult>;
  processQueue: () => Promise<void>;
  clearQueue: () => void;
  removeTransaction: (transactionId: string) => void;
}

const STORAGE_KEY = 'subtrackr-transaction-queue';
const STALE_TRANSACTION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;

let connectivitySubscription: NetInfoSubscription | null = null;

const isOnlineState = (isConnected: boolean | null, isInternetReachable: boolean | null): boolean =>
  Boolean(isConnected) && isInternetReachable !== false;

const now = (): number => Date.now();

const createConflictKey = (payload: QueuedTransactionPayload): string => {
  const recipient = payload.recipientAddress.trim().toLowerCase();
  const token = payload.token.trim().toLowerCase();
  return `${payload.protocol}:${payload.chainId}:${token}:${recipient}`;
};

const isLikelyNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('failed to fetch') ||
    message.includes('offline')
  );
};

const isLikelyConflictError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('nonce') ||
    message.includes('already known') ||
    message.includes('replacement transaction underpriced')
  );
};

const executeQueuedPayload = async (
  payload: QueuedTransactionPayload
): Promise<{ streamId: string; txHash?: string }> => {
  if (payload.protocol === 'superfluid') {
    const result = await walletServiceManager.createSuperfluidStream(
      payload.token,
      payload.amount,
      payload.recipientAddress,
      payload.chainId
    );

    return {
      streamId: result.streamId,
      txHash: result.txHash,
    };
  }

  const startTime = payload.startTime ?? Math.floor(Date.now() / 1000);
  const stopTime = payload.stopTime ?? startTime + 30 * 24 * 60 * 60;

  const streamId = await walletServiceManager.createSablierStream(
    payload.token,
    payload.amount,
    startTime,
    stopTime,
    payload.recipientAddress,
    payload.chainId
  );

  return { streamId };
};

export const useTransactionQueueStore = create<TransactionQueueState>()(
  persist(
    (set, get) => ({
      isOnline: true,
      isProcessing: false,
      queuedTransactions: [],
      lastError: null,

      initializeConnectivityListener: () => {
        if (connectivitySubscription) {
          return () => {
            connectivitySubscription?.();
            connectivitySubscription = null;
          };
        }

        connectivitySubscription = NetInfo.addEventListener((state) => {
          const online = isOnlineState(state.isConnected, state.isInternetReachable);
          const wasOnline = get().isOnline;
          set({ isOnline: online });

          if (!wasOnline && online) {
            void presentTransactionQueueNotification(
              'Back online',
              'Queued transactions are being processed now.'
            );
            void get().processQueue();
          }
        });

        return () => {
          connectivitySubscription?.();
          connectivitySubscription = null;
        };
      },

      refreshConnectivity: async () => {
        const state = await NetInfo.fetch();
        const online = isOnlineState(state.isConnected, state.isInternetReachable);
        const wasOnline = get().isOnline;
        set({ isOnline: online });
        if (!wasOnline && online) {
          void get().processQueue();
        }
      },

      queueTransaction: async (payload, errorMessage) => {
        const transactionId = `tx_${now()}_${Math.random().toString(36).slice(2, 8)}`;
        const createdAt = now();
        const conflictKey = createConflictKey(payload);

        let replacedExisting = false;

        set((state) => {
          const existing = state.queuedTransactions.find((tx) => tx.conflictKey === conflictKey);
          const nextQueue = state.queuedTransactions.filter((tx) => tx.conflictKey !== conflictKey);

          if (existing) {
            replacedExisting = true;
          }

          const queued: QueuedTransaction = {
            id: transactionId,
            createdAt,
            updatedAt: createdAt,
            attempts: 0,
            conflictKey,
            status: 'pending',
            payload,
            lastError: errorMessage,
          };

          return {
            queuedTransactions: [...nextQueue, queued],
            lastError: errorMessage ?? null,
          };
        });

        await presentTransactionQueueNotification(
          'Transaction queued',
          replacedExisting
            ? 'Updated a pending transaction with your latest request.'
            : 'Transaction will run automatically once you are online.'
        );

        return { transactionId, replacedExisting };
      },

      executeOrQueueTransaction: async (payload) => {
        if (!get().isOnline) {
          const queued = await get().queueTransaction(payload, 'Device is offline.');
          return {
            queued: true,
            transactionId: queued.transactionId,
          };
        }

        try {
          const executed = await executeQueuedPayload(payload);
          return {
            queued: false,
            transactionId: `executed_${now()}`,
            streamId: executed.streamId,
            txHash: executed.txHash,
          };
        } catch (error) {
          if (isLikelyNetworkError(error)) {
            set({ isOnline: false });
            const queued = await get().queueTransaction(
              payload,
              error instanceof Error ? error.message : 'Network unavailable.'
            );

            return {
              queued: true,
              transactionId: queued.transactionId,
            };
          }

          throw error;
        }
      },

      processQueue: async () => {
        if (get().isProcessing || !get().isOnline) return;

        set({ isProcessing: true, lastError: null });

        try {
          const sortedQueue = [...get().queuedTransactions].sort((a, b) => a.createdAt - b.createdAt);

          for (const tx of sortedQueue) {
            if (!get().isOnline) break;

            const age = now() - tx.createdAt;
            if (age > STALE_TRANSACTION_TIMEOUT_MS) {
              set((state) => ({
                queuedTransactions: state.queuedTransactions.filter((q) => q.id !== tx.id),
              }));

              await presentTransactionQueueNotification(
                'Queued transaction expired',
                'A pending transaction was removed because it became stale.'
              );
              continue;
            }

            set((state) => ({
              queuedTransactions: state.queuedTransactions.map((queued) =>
                queued.id === tx.id
                  ? {
                      ...queued,
                      status: 'processing',
                      attempts: queued.attempts + 1,
                      lastAttemptAt: now(),
                      updatedAt: now(),
                      lastError: undefined,
                    }
                  : queued
              ),
            }));

            try {
              await executeQueuedPayload(tx.payload);

              set((state) => ({
                queuedTransactions: state.queuedTransactions.filter((queued) => queued.id !== tx.id),
              }));

              await presentTransactionQueueNotification(
                'Queued transaction sent',
                'A pending transaction has been executed successfully.'
              );
            } catch (error) {
              if (isLikelyNetworkError(error)) {
                set({
                  isOnline: false,
                  lastError: error instanceof Error ? error.message : 'Network unavailable.',
                });

                set((state) => ({
                  queuedTransactions: state.queuedTransactions.map((queued) =>
                    queued.id === tx.id
                      ? {
                          ...queued,
                          status: 'pending',
                          updatedAt: now(),
                          lastError:
                            error instanceof Error ? error.message : 'Waiting for connection.',
                        }
                      : queued
                  ),
                }));

                break;
              }

              if (isLikelyConflictError(error)) {
                set((state) => ({
                  queuedTransactions: state.queuedTransactions.filter((queued) => queued.id !== tx.id),
                }));

                await presentTransactionQueueNotification(
                  'Queued transaction skipped',
                  'A pending transaction conflicted with another on-chain transaction and was removed.'
                );
                continue;
              }

              const updated = get().queuedTransactions.find((queued) => queued.id === tx.id);
              const attempts = updated?.attempts ?? tx.attempts + 1;

              if (attempts >= MAX_ATTEMPTS) {
                set((state) => ({
                  queuedTransactions: state.queuedTransactions.filter((queued) => queued.id !== tx.id),
                  lastError: error instanceof Error ? error.message : 'Queued transaction failed.',
                }));

                await presentTransactionQueueNotification(
                  'Queued transaction failed',
                  error instanceof Error
                    ? `Dropped after retries: ${error.message}`
                    : 'Dropped after retry attempts.'
                );
                continue;
              }

              set((state) => ({
                queuedTransactions: state.queuedTransactions.map((queued) =>
                  queued.id === tx.id
                    ? {
                        ...queued,
                        status: 'pending',
                        updatedAt: now(),
                        lastError: error instanceof Error ? error.message : 'Execution failed.',
                      }
                    : queued
                ),
                lastError: error instanceof Error ? error.message : 'Execution failed.',
              }));
            }
          }
        } finally {
          set({ isProcessing: false });
        }
      },

      clearQueue: () => {
        set({ queuedTransactions: [], lastError: null });
      },

      removeTransaction: (transactionId) => {
        set((state) => ({
          queuedTransactions: state.queuedTransactions.filter((tx) => tx.id !== transactionId),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ queuedTransactions: state.queuedTransactions }),
      onRehydrateStorage: () => () => {
        void useTransactionQueueStore.getState().refreshConnectivity();
      },
    }
  )
);
