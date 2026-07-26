export enum CreditNoteStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  PARTIALLY_APPLIED = 'partially_applied',
  APPLIED = 'applied',
  EXPIRED = 'expired',
  VOID = 'void',
}

export enum CreditNoteReason {
  REFUND = 'refund',
  OVERPAYMENT = 'overpayment',
  PROMOTIONAL = 'promotional',
  COMPENSATION = 'compensation',
  ADJUSTMENT = 'adjustment',
}

export enum CreditApplicationStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed',
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
  status: CreditApplicationStatus;
  appliedAt: Date;
  reversedAt?: Date;
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

export interface PrepaymentTransaction {
  id: string;
  walletId: string;
  type: 'deposit' | 'withdraw' | 'drawdown';
  amount: number;
  balanceAfter: number;
  invoiceId?: string;
  timestamp: Date;
}

export interface CreditNoteReport {
  generatedAt: Date;
  totalIssued: number;
  totalApplied: number;
  totalExpired: number;
  totalOutstanding: number;
  creditNotes: {
    issued: CreditNote[];
    applied: CreditNote[];
    expired: CreditNote[];
    outstanding: CreditNote[];
  };
}

export const isValidCreditNoteStatus = (status: string): status is CreditNoteStatus =>
  Object.values(CreditNoteStatus).includes(status as CreditNoteStatus);

export const isValidCreditNoteReason = (reason: string): reason is CreditNoteReason =>
  Object.values(CreditNoteReason).includes(reason as CreditNoteReason);
