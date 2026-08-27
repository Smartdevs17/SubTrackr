// ════════════════════════════════════════════════════════════════
// CREDIT STORE - subscriber account credit balances
// ════════════════════════════════════════════════════════════════
//
// Mirrors the `subtrackr-credit` Soroban contract: credit is held in lots that
// can expire, applied to charges oldest-first, transferred between accounts,
// and is fully auditable. Balances never go negative.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../../src/utils/storage';

export type CreditTxKind = 'issue' | 'apply' | 'transfer_in' | 'transfer_out' | 'expire';

export type ExpirationPolicy = { kind: 'never' } | { kind: 'after_secs'; seconds: number };

export interface CreditLot {
  id: number;
  remaining: number;
  issuedAt: number;
  expiresAt?: number;
}

export interface CreditTransaction {
  id: number;
  kind: CreditTxKind;
  /** Signed: positive inflow, negative outflow. */
  amount: number;
  timestamp: number;
  reason: string;
  counterparty?: string;
}

export interface AccountCredit {
  subscriber: string;
  balance: number;
  lots: CreditLot[];
  transactions: CreditTransaction[];
  expirationPolicy: ExpirationPolicy;
}

export interface CreditApplied {
  subscriptionId: string;
  applied: number;
  remainingDue: number;
  balanceAfter: number;
}

export interface PrepaymentWallet {
  id: number;
  subscriber: string;
  subscriptionId: string;
  currency: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalDrawn: number;
  transactions: PrepaymentTransaction[];
  createdAt: number;
  updatedAt: number;
}

export type PrepaymentTxKind = 'deposit' | 'withdraw' | 'drawdown';

export interface PrepaymentTransaction {
  id: number;
  kind: PrepaymentTxKind;
  amount: number;
  balanceAfter: number;
  timestamp: number;
}

export interface PrepaymentSnapshot {
  walletId: number;
  balance: number;
  transactionId: number;
}

const MAX_HISTORY = 128;

const isPositiveAmount = (amount: number): boolean => Number.isFinite(amount) && amount > 0;

const isExpired = (lot: CreditLot, now: number): boolean =>
  lot.expiresAt !== undefined && lot.expiresAt <= now;

const availableOf = (account: AccountCredit, now: number): number =>
  account.lots.reduce(
    (sum, lot) => (lot.remaining > 0 && !isExpired(lot, now) ? sum + lot.remaining : sum),
    0
  );

interface CreditStoreState {
  accounts: Record<string, AccountCredit>;
  nextId: number;
  wallets: Record<number, PrepaymentWallet>;
  nextWalletId: number;
  walletTransactionIds: Record<number, number>;
  now: () => number;

  issueCredit: (subscriber: string, amount: number, reason: string, expiresAt?: number) => void;
  setExpirationPolicy: (subscriber: string, policy: ExpirationPolicy) => void;
  applyCredit: (subscriber: string, subscriptionId: string, amountDue: number) => CreditApplied;
  transferCredit: (from: string, to: string, amount: number, reason: string) => boolean;
  expireCredits: (subscriber: string) => number;
  getBalance: (subscriber: string) => number;
  getAccount: (subscriber: string) => AccountCredit;
  createWallet: (subscriber: string, subscriptionId: string, currency: string) => number;
  getWallet: (walletId: number) => PrepaymentWallet | undefined;
  deposit: (subscriber: string, walletId: number, amount: number) => PrepaymentSnapshot | undefined;
  withdraw: (subscriber: string, walletId: number, amount: number) => PrepaymentSnapshot | undefined;
  drawdown: (subscriber: string, walletId: number, amount: number) => PrepaymentSnapshot | undefined;
}

const blankAccount = (subscriber: string): AccountCredit => ({
  subscriber,
  balance: 0,
  lots: [],
  transactions: [],
  expirationPolicy: { kind: 'never' },
});

export const useCreditStore = create<CreditStoreState>()(
  persist(
    (set, get) => {
      const account = (subscriber: string): AccountCredit =>
        get().accounts[subscriber] ?? blankAccount(subscriber);

      const commit = (acc: AccountCredit): void => {
        set((s) => ({ accounts: { ...s.accounts, [acc.subscriber]: acc } }));
      };

      const nextId = (): number => {
        const id = get().nextId;
        set({ nextId: id + 1 });
        return id;
      };

      const record = (
        acc: AccountCredit,
        kind: CreditTxKind,
        amount: number,
        reason: string,
        counterparty?: string
      ): void => {
        acc.transactions = [
          ...acc.transactions,
          { id: nextId(), kind, amount, timestamp: get().now(), reason, counterparty },
        ].slice(-MAX_HISTORY);
      };

      const realizeExpiry = (acc: AccountCredit, now: number): number => {
        let expired = 0;
        acc.lots = acc.lots.map((lot) => {
          if (lot.remaining > 0 && isExpired(lot, now)) {
            expired += lot.remaining;
            return { ...lot, remaining: 0 };
          }
          return lot;
        });
        if (expired > 0) {
          acc.balance -= expired;
          record(acc, 'expire', -expired, 'expired');
        }
        return expired;
      };

      const consume = (acc: AccountCredit, now: number, amount: number): number => {
        let remaining = amount;
        acc.lots = acc.lots.map((lot) => {
          if (remaining <= 0 || lot.remaining <= 0 || isExpired(lot, now)) return lot;
          const take = Math.min(lot.remaining, remaining);
          remaining -= take;
          return { ...lot, remaining: lot.remaining - take };
        });
        return amount - remaining;
      };

      const cloneAccount = (acc: AccountCredit): AccountCredit => ({
        ...acc,
        lots: acc.lots.map((lot) => ({ ...lot })),
        transactions: acc.transactions.map((transaction) => ({ ...transaction })),
      });

      const nextWalletTransactionId = (walletId: number): number => {
        const id = get().walletTransactionIds[walletId] ?? 0;
        set((state) => ({
          walletTransactionIds: { ...state.walletTransactionIds, [walletId]: id + 1 },
        }));
        return id;
      };

      const recordWalletTransaction = (
        wallet: PrepaymentWallet,
        kind: PrepaymentTxKind,
        amount: number
      ): PrepaymentSnapshot => {
        const transactionId = nextWalletTransactionId(wallet.id);
        wallet.transactions = [
          ...wallet.transactions,
          {
            id: transactionId,
            kind,
            amount,
            balanceAfter: wallet.balance,
            timestamp: get().now(),
          },
        ].slice(-MAX_HISTORY);
        return { walletId: wallet.id, balance: wallet.balance, transactionId };
      };

      return {
        accounts: {},
        nextId: 0,
        wallets: {},
        nextWalletId: 0,
        walletTransactionIds: {},
        now: () => Math.floor(Date.now() / 1000),

        issueCredit: (subscriber, amount, reason, expiresAt) => {
          if (!isPositiveAmount(amount)) return;
          const now = get().now();
          const acc = cloneAccount(account(subscriber));
          realizeExpiry(acc, now);
          const expiry =
            expiresAt ??
            (acc.expirationPolicy.kind === 'after_secs'
              ? now + acc.expirationPolicy.seconds
              : undefined);
          acc.lots.push({ id: nextId(), remaining: amount, issuedAt: now, expiresAt: expiry });
          acc.balance += amount;
          record(acc, 'issue', amount, reason);
          commit(acc);
        },

        setExpirationPolicy: (subscriber, policy) => {
          const acc = { ...account(subscriber), expirationPolicy: policy };
          commit(acc);
        },

        applyCredit: (subscriber, subscriptionId, amountDue) => {
          const now = get().now();
          const acc = cloneAccount(account(subscriber));
          realizeExpiry(acc, now);
          const due = Number.isFinite(amountDue) ? Math.max(0, amountDue) : 0;
          const applied = consume(acc, now, due);
          if (applied > 0) {
            acc.balance -= applied;
            record(acc, 'apply', -applied, 'charge_application');
          }
          commit(acc);
          return {
            subscriptionId,
            applied,
            remainingDue: due - applied,
            balanceAfter: acc.balance,
          };
        },

        transferCredit: (from, to, amount, reason) => {
          if (!isPositiveAmount(amount) || from === to) return false;
          const now = get().now();
          const sender = cloneAccount(account(from));
          realizeExpiry(sender, now);
          if (availableOf(sender, now) < amount) return false;
          const moved = consume(sender, now, amount);
          sender.balance -= moved;
          record(sender, 'transfer_out', -moved, reason, to);
          commit(sender);

          const recipient = cloneAccount(account(to));
          realizeExpiry(recipient, now);
          const expiry =
            recipient.expirationPolicy.kind === 'after_secs'
              ? now + recipient.expirationPolicy.seconds
              : undefined;
          recipient.lots.push({ id: nextId(), remaining: moved, issuedAt: now, expiresAt: expiry });
          recipient.balance += moved;
          record(recipient, 'transfer_in', moved, reason, from);
          commit(recipient);
          return true;
        },

        expireCredits: (subscriber) => {
          const now = get().now();
          const acc = cloneAccount(account(subscriber));
          const expired = realizeExpiry(acc, now);
          commit(acc);
          return expired;
        },

        getBalance: (subscriber) => availableOf(account(subscriber), get().now()),
        getAccount: (subscriber) => cloneAccount(account(subscriber)),

        createWallet: (subscriber, subscriptionId, currency) => {
          const id = get().nextWalletId;
          const now = get().now();
          const wallet: PrepaymentWallet = {
            id,
            subscriber,
            subscriptionId,
            currency,
            balance: 0,
            totalDeposited: 0,
            totalWithdrawn: 0,
            totalDrawn: 0,
            transactions: [],
            createdAt: now,
            updatedAt: now,
          };
          set((state) => ({
            wallets: { ...state.wallets, [id]: wallet },
            nextWalletId: id + 1,
          }));
          return id;
        },

        getWallet: (walletId) => {
          const wallet = get().wallets[walletId];
          return wallet ? { ...wallet } : undefined;
        },

        deposit: (subscriber, walletId, amount) => {
          if (!isPositiveAmount(amount)) return undefined;
          const wallet = get().wallets[walletId];
          if (!wallet || wallet.subscriber !== subscriber) return undefined;
          const updated = {
            ...wallet,
            balance: wallet.balance + amount,
            totalDeposited: wallet.totalDeposited + amount,
            updatedAt: get().now(),
          };
          const snapshot = recordWalletTransaction(updated, 'deposit', amount);
          set((state) => ({ wallets: { ...state.wallets, [walletId]: updated } }));
          return snapshot;
        },

        withdraw: (subscriber, walletId, amount) => {
          if (!isPositiveAmount(amount)) return undefined;
          const wallet = get().wallets[walletId];
          if (!wallet || wallet.subscriber !== subscriber || wallet.balance < amount) return undefined;
          const updated = {
            ...wallet,
            balance: wallet.balance - amount,
            totalWithdrawn: wallet.totalWithdrawn + amount,
            updatedAt: get().now(),
          };
          const snapshot = recordWalletTransaction(updated, 'withdraw', amount);
          set((state) => ({ wallets: { ...state.wallets, [walletId]: updated } }));
          return snapshot;
        },

        drawdown: (subscriber, walletId, amount) => {
          if (!isPositiveAmount(amount)) return undefined;
          const wallet = get().wallets[walletId];
          if (!wallet || wallet.subscriber !== subscriber || wallet.balance < amount) return undefined;
          const updated = {
            ...wallet,
            balance: wallet.balance - amount,
            totalDrawn: wallet.totalDrawn + amount,
            updatedAt: get().now(),
          };
          const snapshot = recordWalletTransaction(updated, 'drawdown', amount);
          set((state) => ({ wallets: { ...state.wallets, [walletId]: updated } }));
          return snapshot;
        },
      };
    },
    {
      name: 'subtrackr-credit-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        accounts: state.accounts,
        nextId: state.nextId,
        wallets: state.wallets,
        nextWalletId: state.nextWalletId,
        walletTransactionIds: state.walletTransactionIds,
      }),
    }
  )
);
