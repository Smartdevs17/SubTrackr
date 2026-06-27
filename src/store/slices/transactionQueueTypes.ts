/**
 * Shared types for the transaction queue.
 */
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
