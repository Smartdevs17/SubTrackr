/**
 * Server-side credit service for SubTrackr.
 *
 * Architectural notes
 * -------------------
 * * The **source of truth** is a ledger model (lots + signed entries +
 *   running balance). It intentionally mirrors the on-chain
 *   `subtrackr-credit` Soroban contract and the mobile `AccountCredit`
 *   store so we can later replay a stream of contract transactions into
 *   this service without translation.
 * * This service integrates with billing **at invoice close**:
 *     draft invoice  →  metering  →  applyCreditToCharge  →  payments / dunning.
 *   Anything downstream of `applyCreditToCharge` only ever sees the net
 *   amount due.
 * * Where it differs from the Soroban contract:
 *   * In-process state (no persistence) — substitute with a database later.
 *   * Includes off-chain analytics (deferred liability, breakage, burn rate,
 *     top accounts, expiry forecast) and CSV/JSON reports that we don't put
 *     on-chain.
 * * Read methods (`getAccount`, `getGlobalBreakdown`, `listAccounts`,
 *   `topAccountsByBalance`, `getExpiryForecast`) are **strictly
 *   non-mutating**: they clone state and project expiry-aware figures
 *   without committing them back. The mutating expiry surface is
 *   `expireAccount()` / `expireAll()` — call those explicitly when
 *   you actually want the ledger updated.
 *
 * The web app keeps its own `CreditNote` store for the higher-level
 * status-projection UX (DRAFT/ISSUED/PARTIALLY_APPLIED/APPLIED/etc.). That
 * projection is owned by the web store and not duplicated here to keep the
 * backend's contract-shaped ledger clean.
 */

import type {
  AccountCreditSummary,
  ApplyCreditInput,
  ApplyCreditResult,
  CreditAccount,
  CreditAuditPage,
  CreditAuditQuery,
  CreditBucketBreakdown,
  CreditEntry,
  CreditEntryKind,
  CreditExpiryForecast,
  CreditLot,
  CreditReport,
  CreditUsageTrendPoint,
  ExpirationPolicy,
  IssueCreditInput,
  PrepaymentTransaction,
  PrepaymentWallet,
  TopAccount,
  TransferCreditInput,
} from './creditTypes';
import { BillingError } from './errors';

const ONE_DAY_SECS = 86_400;
const ONE_HOUR_SECS = 3_600;

// ─── Helpers ────────────────────────────────────────────────────────────────

const nowSec = (): number => Math.floor(Date.now() / 1_000);

const isExpiredLot = (lot: CreditLot, now: number): boolean =>
  lot.expiresAt !== undefined && lot.expiresAt <= now;

const availableOf = (account: CreditAccount, now: number): number =>
  account.lots.reduce(
    (sum, lot) => (lot.remaining > 0 && !isExpiredLot(lot, now) ? sum + lot.remaining : sum),
    0
  );

const cloneAccount = (acc: CreditAccount): CreditAccount => ({
  ...acc,
  lots: [...acc.lots],
  entries: [...acc.entries],
});

/** Deep-clone a returned account so callers cannot mutate stored state. */
const deepCloneAccount = (acc: CreditAccount): CreditAccount => ({
  ...acc,
  lots: acc.lots.map((l) => ({ ...l })),
  entries: acc.entries.map((e) => ({ ...e })),
});

const deepCloneEntry = (e: CreditEntry): CreditEntry => ({ ...e });

const deepCloneTransaction = (t: PrepaymentTransaction): PrepaymentTransaction => ({ ...t });

// ─── Service ────────────────────────────────────────────────────────────────

export class CreditService {
  private readonly accounts = new Map<string, CreditAccount>();
  private readonly wallets = new Map<number, PrepaymentWallet>();
  private readonly walletTx = new Map<number, PrepaymentTransaction[]>();
  private nextLotId = 1;
  private nextEntryId = 1;
  private nextWalletId = 1;
  private nextTxId = 1;
  private readonly now: () => number;

  constructor(opts: { clock?: () => number } = {}) {
    this.now = opts.clock ?? nowSec;
  }

  // ─── Account housekeeping ───────────────────────────────────────────────

  private ensureAccount(accountId: string): CreditAccount {
    let acc = this.accounts.get(accountId);
    if (!acc) {
      acc = {
        accountId,
        balance: 0,
        available: 0,
        lots: [],
        entries: [],
        expirationPolicy: { kind: 'never' },
      };
      this.accounts.set(accountId, acc);
    }
    return acc;
  }

  private commit(acc: CreditAccount): void {
    this.accounts.set(acc.accountId, acc);
  }

  private record(
    acc: CreditAccount,
    kind: CreditEntryKind,
    amount: number,
    reason: string,
    counterparty?: string
  ): void {
    acc.entries.push({
      id: this.nextEntryId++,
      kind,
      amount,
      timestamp: this.now(),
      reason,
      counterparty,
    });
  }

  /** Realises expiry on the supplied account *in place*; returns how much was
   *  expired. Does NOT record an entry — callers either commit the synthetic
   *  entry themselves (mutating path: expireAccount) or rely on the projection
   *  helper below (read path). */
  private realiseExpiryInPlace(acc: CreditAccount, now: number): number {
    let expired = 0;
    acc.lots = acc.lots.map((lot) => {
      if (lot.remaining > 0 && isExpiredLot(lot, now)) {
        expired += lot.remaining;
        return { ...lot, remaining: 0 };
      }
      return lot;
    });
    if (expired > 0) acc.balance -= expired;
    return expired;
  }

  /** Mutating helper: zeroes expired lots, decrements balance, and records a
   *  single `expire` ledger entry. */
  private realiseExpiry(acc: CreditAccount, now: number): number {
    const expired = this.realiseExpiryInPlace(acc, now);
    if (expired > 0) this.record(acc, 'expire', -expired, 'expired');
    return expired;
  }

  /** Truly non-mutating projection: returns a clone of `acc` whose lots
   *  reflect a hypothetical "if we ran expireAccount right now" outcome.
   *  The plane of `entries` is **unchanged** (no synthetic entries pushed) and
   *  no instance counters are advanced — callers can iterate `projected.entries`
   *  safely for audit-trail / reporting purposes. */
  private projectExpiry(acc: CreditAccount, now: number): CreditAccount {
    const projected = cloneAccount(acc);
    let pastDueTotal = 0;
    projected.lots = projected.lots.map((lot) => {
      if (lot.remaining > 0 && isExpiredLot(lot, now)) {
        pastDueTotal += lot.remaining;
        return { ...lot, remaining: 0 };
      }
      return lot;
    });
    projected.available = availableOf(projected, now);
    if (pastDueTotal > 0) projected.balance -= pastDueTotal;
    return projected;
  }

  private consume(acc: CreditAccount, now: number, amount: number): number {
    let remaining = amount;
    acc.lots = acc.lots.map((lot) => {
      if (remaining <= 0 || lot.remaining <= 0 || isExpiredLot(lot, now)) return lot;
      const take = Math.min(lot.remaining, remaining);
      remaining -= take;
      return { ...lot, remaining: lot.remaining - take };
    });
    return amount - remaining;
  }

  private refreshAvailable(acc: CreditAccount): void {
    acc.available = availableOf(acc, this.now());
  }

  // ─── Account-level configuration ────────────────────────────────────────

  setExpirationPolicy(accountId: string, policy: ExpirationPolicy): void {
    const acc = this.ensureAccount(accountId);
    acc.expirationPolicy = policy;
    this.commit(acc);
  }

  /** Deep-clone read of an account. Callers cannot mutate stored state. */
  getAccount(accountId: string): CreditAccount {
    const acc = this.ensureAccount(accountId);
    const projected = this.projectExpiry(acc, this.now());
    this.refreshAvailable(projected);
    return deepCloneAccount(projected);
  }

  getBalance(accountId: string): number {
    return availableOf(this.ensureAccount(accountId), this.now());
  }

  // ─── Issue ─────────────────────────────────────────────────────────────

  issueCredit(input: IssueCreditInput): CreditAccount {
    if (input.amount <= 0) {
      throw BillingError.creditInvalidAmount('amount must be positive');
    }
    const now = this.now();
    const acc = cloneAccount(this.ensureAccount(input.accountId));
    this.realiseExpiry(acc, now);

    const expiry =
      input.expiresAt ??
      (acc.expirationPolicy.kind === 'after_secs'
        ? now + acc.expirationPolicy.seconds
        : undefined);

    acc.lots.push({
      id: this.nextLotId++,
      remaining: input.amount,
      issuedAt: now,
      expiresAt: expiry,
    });
    acc.balance += input.amount;
    this.record(acc, 'issue', input.amount, input.reason, input.actor);
    this.refreshAvailable(acc);
    this.commit(acc);
    return this.getAccount(acc.accountId);
  }

  // ─── Apply to a charge ─────────────────────────────────────────────────

  applyCreditToCharge(input: ApplyCreditInput): ApplyCreditResult {
    if (input.amountDue < 0) {
      throw BillingError.creditInvalidAmount('amountDue may not be negative');
    }
    const now = this.now();
    const acc = cloneAccount(this.ensureAccount(input.accountId));
    this.realiseExpiry(acc, now);
    const available = availableOf(acc, now);
    const applied = this.consume(acc, now, Math.min(input.amountDue, available));
    if (applied > 0) {
      acc.balance -= applied;
      this.record(acc, 'apply', -applied, 'charge_application');
    }
    this.refreshAvailable(acc);
    this.commit(acc);
    return {
      accountId: acc.accountId,
      subscriptionId: input.subscriptionId,
      applied,
      remainingDue: input.amountDue - applied,
      balanceAfter: acc.balance,
    };
  }

  // ─── Transfer between accounts ─────────────────────────────────────────

  transferCredit(input: TransferCreditInput): { from: CreditAccount; to: CreditAccount } {
    if (input.amount <= 0) {
      throw BillingError.creditInvalidAmount('amount must be positive');
    }
    if (input.fromAccountId === input.toAccountId) {
      throw BillingError.creditSelfTransfer(input.fromAccountId);
    }
    const now = this.now();
    const sender = cloneAccount(this.ensureAccount(input.fromAccountId));
    this.realiseExpiry(sender, now);
    if (availableOf(sender, now) < input.amount) {
      throw BillingError.creditInsufficient(
        input.fromAccountId,
        input.amount,
        availableOf(sender, now)
      );
    }
    const moved = this.consume(sender, now, input.amount);
    sender.balance -= moved;
    this.record(sender, 'transfer_out', -moved, input.reason, input.toAccountId);
    this.refreshAvailable(sender);
    this.commit(sender);

    const recipient = cloneAccount(this.ensureAccount(input.toAccountId));
    this.realiseExpiry(recipient, now);
    const expiry =
      recipient.expirationPolicy.kind === 'after_secs'
        ? now + recipient.expirationPolicy.seconds
        : undefined;
    recipient.lots.push({
      id: this.nextLotId++,
      remaining: moved,
      issuedAt: now,
      expiresAt: expiry,
    });
    recipient.balance += moved;
    this.record(recipient, 'transfer_in', moved, input.reason, input.fromAccountId);
    this.refreshAvailable(recipient);
    this.commit(recipient);

    return { from: this.getAccount(sender.accountId), to: this.getAccount(recipient.accountId) };
  }

  // ─── Expiry (mutating — explicitly named) ──────────────────────────────

  expireAccount(accountId: string): { expiredAmount: number; account: CreditAccount } {
    const now = this.now();
    const acc = cloneAccount(this.ensureAccount(accountId));
    const expiredAmount = this.realiseExpiry(acc, now);
    this.refreshAvailable(acc);
    this.commit(acc);
    return { expiredAmount, account: this.getAccount(accountId) };
  }

  /** Cron-style sweep across every account (or a particular subset). */
  expireAll(accounts?: string[]): Array<{ accountId: string; expiredAmount: number }> {
    const targets = accounts ?? Array.from(this.accounts.keys());
    return targets.map((id) => ({
      accountId: id,
      expiredAmount: this.expireAccount(id).expiredAmount,
    }));
  }

  // ─── Prepayment wallets ────────────────────────────────────────────────

  createWallet(input: {
    accountId: string;
    subscriptionId: string;
    currency: string;
  }): PrepaymentWallet {
    const now = this.now();
    const wallet: PrepaymentWallet = {
      id: this.nextWalletId++,
      accountId: input.accountId,
      subscriptionId: input.subscriptionId,
      currency: input.currency,
      balance: 0,
      totalDeposited: 0,
      totalWithdrawn: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.wallets.set(wallet.id, wallet);
    this.walletTx.set(wallet.id, []);
    return { ...wallet };
  }

  deposit(input: { walletId: number; accountId: string; amount: number }): PrepaymentWallet {
    if (input.amount <= 0) {
      throw BillingError.creditInvalidAmount('deposit must be positive');
    }
    const wallet = this.wallets.get(input.walletId);
    if (!wallet || wallet.accountId !== input.accountId) {
      throw BillingError.walletNotFound(input.walletId);
    }
    const now = this.now();
    wallet.balance += input.amount;
    wallet.totalDeposited += input.amount;
    wallet.updatedAt = now;
    const tx: PrepaymentTransaction = {
      id: this.nextTxId++,
      walletId: wallet.id,
      kind: 'deposit',
      amount: input.amount,
      balanceAfter: wallet.balance,
      timestamp: now,
    };
    const txs = this.walletTx.get(wallet.id) ?? [];
    txs.push(tx);
    this.walletTx.set(wallet.id, txs);
    return { ...wallet };
  }

  withdraw(input: { walletId: number; accountId: string; amount: number }): PrepaymentWallet {
    if (input.amount <= 0) {
      throw BillingError.creditInvalidAmount('withdraw must be positive');
    }
    const wallet = this.wallets.get(input.walletId);
    if (!wallet || wallet.accountId !== input.accountId) {
      throw BillingError.walletNotFound(input.walletId);
    }
    if (wallet.balance < input.amount) {
      throw BillingError.creditInsufficient(
        `wallet:${input.walletId}`,
        input.amount,
        wallet.balance
      );
    }
    const now = this.now();
    wallet.balance -= input.amount;
    wallet.totalWithdrawn += input.amount;
    wallet.updatedAt = now;
    const tx: PrepaymentTransaction = {
      id: this.nextTxId++,
      walletId: wallet.id,
      kind: 'withdraw',
      amount: input.amount,
      balanceAfter: wallet.balance,
      timestamp: now,
    };
    const txs = this.walletTx.get(wallet.id) ?? [];
    txs.push(tx);
    this.walletTx.set(wallet.id, txs);
    return { ...wallet };
  }

  drawdown(input: {
    walletId: number;
    accountId: string;
    invoiceId: string;
    amount: number;
  }): PrepaymentWallet {
    if (input.amount <= 0) {
      throw BillingError.creditInvalidAmount('drawdown must be positive');
    }
    const wallet = this.wallets.get(input.walletId);
    if (!wallet || wallet.accountId !== input.accountId) {
      throw BillingError.walletNotFound(input.walletId);
    }
    const drawdownAmount = Math.min(wallet.balance, input.amount);
    if (drawdownAmount <= 0) return { ...wallet };
    const now = this.now();
    wallet.balance -= drawdownAmount;
    wallet.totalWithdrawn += drawdownAmount;
    wallet.updatedAt = now;
    const tx: PrepaymentTransaction = {
      id: this.nextTxId++,
      walletId: wallet.id,
      kind: 'drawdown',
      amount: drawdownAmount,
      balanceAfter: wallet.balance,
      invoiceId: input.invoiceId,
      timestamp: now,
    };
    const txs = this.walletTx.get(wallet.id) ?? [];
    txs.push(tx);
    this.walletTx.set(wallet.id, txs);
    return { ...wallet };
  }

  getWallet(walletId: number): PrepaymentWallet | undefined {
    const w = this.wallets.get(walletId);
    return w ? { ...w } : undefined;
  }

  getWalletTransactions(walletId: number): PrepaymentTransaction[] {
    return (this.walletTx.get(walletId) ?? []).map(deepCloneTransaction);
  }

  listWalletsForAccount(accountId: string): PrepaymentWallet[] {
    return Array.from(this.wallets.values())
      .filter((w) => w.accountId === accountId)
      .map((w) => ({ ...w }));
  }

  // ─── Analytics (strictly non-mutating reads) ───────────────────────────

  getAccountSummary(accountId: string): AccountCreditSummary {
    const projected = this.projectExpiry(this.ensureAccount(accountId), this.now());
    return computeSummary(projected, this.now());
  }

  /**
   * Global roll-up: outstanding liability (deferred-credit figure for the
   * accounting/finance team), all-time issuance/application/expiry totals,
   * and the issuance-by-reason distribution (refund vs promo vs adjustment).
   */
  getGlobalBreakdown(): CreditBucketBreakdown {
    const now = this.now();
    let active = 0;
    let outstandingProjected = 0;
    let outstandingCommitted = 0;
    let totalIssued = 0;
    let totalApplied = 0;
    let totalExpired = 0;
    let totalExpiredProjected = 0;
    const issuanceByReason: Record<string, number> = {};

    for (const acc of this.accounts.values()) {
      const projected = this.projectExpiry(acc, now);
      if (projected.available > 0) active += 1;
      outstandingProjected += projected.available;
      // Committed-side outstanding = sum of lot remaining values from the
      // canonical account (no past-due lot zeroing applied).
      outstandingCommitted += acc.lots.reduce((s, lot) => s + lot.remaining, 0);
      totalExpiredProjected += projected.balance < acc.balance
        ? acc.balance - projected.balance
        : 0;

      for (const entry of acc.entries) {
        if (entry.kind === 'issue' && entry.amount > 0) {
          totalIssued += entry.amount;
          issuanceByReason[entry.reason] =
            (issuanceByReason[entry.reason] ?? 0) + entry.amount;
        } else if (entry.kind === 'apply' && entry.amount < 0) {
          totalApplied += -entry.amount;
        } else if (entry.kind === 'expire' && entry.amount < 0) {
          totalExpired += -entry.amount;
        }
      }
    }

    return {
      totalActiveAccounts: active,
      totalOutstandingLiability: outstandingProjected,
      totalOutstandingLiabilityCommitted: outstandingCommitted,
      totalIssuedAllTime: totalIssued,
      totalAppliedAllTime: totalApplied,
      totalExpiredAllTime: totalExpired,
      totalExpiredProjectedAllTime: totalExpiredProjected,
      issuanceByReason,
    };
  }

  /**
   * Issuance / application / expiry bucketed by day for the last N days.
   * Reads expiry-realised entries (projection-only) so past-due lots show up
   * immediately in the trend.
   */
  getUsageTrend(days = 30, bucketSecs = ONE_DAY_SECS): CreditUsageTrendPoint[] {
    if (days <= 0) return [];
    const now = this.now();
    // Window is inclusive of `now`: the last bucket ends at `now`, so we
    // anchor the buckets at `start = now - (days - 1) * bucketSecs`.
    const start = now - (days - 1) * bucketSecs;
    const buckets = new Map<number, CreditUsageTrendPoint>();

    for (let i = 0; i < days; i += 1) {
      const ts = start + i * bucketSecs;
      buckets.set(ts, {
        timestamp: ts,
        issued: 0,
        applied: 0,
        expired: 0,
        expiredProjected: 0,
        netIssuance: 0,
      });
    }

    for (const acc of this.accounts.values()) {
      const projected = this.projectExpiry(acc, now);
      const projectedExpiredDelta =
        projected.balance < acc.balance ? acc.balance - projected.balance : 0;
      // Bucket past-due expirable amounts into the LAST bucket — they're
      // "about-to-expire" from the consumer's perspective at read time.
      if (projectedExpiredDelta > 0) {
        const lastBucketTs = start + (days - 1) * bucketSecs;
        const lastBucket = buckets.get(lastBucketTs);
        if (lastBucket) lastBucket.expiredProjected += projectedExpiredDelta;
      }

      for (const entry of acc.entries) {
        if (entry.timestamp < start || entry.timestamp > now) continue;
        const idx = Math.min(days - 1, Math.floor((entry.timestamp - start) / bucketSecs));
        const bucketTs = start + idx * bucketSecs;
        const bucket = buckets.get(bucketTs);
        if (!bucket) continue;
        if (entry.kind === 'issue') {
          bucket.issued += entry.amount;
          bucket.netIssuance += entry.amount;
        } else if (entry.kind === 'apply') {
          bucket.applied += -entry.amount;
          bucket.netIssuance -= -entry.amount;
        } else if (entry.kind === 'expire') {
          bucket.expired += -entry.amount;
        }
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Expiry forecast for an account. Only includes lots that will expire in
   * the future — past-due lots are excluded since their expiry should already
   * have been (or about to be) realised by `expireAccount()`.
   */
  getExpiryForecast(
    accountId: string,
    horizonSecs = 30 * ONE_DAY_SECS
  ): CreditExpiryForecast[] {
    const acc = this.ensureAccount(accountId);
    const now = this.now();
    const horizonEnd = now + horizonSecs;
    const out: CreditExpiryForecast[] = [];
    for (const lot of acc.lots) {
      if (lot.remaining <= 0 || lot.expiresAt === undefined) continue;
      if (lot.expiresAt <= now) continue;
      if (lot.expiresAt > horizonEnd) continue;
      out.push({
        accountId,
        amount: lot.remaining,
        expiresAt: lot.expiresAt,
        daysRemaining: Math.max(1, Math.ceil((lot.expiresAt - now) / ONE_DAY_SECS)),
      });
    }
    return out.sort((a, b) => a.expiresAt - b.expiresAt);
  }

  /** Top accounts by available balance (descending). Uses projected expiry. */
  topAccountsByBalance(limit = 10): TopAccount[] {
    const now = this.now();
    const snapshot = Array.from(this.accounts.values()).map((acc) => {
      const projected = this.projectExpiry(acc, now);
      return {
        accountId: acc.accountId,
        balance: projected.balance,
        availableBalance: projected.available,
      };
    });
    snapshot.sort((a, b) => b.availableBalance - a.availableBalance);
    return snapshot.slice(0, limit).map((row, idx) => ({ ...row, rank: idx + 1 }));
  }

  /** List all known accounts (projection-only read). */
  listAccounts(): CreditAccount[] {
    const now = this.now();
    return Array.from(this.accounts.values()).map((acc) => {
      const projected = this.projectExpiry(acc, now);
      return deepCloneAccount(projected);
    });
  }

  // ─── Reporting ─────────────────────────────────────────────────────────

  printReport(accountId: string): CreditReport {
    const now = this.now();
    const live = this.projectExpiry(this.ensureAccount(accountId), now);
    const summary = computeSummary(live, now);
    const wallets = this.listWalletsForAccount(accountId);
    const transactions = wallets.flatMap((w) => this.getWalletTransactions(w.id));

    const issued = live.entries
      .filter((e) => e.kind === 'issue')
      .reduce((s, e) => s + e.amount, 0);
    const applied = live.entries
      .filter((e) => e.kind === 'apply')
      .reduce((s, e) => s + -e.amount, 0);
    const expired = live.entries
      .filter((e) => e.kind === 'expire')
      .reduce((s, e) => s + -e.amount, 0);

    return {
      generatedAt: now,
      accountId,
      summary,
      entries: live.entries.map(deepCloneEntry),
      wallets,
      transactions,
      ledgerFlow: { issued, applied, expired },
    };
  }

  exportReport(accountId: string, format: 'csv' | 'json'): string {
    const report = this.printReport(accountId);
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }
    return creditReportToCsv(report);
  }

  // ─── Audit trail (paginated queries) ───────────────────────────────────

  getAuditTrail(query: CreditAuditQuery): CreditAuditPage {
    const now = this.now();
    const projected = this.projectExpiry(this.ensureAccount(query.accountId), now);
    let entries = projected.entries.slice();

    if (query.fromTime !== undefined) {
      const from = query.fromTime;
      entries = entries.filter((e) => e.timestamp >= from);
    }
    if (query.toTime !== undefined) {
      const to = query.toTime;
      entries = entries.filter((e) => e.timestamp <= to);
    }
    if (query.kinds && query.kinds.length > 0) {
      const allowed = new Set<CreditEntryKind>(query.kinds);
      entries = entries.filter((e) => allowed.has(e.kind));
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);

    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.max(1, query.limit ?? 100);
    const page = entries.slice(offset, offset + limit);
    return {
      entries: page.map(deepCloneEntry),
      totalEntries: entries.length,
      hasMore: offset + limit < entries.length,
      nextOffset: offset + limit < entries.length ? offset + limit : null,
    };
  }
}

export const creditService = new CreditService();

// ─── free helpers ───────────────────────────────────────────────────────────

function computeSummary(acc: CreditAccount, now: number): AccountCreditSummary {
  const available = availableOf(acc, now);
  const lifetime = {
    issue: 0,
    apply: 0,
    transferIn: 0,
    transferOut: 0,
    expire: 0,
  };
  const consumptionLatencies: number[] = [];
  for (const entry of acc.entries) {
    if (entry.kind === 'issue') lifetime.issue += entry.amount;
    if (entry.kind === 'apply') {
      lifetime.apply += -entry.amount;
      const issue = findMatchingIssue(acc.entries, entry);
      if (issue) {
        consumptionLatencies.push((entry.timestamp - issue.timestamp) / ONE_DAY_SECS);
      }
    }
    if (entry.kind === 'transfer_in') lifetime.transferIn += entry.amount;
    if (entry.kind === 'transfer_out') lifetime.transferOut += -entry.amount;
    if (entry.kind === 'expire') lifetime.expire += -entry.amount;
  }

  const expiringByTimeBucket = {
    expires_within_7d: 0,
    expires_within_30d: 0,
    no_expiry: 0,
  };
  for (const lot of acc.lots) {
    if (lot.remaining <= 0) continue;
    if (!lot.expiresAt) {
      expiringByTimeBucket.no_expiry += lot.remaining;
      continue;
    }
    const days = Math.ceil((lot.expiresAt - now) / ONE_DAY_SECS);
    if (days <= 7) expiringByTimeBucket.expires_within_7d += lot.remaining;
    else if (days <= 30) expiringByTimeBucket.expires_within_30d += lot.remaining;
    else expiringByTimeBucket.no_expiry += lot.remaining;
  }

  return {
    accountId: acc.accountId,
    balance: acc.balance,
    availableBalance: available,
    totalIssued: lifetime.issue,
    totalApplied: lifetime.apply,
    totalTransferredIn: lifetime.transferIn,
    totalTransferredOut: lifetime.transferOut,
    totalExpired: lifetime.expire,
    expiringByTimeBucket,
    averageConsumptionDays:
      consumptionLatencies.length === 0
        ? 0
        : consumptionLatencies.reduce((s, n) => s + n, 0) / consumptionLatencies.length,
  };
}

function findMatchingIssue(
  entries: { kind: CreditEntryKind; amount: number; timestamp: number }[],
  apply: { kind: CreditEntryKind; amount: number; timestamp: number }
): { kind: CreditEntryKind; amount: number; timestamp: number } | undefined {
  // Best-effort: the latest `issue` for the same account that occurred before this apply.
  let candidate: { kind: CreditEntryKind; amount: number; timestamp: number } | undefined;
  for (const e of entries) {
    if (e.kind === 'issue' && e.amount > 0 && e.timestamp <= apply.timestamp) {
      candidate = e;
    }
  }
  return candidate;
}

export function creditReportToCsv(report: CreditReport): string {
  const rows: string[] = [];
  rows.push('# Credit Report');
  rows.push(`# account_id,${csvEscape(report.accountId)}`);
  rows.push(`# generated_at,${new Date(report.generatedAt * 1_000).toISOString()}`);
  rows.push(
    `# totals,issued=${report.ledgerFlow.issued},applied=${report.ledgerFlow.applied},expired=${report.ledgerFlow.expired}`
  );

  rows.push('section,entries');
  rows.push(['entry_id', 'kind', 'amount', 'timestamp', 'iso_time', 'reason', 'counterparty'].join(','));
  for (const e of report.entries) {
    rows.push(
      [
        e.id,
        e.kind,
        e.amount,
        e.timestamp,
        new Date(e.timestamp * 1_000).toISOString(),
        csvEscape(e.reason),
        csvEscape(e.counterparty ?? ''),
      ].join(',')
    );
  }

  if (report.wallets.length > 0) {
    rows.push('section,wallets');
    rows.push(
      [
        'wallet_id',
        'account_id',
        'subscription_id',
        'currency',
        'balance',
        'total_deposited',
        'total_withdrawn',
        'created_at',
        'updated_at',
      ].join(',')
    );
    for (const w of report.wallets) {
      rows.push(
        [
          w.id,
          csvEscape(w.accountId),
          csvEscape(w.subscriptionId),
          w.currency,
          w.balance,
          w.totalDeposited,
          w.totalWithdrawn,
          new Date(w.createdAt * 1_000).toISOString(),
          new Date(w.updatedAt * 1_000).toISOString(),
        ].join(',')
      );
    }
  }

  if (report.transactions.length > 0) {
    rows.push('section,wallet_transactions');
    rows.push(
      [
        'tx_id',
        'wallet_id',
        'kind',
        'amount',
        'balance_after',
        'invoice_id',
        'timestamp',
        'iso_time',
      ].join(',')
    );
    for (const t of report.transactions) {
      rows.push(
        [
          t.id,
          t.walletId,
          t.kind,
          t.amount,
          t.balanceAfter,
          t.invoiceId ?? '',
          t.timestamp,
          new Date(t.timestamp * 1_000).toISOString(),
        ].join(',')
      );
    }
  }

  return rows.join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export { ONE_DAY_SECS, ONE_HOUR_SECS };
