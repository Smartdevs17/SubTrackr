export enum TransactionStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum TransactionType {
  FIAT = 'fiat',
  CRYPTO = 'crypto',
  REFUND = 'refund',
}

export interface Transaction {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: TransactionType;
  date: string; // ISO string
  /** On-chain tx hash — present for crypto transactions */
  txHash?: string;
  /** Chain ID — present for crypto transactions */
  chainId?: number;
  /** Block explorer base URL, e.g. https://etherscan.io */
  explorerUrl?: string;
  /** Human-readable failure reason */
  failureReason?: string;
  /** Optional notes */
  notes?: string;
}
