import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
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
  /**
   * Set immediately before the transaction is handed to the wallet.
   *
   * A broadcast can succeed on-chain even when the app dies before the
   * receipt is observed. Persisting this marker first means the next queue
   * pass can tell "never sent" apart from "sent, outcome unknown" and refuse
   * to re-broadcast the latter — which would otherwise charge the user twice.
   */
  broadcastedAt?: number;
  /** Earliest time the next attempt may start (exponential backoff). */
  nextAttemptAt?: number;
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

/** First retry delay after a failed attempt. Doubles each subsequent failure. */
const RETRY_BASE_BACKOFF_MS = 5_000;
const RETRY_MAX_BACKOFF_MS = 5 * 60 * 1000;

/**
 * A queued item that was already handed to the wallet but whose receipt was
 * never observed is *not* safe to re-broadcast. It is retired and surfaced
 * to the user instead, because the on-chain outcome is genuinely unknown and
 * a blind retry risks a second charge.
 */
const UNKNOWN_OUTCOME_TIMEOUT_MS = 10 * 60 * 1000;

let connectivitySubscription: NetInfoSubscription | null = null;
/** Reference count so one consumer unmounting does not silence every other. */
let connectivitySubscriberCount = 0;

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

/**
 * Exponential backoff with a ceiling, so a flapping connection cannot drive
 * the queue into a tight retry loop that burns through `MAX_ATTEMPTS` in a
 * single pass.
 */
const backoffDelayMs = (attempts: number): number => {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_BACKOFF_MS * 2 ** exponent, RETRY_MAX_BACKOFF_MS);
};

/**
 * Runs a fire-and-forget promise without producing an unhandled rejection,
 * which in React Native terminates the app.
 */
const safely = (promise: Promise<unknown>, context: string): void => {
  void promise.catch((error: unknown) => {
    console.warn(`[transactionQueue] ${context} failed`, error);
  });
};

/**
 * True only when the error proves the transaction never left the wallet.
 *
 * The broadcast marker may be cleared (and the item retried) in exactly these
 * cases. For every ambiguous failure — a dropped connection, an RPC timeout —
 * the marker is kept, because the transaction may already be in the mempool
 * and re-sending it would charge the user twice.
 */
const isDefinitelyNotBroadcast = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;

  const err = error as { code?: unknown; userMessage?: unknown; message?: unknown };

  const code = typeof err.code === 'string' ? err.code : '';
  if (code === 'USER_REJECTED' || code === 'WALLET_NOT_CONNECTED' || code === 'INVALID_PARAMS') {
    return true;
  }

  const text = [err.userMessage, err.message]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();

  return text.includes('rejected in your wallet') || text.includes('user rejected');
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
        connectivitySubscriberCount += 1;

        if (connectivitySubscription) {
          return () => {
            connectivitySubscriberCount = Math.max(0, connectivitySubscriberCount - 1);
            if (connectivitySubscriberCount === 0) {
              connectivitySubscription?.();
              connectivitySubscription = null;
            }
          };
        }

        connectivitySubscription = NetInfo.addEventListener((state) => {
          const online = isOnlineState(state.isConnected, state.isInternetReachable);
          const wasOnline = get().isOnline;
          set({ isOnline: online });

          if (!wasOnline && online) {
            safely(
              presentTransactionQueueNotification(
                'Back online',
                'Queued transactions are being processed now.'
              ),
              'reconnect notification'
            );
            safely(get().processQueue(), 'processQueue after reconnect');
          }
        });

        return () => {
          connectivitySubscriberCount = Math.max(0, connectivitySubscriberCount - 1);
          if (connectivitySubscriberCount === 0) {
            connectivitySubscription?.();
            connectivitySubscription = null;
          }
        };
      },

      refreshConnectivity: async () => {
        try {
          const state = await NetInfo.fetch();
          const online = isOnlineState(state.isConnected, state.isInternetReachable);
          const wasOnline = get().isOnline;
          set({ isOnline: online });
          if (!wasOnline && online) {
            safely(get().processQueue(), 'processQueue after connectivity refresh');
          }
        } catch (error) {
          console.warn('[transactionQueue] connectivity refresh failed', error);
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

        // A failed notification must not lose the queued transaction: the item is
        // already persisted above, so this only downgrades to a warning.
        safely(
          presentTransactionQueueNotification(
            'Transaction queued',
            replacedExisting
              ? 'Updated a pending transaction with your latest request.'
              : 'Transaction will run automatically once you are online.'
          ),
          'queued notification'
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
          const sortedQueue = [...get().queuedTransactions].sort(
            (a, b) => a.createdAt - b.createdAt
          );

          for (const tx of sortedQueue) {
            if (!get().isOnline) break;

            // Staleness is measured from the last attempt, not creation, so a
            // transaction that keeps making progress is not expired out from
            // under itself on a long-lived queue.
            const reference = tx.lastAttemptAt ?? tx.createdAt;
            const age = now() - reference;
            if (age > STALE_TRANSACTION_TIMEOUT_MS) {
              set((state) => ({
                queuedTransactions: state.queuedTransactions.filter((q) => q.id !== tx.id),
              }));

              safely(
                presentTransactionQueueNotification(
                  'Queued transaction expired',
                  'A pending transaction was removed because it became stale.'
                ),
                'stale notification'
              );
              continue;
            }

            // Respect exponential backoff so a flapping connection cannot
            // burn every attempt in a single pass.
            if (tx.nextAttemptAt !== undefined && now() < tx.nextAttemptAt) {
              continue;
            }

            // A transaction that was already handed to the wallet but whose
            // receipt was never observed must not be re-broadcast: the
            // on-chain outcome is unknown and a retry would double-charge.
            // Retire it and tell the user to verify manually.
            if (
              tx.broadcastedAt !== undefined &&
              now() - tx.broadcastedAt > UNKNOWN_OUTCOME_TIMEOUT_MS
            ) {
              set((state) => ({
                queuedTransactions: state.queuedTransactions.filter((q) => q.id !== tx.id),
                lastError:
                  'A queued transaction may have been submitted before its result could be confirmed.',
              }));

              safely(
                presentTransactionQueueNotification(
                  'Queued transaction needs review',
                  'It may already have been submitted on-chain. Please check your wallet before retrying.'
                ),
                'unknown-outcome notification'
              );
              continue;
            }

            // Mark the broadcast BEFORE handing the payload to the wallet so
            // a crash between submission and receipt cannot cause a replay.
            set((state) => ({
              queuedTransactions: state.queuedTransactions.map((queued) =>
                queued.id === tx.id
                  ? {
                      ...queued,
                      status: 'processing',
                      attempts: queued.attempts + 1,
                      lastAttemptAt: now(),
                      broadcastedAt: queued.broadcastedAt ?? now(),
                      nextAttemptAt: undefined,
                      updatedAt: now(),
                      lastError: undefined,
                    }
                  : queued
              ),
            }));

            try {
              await executeQueuedPayload(tx.payload);

              set((state) => ({
                queuedTransactions: state.queuedTransactions.filter(
                  (queued) => queued.id !== tx.id
                ),
              }));

              safely(
                presentTransactionQueueNotification(
                  'Queued transaction sent',
                  'A pending transaction has been executed successfully.'
                ),
                'success notification'
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
                  queuedTransactions: state.queuedTransactions.filter(
                    (queued) => queued.id !== tx.id
                  ),
                }));

                safely(
                  presentTransactionQueueNotification(
                    'Queued transaction skipped',
                    'A pending transaction conflicted with another on-chain transaction and was removed.'
                  ),
                  'conflict notification'
                );
                continue;
              }

              const updated = get().queuedTransactions.find((queued) => queued.id === tx.id);
              const attempts = updated?.attempts ?? tx.attempts + 1;

              if (attempts >= MAX_ATTEMPTS) {
                set((state) => ({
                  queuedTransactions: state.queuedTransactions.filter(
                    (queued) => queued.id !== tx.id
                  ),
                  lastError: error instanceof Error ? error.message : 'Queued transaction failed.',
                }));

                safely(
                  presentTransactionQueueNotification(
                    'Queued transaction failed',
                    error instanceof Error
                      ? `Dropped after retries: ${error.message}`
                      : 'Dropped after retry attempts.'
                  ),
                  'dropped notification'
                );
                continue;
              }

              // Schedule the next attempt with exponential backoff. The broadcast marker is
              // cleared only when the failure proves nothing was submitted;
              // otherwise it is kept so the queue never re-sends a payment
              // that may already be in the mempool.
              const safeToRetry = isDefinitelyNotBroadcast(error);

              set((state) => ({
                queuedTransactions: state.queuedTransactions.map((queued) =>
                  queued.id === tx.id
                    ? {
                        ...queued,
                        status: 'pending',
                        broadcastedAt: safeToRetry ? undefined : queued.broadcastedAt,
                        nextAttemptAt: now() + backoffDelayMs(attempts),
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
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({ queuedTransactions: state.queuedTransactions }),
      onRehydrateStorage: () => () => {
        safely(
          useTransactionQueueStore.getState().refreshConnectivity(),
          'rehydrate connectivity refresh'
        );
      },
    }
  )
);
