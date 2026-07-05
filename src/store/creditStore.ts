import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { debouncedAsyncStorageAdapter } from '../utils/storage';
import {
  CreditNote,
  CreditNoteApplication,
  PrepaymentWallet,
  PrepaymentTransaction,
  CreditNoteReport,
  CreditNoteStatus,
  CreditNoteReason,
} from '../types/credit';
import { InvoiceStatus } from '../types/invoice';
import { errorHandler, AppError } from '../services/errorHandler';
import { useInvoiceStore } from './invoiceStore';

const STORAGE_KEY = 'subtrackr-credits';
const WALLET_STORAGE_KEY = 'subtrackr-prepayment-wallets';

const toValidDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};

const generateId = (): string => `credit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

const normalizeCreditNote = (raw: Partial<CreditNote>): CreditNote => {
  const now = new Date();
  return {
    id: raw.id ?? generateId(),
    subscriptionId: raw.subscriptionId ?? '',
    userId: raw.userId ?? '',
    reason: raw.reason ?? CreditNoteReason.ADJUSTMENT,
    amount: Number.isFinite(raw.amount) ? (raw.amount as number) : 0,
    remainingAmount: Number.isFinite(raw.remainingAmount) ? (raw.remainingAmount as number) : 0,
    currency: raw.currency ?? 'USD',
    status: raw.status ?? CreditNoteStatus.DRAFT,
    issuedAt: toValidDate(raw.issuedAt, now),
    expiresAt: toValidDate(raw.expiresAt, now),
    appliedAt: raw.appliedAt ? toValidDate(raw.appliedAt) : undefined,
    appliedToInvoiceIds: Array.isArray(raw.appliedToInvoiceIds) ? raw.appliedToInvoiceIds : [],
    notes: raw.notes,
    priority: Number.isFinite(raw.priority) ? (raw.priority as number) : 0,
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
  };
};

const normalizePrepaymentWallet = (raw: Partial<PrepaymentWallet>): PrepaymentWallet => {
  const now = new Date();
  return {
    id: raw.id ?? generateId(),
    subscriptionId: raw.subscriptionId ?? '',
    userId: raw.userId ?? '',
    currency: raw.currency ?? 'USD',
    balance: Number.isFinite(raw.balance) ? (raw.balance as number) : 0,
    totalDeposited: Number.isFinite(raw.totalDeposited) ? (raw.totalDeposited as number) : 0,
    totalWithdrawn: Number.isFinite(raw.totalWithdrawn) ? (raw.totalWithdrawn as number) : 0,
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
  };
};

interface CreditState {
  creditNotes: CreditNote[];
  prepaymentWallets: PrepaymentWallet[];
  prepaymentTransactions: PrepaymentTransaction[];
  isLoading: boolean;
  error: AppError | null;

  createCreditNote: (data: {
    subscriptionId: string;
    userId: string;
    reason: CreditNoteReason;
    amount: number;
    currency?: string;
    expiresAt: Date;
    notes?: string;
    priority?: number;
  }) => CreditNote;

  issueCreditNote: (id: string) => CreditNote;
  voidCreditNote: (id: string) => void;

  applyCreditToInvoice: (creditNoteId: string, invoiceId: string, amount?: number) => CreditNote | null;
  autoApplyCreditToNextInvoice: (subscriptionId: string) => CreditNote | null;

  expireCreditNotes: () => void;

  getOrCreateWallet: (subscriptionId: string, userId: string, currency?: string) => PrepaymentWallet;
  depositPrepayment: (walletId: string, amount: number) => PrepaymentWallet | null;
  withdrawPrepayment: (walletId: string, amount: number) => PrepaymentWallet | null;
  autoDrawdownAtBillingClose: (subscriptionId: string, invoiceAmount: number) => number;

  getCreditNoteReport: (userId: string) => CreditNoteReport;
  getCreditNotesBySubscription: (subscriptionId: string) => CreditNote[];
  getWalletBySubscription: (subscriptionId: string) => PrepaymentWallet | undefined;
}

export const useCreditStore = create<CreditState>()(
  persist(
    (set, get) => ({
      creditNotes: [],
      prepaymentWallets: [],
      prepaymentTransactions: [],
      isLoading: false,
      error: null,

      createCreditNote: (data) => {
        const now = new Date();
        const creditNote: CreditNote = {
          id: generateId(),
          subscriptionId: data.subscriptionId,
          userId: data.userId,
          reason: data.reason,
          amount: data.amount,
          remainingAmount: data.amount,
          currency: data.currency ?? 'USD',
          status: CreditNoteStatus.DRAFT,
          issuedAt: now,
          expiresAt: data.expiresAt,
          notes: data.notes,
          priority: data.priority ?? 0,
          appliedToInvoiceIds: [],
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          creditNotes: [...state.creditNotes, creditNote],
        }));
        return creditNote;
      },

      issueCreditNote: (id) => {
        const note = get().creditNotes.find((c) => c.id === id);
        if (!note) {
          throw new Error('Credit note not found');
        }
        const updated: CreditNote = {
          ...note,
          status: CreditNoteStatus.ISSUED,
          issuedAt: new Date(),
          updatedAt: new Date(),
        };
        set((state) => ({
          creditNotes: state.creditNotes.map((c) => (c.id === id ? updated : c)),
        }));
        return updated;
      },

      voidCreditNote: (id) => {
        const note = get().creditNotes.find((c) => c.id === id);
        if (!note) return;
        if (note.status === CreditNoteStatus.APPLIED) return;
        const updated: CreditNote = {
          ...note,
          status: CreditNoteStatus.VOID,
          updatedAt: new Date(),
        };
        set((state) => ({
          creditNotes: state.creditNotes.map((c) => (c.id === id ? updated : c)),
        }));
      },

      applyCreditToInvoice: (creditNoteId, invoiceId, amount) => {
        const state = get();
        const noteIndex = state.creditNotes.findIndex((c) => c.id === creditNoteId);
        if (noteIndex === -1) return null;

        const note = state.creditNotes[noteIndex];
        if (
          note.status === CreditNoteStatus.EXPIRED ||
          note.status === CreditNoteStatus.VOID ||
          note.status === CreditNoteStatus.APPLIED
        ) {
          return null;
        }

        const applyAmount = Math.min(
          amount ?? note.remainingAmount,
          note.remainingAmount
        );

        if (applyAmount <= 0) return null;

        const newRemaining = note.remainingAmount - applyAmount;
        const newStatus =
          newRemaining <= 0 ? CreditNoteStatus.APPLIED : CreditNoteStatus.PARTIALLY_APPLIED;

        const updated: CreditNote = {
          ...note,
          remainingAmount: newRemaining,
          status: newStatus,
          appliedAt: new Date(),
          appliedToInvoiceIds: newRemaining <= 0
            ? [...note.appliedToInvoiceIds, invoiceId]
            : [...note.appliedToInvoiceIds, invoiceId],
          updatedAt: new Date(),
        };

        const application: CreditNoteApplication = {
          id: `app-${Date.now()}`,
          creditNoteId,
          invoiceId,
          amount: applyAmount,
          status: CreditNoteStatus.APPLIED as unknown as CreditNoteApplication['status'],
          appliedAt: new Date(),
        };

        const invoiceStore = useInvoiceStore.getState();
        const invoice = invoiceStore.invoices.find((inv) => inv.id === invoiceId);
        if (invoice && invoice.total > 0) {
          const newTotal = Math.max(0, invoice.total - applyAmount);
          const paidAmount = invoice.total - newTotal;
          const resolvedStatus =
            paidAmount >= invoice.total
              ? InvoiceStatus.PAID
              : paidAmount > 0
                ? InvoiceStatus.PARTIAL
                : invoice.status;

          useInvoiceStore.setState({
            invoices: invoiceStore.invoices.map((i) =>
              i.id === invoiceId
                ? { ...i, total: newTotal, status: resolvedStatus, updatedAt: new Date() }
                : i
            ),
          });
        }

        set((state) => ({
          creditNotes: state.creditNotes.map((c) => (c.id === creditNoteId ? updated : c)),
          prepaymentTransactions: [
            ...state.prepaymentTransactions,
            {
              id: application.id,
              walletId: '',
              type: 'drawdown',
              amount: applyAmount,
              balanceAfter: newRemaining,
              invoiceId,
              timestamp: new Date(),
            },
          ],
        }));

        return updated;
      },

      autoApplyCreditToNextInvoice: (subscriptionId) => {
        const state = get();
        const eligibleNotes = state.creditNotes
          .filter(
            (c) =>
              c.subscriptionId === subscriptionId &&
              c.status !== CreditNoteStatus.EXPIRED &&
              c.status !== CreditNoteStatus.VOID &&
              c.status !== CreditNoteStatus.APPLIED &&
              c.remainingAmount > 0
          )
          .sort((a, b) => b.priority - a.priority || a.issuedAt.getTime() - b.issuedAt.getTime());

        const invoiceStore = useInvoiceStore.getState();
        const openInvoices = invoiceStore.invoices.filter(
          (inv) => inv.subscriptionId === subscriptionId && inv.status !== 'paid'
        );

        if (eligibleNotes.length === 0 || openInvoices.length === 0) return null;

        let appliedNote: CreditNote | null = null;
        const updates: CreditNote[] = [];
        const newTransactions: PrepaymentTransaction[] = [];

        for (const note of eligibleNotes) {
          if (note.remainingAmount <= 0) continue;

          for (const invoice of openInvoices) {
            if (note.remainingAmount <= 0) break;
            if (invoice.total <= 0) continue;

            const applyAmount = Math.min(note.remainingAmount, invoice.total);
            const newRemaining = note.remainingAmount - applyAmount;
            const newStatus =
              newRemaining <= 0 ? CreditNoteStatus.APPLIED : CreditNoteStatus.PARTIALLY_APPLIED;

            const updatedNote: CreditNote = {
              ...note,
              remainingAmount: newRemaining,
              status: newStatus,
              appliedAt: new Date(),
              appliedToInvoiceIds: newRemaining <= 0
                ? [...note.appliedToInvoiceIds, invoice.id]
                : [...note.appliedToInvoiceIds, invoice.id],
              updatedAt: new Date(),
            };

            updates.push(updatedNote);
            appliedNote = updatedNote;

            newTransactions.push({
              id: `auto-app-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              walletId: '',
              type: 'drawdown',
              amount: applyAmount,
              balanceAfter: newRemaining,
              invoiceId: invoice.id,
              timestamp: new Date(),
            });
          }
        }

        if (updates.length === 0) return null;

        set((state) => ({
          creditNotes: state.creditNotes.map((c) => {
            const update = updates.find((u) => u.id === c.id);
            return update ?? c;
          }),
          prepaymentTransactions: [...state.prepaymentTransactions, ...newTransactions],
        }));

        return appliedNote;
      },

      expireCreditNotes: () => {
        const now = new Date();
        set((state) => ({
          creditNotes: state.creditNotes.map((note) => {
            if (note.status === CreditNoteStatus.EXPIRED) return note;
            if (note.status === CreditNoteStatus.VOID) return note;
            if (note.status === CreditNoteStatus.APPLIED) return note;
            if (note.expiresAt.getTime() > now.getTime()) return note;
            if (note.remainingAmount <= 0) return note;

            return {
              ...note,
              status: CreditNoteStatus.EXPIRED,
              remainingAmount: 0,
              updatedAt: now,
            };
          }),
        }));
      },

      getOrCreateWallet: (subscriptionId, userId, currency = 'USD') => {
        const state = get();
        const existing = state.prepaymentWallets.find(
          (w) => w.subscriptionId === subscriptionId && w.userId === userId && w.currency === currency
        );
        if (existing) return existing;

        const wallet: PrepaymentWallet = {
          id: `wallet-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          subscriptionId,
          userId,
          currency,
          balance: 0,
          totalDeposited: 0,
          totalWithdrawn: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set((state) => ({
          prepaymentWallets: [...state.prepaymentWallets, wallet],
        }));

        return wallet;
      },

      depositPrepayment: (walletId, amount) => {
        if (amount <= 0) return null;
        const state = get();
        const walletIndex = state.prepaymentWallets.findIndex((w) => w.id === walletId);
        if (walletIndex === -1) return null;

        const wallet = state.prepaymentWallets[walletIndex];
        const updated: PrepaymentWallet = {
          ...wallet,
          balance: wallet.balance + amount,
          totalDeposited: wallet.totalDeposited + amount,
          updatedAt: new Date(),
        };

        const transaction: PrepaymentTransaction = {
          id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          walletId,
          type: 'deposit',
          amount,
          balanceAfter: updated.balance,
          timestamp: new Date(),
        };

        const newWallets = [...state.prepaymentWallets];
        newWallets[walletIndex] = updated;

        set((state) => ({
          prepaymentWallets: newWallets,
          prepaymentTransactions: [...state.prepaymentTransactions, transaction],
        }));

        return updated;
      },

      withdrawPrepayment: (walletId, amount) => {
        if (amount <= 0) return null;
        const state = get();
        const walletIndex = state.prepaymentWallets.findIndex((w) => w.id === walletId);
        if (walletIndex === -1) return null;

        const wallet = state.prepaymentWallets[walletIndex];
        if (wallet.balance < amount) return null;

        const updated: PrepaymentWallet = {
          ...wallet,
          balance: wallet.balance - amount,
          totalWithdrawn: wallet.totalWithdrawn + amount,
          updatedAt: new Date(),
        };

        const transaction: PrepaymentTransaction = {
          id: `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          walletId,
          type: 'withdraw',
          amount,
          balanceAfter: updated.balance,
          timestamp: new Date(),
        };

        const newWallets = [...state.prepaymentWallets];
        newWallets[walletIndex] = updated;

        set((state) => ({
          prepaymentWallets: newWallets,
          prepaymentTransactions: [...state.prepaymentTransactions, transaction],
        }));

        return updated;
      },

      autoDrawdownAtBillingClose: (subscriptionId, invoiceAmount) => {
        const state = get();
        const wallet = state.prepaymentWallets.find(
          (w) => w.subscriptionId === subscriptionId && w.balance > 0
        );
        if (!wallet) return 0;

        const drawdownAmount = Math.min(wallet.balance, invoiceAmount);
        if (drawdownAmount <= 0) return 0;

        const walletIndex = state.prepaymentWallets.findIndex((w) => w.id === wallet.id);
        const updated: PrepaymentWallet = {
          ...wallet,
          balance: wallet.balance - drawdownAmount,
          totalWithdrawn: wallet.totalWithdrawn + drawdownAmount,
          updatedAt: new Date(),
        };

        const transaction: PrepaymentTransaction = {
          id: `auto-dd-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          walletId: wallet.id,
          type: 'drawdown',
          amount: drawdownAmount,
          balanceAfter: updated.balance,
          timestamp: new Date(),
        };

        const newWallets = [...state.prepaymentWallets];
        newWallets[walletIndex] = updated;

        set((state) => ({
          prepaymentWallets: newWallets,
          prepaymentTransactions: [...state.prepaymentTransactions, transaction],
        }));

        return drawdownAmount;
      },

      getCreditNoteReport: (userId) => {
        const state = get();
        const userNotes = state.creditNotes.filter((c) => c.userId === userId);

        const now = new Date();
        const issued = userNotes.filter((c) => c.status !== CreditNoteStatus.DRAFT);
        const applied = userNotes.filter((c) => c.status === CreditNoteStatus.APPLIED);
        const expired = userNotes.filter(
          (c) => c.status === CreditNoteStatus.EXPIRED || c.expiresAt.getTime() < now.getTime()
        );
        const outstanding = userNotes.filter(
          (c) =>
            c.status === CreditNoteStatus.ISSUED ||
            c.status === CreditNoteStatus.PARTIALLY_APPLIED
        );

        const totalIssued = issued.reduce((sum, c) => sum + c.amount, 0);
        const totalApplied = applied.reduce((sum, c) => sum + c.amount, 0);
        const totalExpired = expired.reduce((sum, c) => sum + c.amount, 0);
        const totalOutstanding = outstanding.reduce((sum, c) => sum + c.remainingAmount, 0);

        return {
          generatedAt: new Date(),
          totalIssued,
          totalApplied,
          totalExpired,
          totalOutstanding,
          creditNotes: {
            issued,
            applied,
            expired,
            outstanding,
          },
        };
      },

      getCreditNotesBySubscription: (subscriptionId) => {
        return get().creditNotes.filter((c) => c.subscriptionId === subscriptionId);
      },

      getWalletBySubscription: (subscriptionId) => {
        return get().prepaymentWallets.find((w) => w.subscriptionId === subscriptionId);
      },
    }),
    {
      name: STORAGE_KEY,
      storage: debouncedAsyncStorageAdapter,
      version: 0,
    }
  )
);
