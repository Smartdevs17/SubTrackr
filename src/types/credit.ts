export type CreditPaymentMethod = 'card' | 'bank_transfer' | 'wallet' | 'manual' | 'crypto';

export type CreditLedgerEntryType =
  | 'purchase'
  | 'application'
  | 'expiration'
  | 'transfer_in'
  | 'transfer_out'
  | 'adjustment';

export type CreditApplicationStatus = 'partial' | 'paid';

export interface CreditPolicy {
  expirationDays: number;
  transferable: boolean;
  autoApplyToUpcomingInvoices: boolean;
  allowPartialApplication: boolean;
}

export interface CreditLot {
  id: string;
  amountRemaining: number;
  originalAmount: number;
  createdAt: Date;
  expiresAt: Date | null;
  paymentMethod: CreditPaymentMethod;
  reference?: string;
  note?: string;
}

export interface CreditLedgerEntry {
  id: string;
  accountId: string;
  type: CreditLedgerEntryType;
  amount: number;
  balanceAfter: number;
  runningTotal: number;
  currency: string;
  createdAt: Date;
  expiresAt?: Date | null;
  subscriptionId?: string;
  invoiceId?: string;
  relatedAccountId?: string;
  paymentMethod?: CreditPaymentMethod;
  reference?: string;
  note?: string;
}

export interface CreditInvoiceApplication {
  id: string;
  accountId: string;
  subscriptionId: string;
  invoiceId: string;
  invoiceTotal: number;
  appliedAmount: number;
  remainingDue: number;
  status: CreditApplicationStatus;
  runningBalanceAfter: number;
  createdAt: Date;
}

export interface CreditAccountState {
  accountId: string;
  currency: string;
  balance: number;
  runningTotal: number;
  totalPurchased: number;
  totalApplied: number;
  totalExpired: number;
  totalTransferredIn: number;
  totalTransferredOut: number;
  revision: number;
  policy: CreditPolicy;
  lots: CreditLot[];
  ledger: CreditLedgerEntry[];
  applications: CreditInvoiceApplication[];
  nextExpirationAt: Date | null;
}

export interface CreditPurchaseInput {
  amount: number;
  paymentMethod: CreditPaymentMethod;
  currency?: string;
  subscriptionId?: string;
  invoiceId?: string;
  reference?: string;
  note?: string;
  expiresAt?: Date | null;
  expectedRevision?: number;
}

export interface CreditTransferInput {
  amount: number;
  currency?: string;
  reference?: string;
  note?: string;
  expectedRevision?: number;
}

export interface CreditApplicationInput {
  invoiceId: string;
  subscriptionId: string;
  invoiceTotal: number;
  currency?: string;
  reference?: string;
  note?: string;
  expectedRevision?: number;
  now?: Date;
}

export interface CreditExpirationResult {
  account: CreditAccountState;
  expiredAmount: number;
  expiredLotIds: string[];
  notificationMessage: string | null;
}

export interface CreditApplicationResult {
  account: CreditAccountState;
  application: CreditInvoiceApplication | null;
  appliedAmount: number;
  remainingDue: number;
  autoApplied: boolean;
}
