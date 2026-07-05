import {
  CreditNote,
  CreditNoteReason,
  CreditNoteStatus,
  PrepaymentWallet,
  PrepaymentTransaction,
  CreditNoteReport,
} from '../types/credit';
import { useCreditStore } from '../store/creditStore';

export class CreditNoteService {
  static create(data: {
    subscriptionId: string;
    userId: string;
    reason: CreditNoteReason;
    amount: number;
    currency?: string;
    expiresAt: Date;
    notes?: string;
    priority?: number;
  }): CreditNote {
    return useCreditStore.getState().createCreditNote(data);
  }

  static issue(id: string): CreditNote {
    return useCreditStore.getState().issueCreditNote(id);
  }

  static voidNote(id: string): void {
    useCreditStore.getState().voidCreditNote(id);
  }

  static applyToInvoice(creditNoteId: string, invoiceId: string, amount?: number): CreditNote | null {
    return useCreditStore.getState().applyCreditToInvoice(creditNoteId, invoiceId, amount);
  }

  static autoApplyToNextInvoice(subscriptionId: string): CreditNote | null {
    return useCreditStore.getState().autoApplyCreditToNextInvoice(subscriptionId);
  }

  static expireExpiredNotes(): void {
    useCreditStore.getState().expireCreditNotes();
  }

  static getRemainingBalance(creditNoteId: string): number {
    const note = useCreditStore.getState().creditNotes.find((c) => c.id === creditNoteId);
    return note?.remainingAmount ?? 0;
  }

  static getReport(userId: string): CreditNoteReport {
    return useCreditStore.getState().getCreditNoteReport(userId);
  }

  static getBySubscription(subscriptionId: string): CreditNote[] {
    return useCreditStore.getState().getCreditNotesBySubscription(subscriptionId);
  }
}

export class PrepaymentWalletService {
  static getOrCreate(subscriptionId: string, userId: string, currency = 'USD'): PrepaymentWallet {
    return useCreditStore.getState().getOrCreateWallet(subscriptionId, userId, currency);
  }

  static deposit(walletId: string, amount: number): PrepaymentWallet | null {
    return useCreditStore.getState().depositPrepayment(walletId, amount);
  }

  static withdraw(walletId: string, amount: number): PrepaymentWallet | null {
    return useCreditStore.getState().withdrawPrepayment(walletId, amount);
  }

  static getBalance(walletId: string): number {
    const wallet = useCreditStore.getState().prepaymentWallets.find((w) => w.id === walletId);
    return wallet?.balance ?? 0;
  }

  static getBySubscription(subscriptionId: string): PrepaymentWallet | undefined {
    return useCreditStore.getState().getWalletBySubscription(subscriptionId);
  }

  static autoDrawdown(subscriptionId: string, invoiceAmount: number): number {
    return useCreditStore.getState().autoDrawdownAtBillingClose(subscriptionId, invoiceAmount);
  }

  static getTransactions(walletId: string): PrepaymentTransaction[] {
    return useCreditStore
      .getState()
      .prepaymentTransactions.filter((t) => t.walletId === walletId);
  }

  static getTransactionsBySubscription(subscriptionId: string): PrepaymentTransaction[] {
    const wallet = useCreditStore.getState().getWalletBySubscription(subscriptionId);
    if (!wallet) return [];
    return useCreditStore
      .getState()
      .prepaymentTransactions.filter((t) => t.walletId === wallet.id);
  }
}

export const creditExpiryChecker = (): { expiredCount: number; totalExpiredAmount: number } => {
  const before = useCreditStore.getState().creditNotes.length;
  useCreditStore.getState().expireCreditNotes();
  const after = useCreditStore.getState().creditNotes.filter(
    (c) => c.status === CreditNoteStatus.EXPIRED
  ).length;
  const totalExpiredAmount = useCreditStore
    .getState()
    .creditNotes.filter((c) => c.status === CreditNoteStatus.EXPIRED)
    .reduce((sum, c) => sum + c.amount, 0);
  return { expiredCount: after, totalExpiredAmount };
};
