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

// ─────────────────────────────────────────────────────────────────────────────
// Credit Note & Prepayment Wallet model
//
// Used by src/store/creditStore.ts. Credit notes are formal document-style
// credits (e.g. goodwill adjustments, refunds) that can be applied to open
// invoices; prepayment wallets hold customer prepaid balances that are drawn
// down automatically at billing close.
// ─────────────────────────────────────────────────────────────────────────────

export enum CreditNoteStatus {
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
  PARTIALLY_APPLIED = 'PARTIALLY_APPLIED',
  APPLIED = 'APPLIED',
  VOID = 'VOID',
  EXPIRED = 'EXPIRED',
}

export enum CreditNoteReason {
  ADJUSTMENT = 'ADJUSTMENT',
  REFUND = 'REFUND',
  GOODWILL = 'GOODWILL',
  COMPENSATION = 'COMPENSATION',
  PROMOTION = 'PROMOTION',
  DUPLICATE_CHARGE = 'DUPLICATE_CHARGE',
}

export interface CreditNote {
  id: string;
  subscriptionId: string;
  userId: string;
  reason: CreditNoteReason;
  amount: number;
  remainingAmount: number;
  currency: string;
  status: CreditNoteStatus;
  issuedAt: Date;
  expiresAt: Date;
  appliedAt?: Date;
  appliedToInvoiceIds: string[];
  notes?: string;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditNoteApplication {
  id: string;
  creditNoteId: string;
  invoiceId: string;
  amount: number;
  status: CreditNoteStatus;
  appliedAt: Date;
}

export interface PrepaymentWallet {
  id: string;
  subscriptionId: string;
  userId: string;
  currency: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  createdAt: Date;
  updatedAt: Date;
}

export type PrepaymentTransactionType = 'deposit' | 'withdraw' | 'drawdown';

export interface PrepaymentTransaction {
  id: string;
  walletId: string;
  type: PrepaymentTransactionType;
  amount: number;
  balanceAfter: number;
  invoiceId?: string;
  timestamp: Date;
}

export interface CreditNoteReportBucket {
  issued: CreditNote[];
  applied: CreditNote[];
  expired: CreditNote[];
  outstanding: CreditNote[];
}

export interface CreditNoteReport {
  generatedAt: Date;
  totalIssued: number;
  totalApplied: number;
  totalExpired: number;
  totalOutstanding: number;
  creditNotes: CreditNoteReportBucket;
}

// ─────────────────────────────────────────────────────────────────────────────
// Account balance summary
//
// Aggregated view of a subscriber's credit account used for high-level
// balance display and reconciliation.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreditAccountBalance {
  accountId: string;
  currency: string;
  availableBalance: number;
  totalPurchased: number;
  totalApplied: number;
  totalExpired: number;
  totalTransferredIn: number;
  totalTransferredOut: number;
  pendingExpiry: number;
  nextExpirationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

