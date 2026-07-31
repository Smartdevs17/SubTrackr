/**
 * Credit system types — shared between the backend `CreditService` and any
 * downstream code that needs to reason about credit balances, audit trails,
 * analytics or reporting.
 *
 * This module prefers the ledger model (lots + transactions + balance) which
 * matches the on-chain `subtrackr-credit` Soroban contract. The web app uses a
 * higher-level `CreditNote` projection (DRAFT/ISSUED/PARTIALLY_APPLIED/APPLIED
 * etc.) — that projection is materialised on demand inside `CreditService` so
 * there is no separate source of truth.
 */

// ─── Core ledger model (source of truth) ────────────────────────────────────

export type ExpirationPolicy =
  | { kind: 'never' }
  | { kind: 'after_secs'; seconds: number };

export interface CreditLot {
  /** Monotonically-increasing lot identifier. */
  id: number;
  /** Remaining, unconsumed amount of this lot. */
  remaining: number;
  /** Unix seconds when the lot was issued. */
  issuedAt: number;
  /** Unix seconds when the lot expires. `undefined` means it never expires. */
  expiresAt?: number;
}

export type CreditEntryKind =
  | 'issue'
  | 'apply'
  | 'transfer_in'
  | 'transfer_out'
  | 'expire'
  | 'deposit'
  | 'withdraw';

/** A single immutable ledger entry. `amount` is signed (+/-). */
export interface CreditEntry {
  id: number;
  kind: CreditEntryKind;
  amount: number;
  timestamp: number;
  reason: string;
  counterparty?: string;
}

/** Subscriber's complete credit account. */
export interface CreditAccount {
  accountId: string;
  balance: number;
  /** Available (unexpired) credit. Computed on read. */
  available: number;
  lots: CreditLot[];
  entries: CreditEntry[];
  expirationPolicy: ExpirationPolicy;
}

// ─── Prepayment wallet ──────────────────────────────────────────────────────

export type PrepaymentTxKind = 'deposit' | 'withdraw' | 'drawdown';

export interface PrepaymentTransaction {
  id: number;
  walletId: number;
  kind: PrepaymentTxKind;
  amount: number;
  balanceAfter: number;
  invoiceId?: string;
  timestamp: number;
}

export interface PrepaymentWallet {
  id: number;
  accountId: string;
  subscriptionId: string;
  currency: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Operation inputs / outputs ─────────────────────────────────────────────

export interface IssueCreditInput {
  accountId: string;
  /** Admin/system actor that authorises the issuance. */
  actor: string;
  amount: number;
  reason: string;
  /** Optional explicit expiry; if absent, the account's policy decides. */
  expiresAt?: number;
}

export interface ApplyCreditInput {
  accountId: string;
  subscriptionId: string;
  /** The gross amount due on the invoice/charge. */
  amountDue: number;
}

export interface ApplyCreditResult {
  accountId: string;
  subscriptionId: string;
  applied: number;
  remainingDue: number;
  balanceAfter: number;
}

export interface TransferCreditInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  reason: string;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface AccountCreditSummary {
  accountId: string;
  balance: number;
  availableBalance: number;
  totalIssued: number;
  totalApplied: number;
  totalTransferredIn: number;
  totalTransferredOut: number;
  totalExpired: number;
  /** Sum of remaining amounts across lots that will expire in the future. */
  expiringByTimeBucket: Record<'expires_within_7d' | 'expires_within_30d' | 'no_expiry', number>;
  /** Average days from issuance to consumption, across applied lots. */
  averageConsumptionDays: number;
}

export interface CreditBucketBreakdown {
  totalActiveAccounts: number;
  /**
   * Total credit that would be outstanding if all past-due lots were
   * immediately expired (committed-to-the-ledger view, including projected
   * expiry). For the committed-only view (already-recorded expirations), use
   * `totalOutstandingLiabilityCommitted`.
   */
  totalOutstandingLiability: number;
  /**
   * Committed outstanding liability — reflects the ledger as it stands
   * (past-due lots not yet expired via `expireAccount` still count here).
   */
  totalOutstandingLiabilityCommitted: number;
  totalIssuedAllTime: number;
  totalAppliedAllTime: number;
  /** Sum of `expire` ledger entries that have been recorded. */
  totalExpiredAllTime: number;
  /**
   * Sum of past-due-but-not-yet-committed expirable credit. Useful to expose
   * the "would-be breakage if we ran `expireAll` right now" gap on dashboards.
   */
  totalExpiredProjectedAllTime: number;
  /** Issued / applied / expired amounts grouped by reason. */
  issuanceByReason: Record<string, number>;
}

export interface CreditUsageTrendPoint {
  /** Unix seconds, aligned to start of the bucket. */
  timestamp: number;
  issued: number;
  applied: number;
  /** Committed `expire` entries that landed in this bucket. */
  expired: number;
  /** Past-due lots whose expiry was realised at read-time. */
  expiredProjected: number;
  netIssuance: number;
}

export interface CreditExpiryForecast {
  accountId: string;
  amount: number;
  expiresAt: number;
  daysRemaining: number;
}

export interface TopAccount {
  accountId: string;
  balance: number;
  availableBalance: number;
  rank: number;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export type ReportFormat = 'csv' | 'json';

export interface CreditReport {
  generatedAt: number;
  accountId: string;
  summary: AccountCreditSummary;
  entries: CreditEntry[];
  wallets: PrepaymentWallet[];
  transactions: PrepaymentTransaction[];
  /** Lifetime issuance → application → expiry chain. */
  ledgerFlow: { issued: number; applied: number; expired: number };
}

export interface CreditAuditQuery {
  accountId: string;
  fromTime?: number;
  toTime?: number;
  kinds?: CreditEntryKind[];
  /** Pagination — caller uses `limit` to bound response size. */
  limit?: number;
  offset?: number;
}

export interface CreditAuditPage {
  entries: CreditEntry[];
  totalEntries: number;
  hasMore: boolean;
  nextOffset: number | null;
}
