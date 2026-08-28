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

export type CreditTxKind =
  | 'issue'
  | 'apply'
  | 'transfer_in'
  | 'transfer_out'
  | 'expire'
  | 'deposit'
  | 'withdraw';

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

/**
 * Consolidated account-balance summary for a subscriber, combining on-book
 * credit (available/issued/expired/applied/transferred) with any prepayment
 * wallet funds. Used for high-level balance display and reconciliation.
 */
export interface AccountBalance {
  subscriber: string;
  availableCredit: number;
  totalIssued: number;
  totalApplied: number;
  totalExpired: number;
  totalTransferredIn: number;
  totalTransferredOut: number;
  totalDeposited: number;
  totalWithdrawn: number;
  prepaymentBalance: number;
  netBalance: number;
  nextExpirationAt?: number;
}

const isExpired = (lot: CreditLot, now: number): boolean =>
  lot.expiresAt !== undefined && lot.expiresAt <= now;

const availableOf = (account: AccountCredit, now: number): number =>
  account.lots.reduce(
    (sum, lot) => (lot.remaining > 0 && !isExpired(lot, now) ? sum + lot.remaining : sum),
    0
  );

interface CreditStoreState {
  accounts: Record<string, AccountCredit>;
  wallets: Record<string, CreditWallet>;
  nextId: number;
  now: () => number;

  issueCredit: (subscriber: string, amount: number, reason: string, expiresAt?: number) => void;
  setExpirationPolicy: (subscriber: string, policy: ExpirationPolicy) => void;
  applyCredit: (subscriber: string, subscriptionId: string, amountDue: number) => CreditApplied;
  transferCredit: (from: string, to: string, amount: number, reason: string) => boolean;
  depositCredit: (subscriber: string, amount: number, reason: string) => void;
  withdrawCredit: (subscriber: string, amount: number, reason: string) => boolean;
  expireCredits: (subscriber: string) => number;
  getBalance: (subscriber: string) => number;
  getAccount: (subscriber: string) => AccountCredit;
  getAccountBalance: (subscriber: string) => AccountBalance;
  getAccountBalances: () => AccountBalance[];
}

/** Prepayment wallet tracked alongside credit accounts. */
export interface CreditWallet {
  id: string;
  subscriber: string;
  currency: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
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
        ];
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
        lots: [...acc.lots],
        transactions: [...acc.transactions],
      });

      return {
        accounts: {},
        wallets: {},
        nextId: 0,
        now: () => Math.floor(Date.now() / 1000),

        issueCredit: (subscriber, amount, reason, expiresAt) => {
          if (amount <= 0) return;
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
          const applied = consume(acc, now, Math.max(0, amountDue));
          if (applied > 0) {
            acc.balance -= applied;
            record(acc, 'apply', -applied, 'charge_application');
          }
          commit(acc);
          return {
            subscriptionId,
            applied,
            remainingDue: amountDue - applied,
            balanceAfter: acc.balance,
          };
        },

        transferCredit: (from, to, amount, reason) => {
          if (amount <= 0 || from === to) return false;
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
        getAccount: (subscriber) => account(subscriber),

        depositCredit: (subscriber, amount, reason) => {
          if (amount <= 0) return;
          const now = get().now();
          const acc = cloneAccount(account(subscriber));
          realizeExpiry(acc, now);
          acc.balance += amount;
          acc.lots.push({ id: nextId(), remaining: amount, issuedAt: now });
          record(acc, 'deposit', amount, reason);
          commit(acc);
        },

        withdrawCredit: (subscriber, amount, reason) => {
          if (amount <= 0) return false;
          const now = get().now();
          const acc = cloneAccount(account(subscriber));
          realizeExpiry(acc, now);
          if (availableOf(acc, now) < amount) return false;
          const moved = consume(acc, now, amount);
          acc.balance -= moved;
          record(acc, 'withdraw', -moved, reason);
          commit(acc);
          return true;
        },

        getAccountBalance: (subscriber): AccountBalance => {
          const now = get().now();
          const acc = account(subscriber);
          const availableCredit = availableOf(acc, now);
          const totalApplied = acc.transactions
            .filter((t) => t.kind === 'apply')
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
          const totalExpired = acc.transactions
            .filter((t) => t.kind === 'expire')
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
          const totalTransferredIn = acc.transactions
            .filter((t) => t.kind === 'transfer_in')
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
          const totalTransferredOut = acc.transactions
            .filter((t) => t.kind === 'transfer_out')
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);
          const totalIssued = acc.transactions
            .filter((t) => t.kind === 'issue' || t.kind === 'deposit')
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);

          const wallets = Object.values(get().wallets).filter(
            (w) => w.subscriber === subscriber
          );
          const totalDeposited = wallets.reduce((s, w) => s + w.totalDeposited, 0);
          const totalWithdrawn = wallets.reduce((s, w) => s + w.totalWithdrawn, 0);
          const prepaymentBalance = wallets.reduce((s, w) => s + w.balance, 0);

          const expiringLots = acc.lots
            .filter((lot) => lot.remaining > 0 && lot.expiresAt !== undefined && lot.expiresAt > now)
            .sort((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));

          return {
            subscriber,
            availableCredit,
            totalIssued,
            totalApplied,
            totalExpired,
            totalTransferredIn,
            totalTransferredOut,
            totalDeposited,
            totalWithdrawn,
            prepaymentBalance,
            netBalance: availableCredit + prepaymentBalance,
            nextExpirationAt: expiringLots[0]?.expiresAt,
          };
        },

        getAccountBalances: () =>
          [...new Set([...Object.keys(get().accounts), ...Object.keys(get().wallets)])]
            .map((sub) => get().getAccountBalance(sub)),
      };
    },
    {
      name: 'subtrackr-credit-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        accounts: state.accounts,
        wallets: state.wallets,
        nextId: state.nextId,
      }),
    }
  )
);
