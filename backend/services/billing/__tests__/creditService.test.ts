import { CreditService, creditReportToCsv } from '../creditService';
import type { CreditReport } from '../creditTypes';
import { BillingError, BillingErrorCode } from '../errors';

type BillingErrorCodeValue = (typeof BillingErrorCode)[keyof typeof BillingErrorCode];

/** Asserts that calling `fn` throws a `BillingError` with the given error code. */
function expectBillingErrorCode(fn: () => unknown, code: BillingErrorCodeValue): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(BillingError);
  expect((caught as BillingError).code).toBe(code);
}

const ONE_DAY = 86_400;
const BASE = 1_700_000_000;

function makeService(): CreditService {
  const clockVal = BASE;
  return new CreditService({ clock: () => clockVal });
}

describe('CreditService', () => {
  describe('issueCredit', () => {
    it('issues credit and updates available balance', () => {
      const svc = makeService();
      const acc = svc.issueCredit({
        accountId: 'alice',
        actor: 'admin',
        amount: 500,
        reason: 'promo',
      });
      expect(acc.balance).toBe(500);
      expect(acc.available).toBe(500);
      expect(svc.getBalance('alice')).toBe(500);
      expect(acc.entries).toHaveLength(1);
      expect(acc.entries[0].kind).toBe('issue');
      expect(acc.entries[0].amount).toBe(500);
      expect(acc.entries[0].counterparty).toBe('admin');
    });

    it('rejects non-positive amounts', () => {
      const svc = makeService();
      expectBillingErrorCode(
        () => svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 0, reason: 'bad' }),
        BillingErrorCode.CREDIT_INVALID_AMOUNT
      );
    });

    it('applies expiration policy when no expiresAt is supplied', () => {
      const svc = makeService();
      svc.setExpirationPolicy('alice', { kind: 'after_secs', seconds: 100 });
      const beforeIssue = BASE;
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 100, reason: 'promo' });
      const lot = svc.getAccount('alice').lots[0];
      expect(lot.expiresAt).toBe(beforeIssue + 100);
    });

    it('honours an explicit expiresAt override', () => {
      const svc = makeService();
      const explicit = BASE + 10 * ONE_DAY;
      svc.issueCredit({
        accountId: 'alice',
        actor: 'admin',
        amount: 100,
        reason: 'make-good',
        expiresAt: explicit,
      });
      expect(svc.getAccount('alice').lots[0].expiresAt).toBe(explicit);
    });
  });

  describe('applyCreditToCharge', () => {
    it('caps application at the amount due', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 300, reason: 'refund' });
      const result = svc.applyCreditToCharge({
        accountId: 'alice',
        subscriptionId: 'sub_1',
        amountDue: 500,
      });
      expect(result.applied).toBe(300);
      expect(result.remainingDue).toBe(200);
      expect(result.balanceAfter).toBe(0);
      expect(svc.getBalance('alice')).toBe(0);
    });

    it('never goes negative when no credit exists', () => {
      const svc = makeService();
      const result = svc.applyCreditToCharge({
        accountId: 'alice',
        subscriptionId: 'sub_1',
        amountDue: 1000,
      });
      expect(result.applied).toBe(0);
      expect(result.remainingDue).toBe(1000);
      expect(svc.getBalance('alice')).toBe(0);
    });

    it('rejects negative amountDue', () => {
      const svc = makeService();
      expectBillingErrorCode(
        () => svc.applyCreditToCharge({ accountId: 'alice', subscriptionId: 'sub_1', amountDue: -10 }),
        BillingErrorCode.CREDIT_INVALID_AMOUNT
      );
    });

    it('consumes oldest lots first', () => {
      const svc = makeService();
      // first lot is smaller, issued earlier
      const firstExpiry = BASE + 5 * ONE_DAY;
      const secondExpiry = BASE + 30 * ONE_DAY;
      svc.issueCredit({
        accountId: 'alice',
        actor: 'admin',
        amount: 50,
        reason: 'first',
        expiresAt: firstExpiry,
      });
      svc.issueCredit({
        accountId: 'alice',
        actor: 'admin',
        amount: 200,
        reason: 'second',
        expiresAt: secondExpiry,
      });
      // consume 100 — should take all 50 of first + 50 of second
      const result = svc.applyCreditToCharge({
        accountId: 'alice',
        subscriptionId: 'sub_1',
        amountDue: 100,
      });
      expect(result.applied).toBe(100);
      const lots = svc.getAccount('alice').lots;
      expect(lots[0].remaining).toBe(0);
      expect(lots[1].remaining).toBe(150);
    });
  });

  describe('transferCredit', () => {
    it('transfers balance between accounts', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 400, reason: 'gift' });
      const result = svc.transferCredit({
        fromAccountId: 'alice',
        toAccountId: 'bob',
        amount: 150,
        reason: 'gift',
      });
      expect(result.from.balance).toBe(250);
      expect(result.to.balance).toBe(150);
      expect(svc.getBalance('bob')).toBe(150);
      const bobEntries = result.to.entries;
      const transferIn = bobEntries.find((e) => e.kind === 'transfer_in');
      expect(transferIn?.counterparty).toBe('alice');
    });

    it('rejects transfers exceeding available', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 100, reason: 'gift' });
      expectBillingErrorCode(
        () =>
          svc.transferCredit({
            fromAccountId: 'alice',
            toAccountId: 'bob',
            amount: 200,
            reason: 'gift',
          }),
        BillingErrorCode.CREDIT_INSUFFICIENT
      );
    });

    it('rejects self-transfer', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 100, reason: 'gift' });
      expectBillingErrorCode(
        () =>
          svc.transferCredit({
            fromAccountId: 'alice',
            toAccountId: 'alice',
            amount: 50,
            reason: 'self',
          }),
        BillingErrorCode.CREDIT_SELF_TRANSFER
      );
    });

    it('rejects non-positive amounts', () => {
      const svc = makeService();
      expectBillingErrorCode(
        () =>
          svc.transferCredit({
            fromAccountId: 'alice',
            toAccountId: 'bob',
            amount: 0,
            reason: 'gift',
          }),
        BillingErrorCode.CREDIT_INVALID_AMOUNT
      );
    });
  });

  describe('expiry', () => {
    it('expires credit past its deadline', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({
        accountId: 'alice',
        actor: 'admin',
        amount: 500,
        reason: 'promo',
        expiresAt: BASE + 100,
      });
      expect(svc.getBalance('alice')).toBe(500);
      clockVal = BASE + 5_000;
      const result = svc.expireAccount('alice');
      expect(result.expiredAmount).toBe(500);
      expect(svc.getAccount('alice').balance).toBe(0);
    });

    it('uses the expiration policy as a default expiry', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.setExpirationPolicy('alice', { kind: 'after_secs', seconds: 100 });
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 200, reason: 'promo' });
      clockVal = BASE + 50;
      expect(svc.getBalance('alice')).toBe(200);
      clockVal = BASE + 200;
      const result = svc.expireAccount('alice');
      expect(result.expiredAmount).toBe(200);
    });

    it('expireAll sweeps every account', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 100,
        reason: 'r',
        expiresAt: BASE + 10,
      });
      svc.issueCredit({
        accountId: 'b',
        actor: 'admin',
        amount: 200,
        reason: 'r',
        expiresAt: BASE + 10,
      });
      clockVal = BASE + 5_000;
      const results = svc.expireAll();
      expect(results).toHaveLength(2);
      const total = results.reduce((s, r) => s + r.expiredAmount, 0);
      expect(total).toBe(300);
    });
  });

  describe('prepayment wallets', () => {
    it('createWallet / deposit / withdraw / drawdown', () => {
      const svc = makeService();
      const wallet = svc.createWallet({
        accountId: 'alice',
        subscriptionId: 'sub_1',
        currency: 'USD',
      });
      expect(wallet.balance).toBe(0);
      svc.deposit({ walletId: wallet.id, accountId: 'alice', amount: 200 });
      const afterDeposit = svc.getWallet(wallet.id);
      expect(afterDeposit?.balance).toBe(200);
      expect(afterDeposit?.totalDeposited).toBe(200);

      svc.withdraw({ walletId: wallet.id, accountId: 'alice', amount: 50 });
      const afterWithdraw = svc.getWallet(wallet.id);
      expect(afterWithdraw?.balance).toBe(150);

      const afterDrawdown = svc.drawdown({
        walletId: wallet.id,
        accountId: 'alice',
        invoiceId: 'inv_1',
        amount: 100,
      });
      expect(afterDrawdown.balance).toBe(50);
      expect(afterDrawdown.totalWithdrawn).toBe(150);

      const txs = svc.getWalletTransactions(wallet.id);
      expect(txs).toHaveLength(3);
      expect(txs[0].kind).toBe('deposit');
      expect(txs[2].kind).toBe('drawdown');
      expect(txs[2].invoiceId).toBe('inv_1');
    });

    it('drawdown caps at wallet balance (does not go negative)', () => {
      const svc = makeService();
      const w = svc.createWallet({ accountId: 'a', subscriptionId: 's', currency: 'USD' });
      svc.deposit({ walletId: w.id, accountId: 'a', amount: 50 });
      const after = svc.drawdown({ walletId: w.id, accountId: 'a', invoiceId: 'i', amount: 100 });
      // draws down to zero, never negative; "drawn less than requested" is the
      // graceful partial-fulfilment contract.
      expect(after.balance).toBe(0);
      expect(after.totalWithdrawn).toBe(50);
    });

    it('rejects deposit / withdraw when wallet is missing', () => {
      const svc = makeService();
      expectBillingErrorCode(
        () => svc.deposit({ walletId: 9999, accountId: 'a', amount: 100 }),
        BillingErrorCode.WALLET_NOT_FOUND
      );
      expectBillingErrorCode(
        () => svc.withdraw({ walletId: 9999, accountId: 'a', amount: 100 }),
        BillingErrorCode.WALLET_NOT_FOUND
      );
    });

    it('rejects withdraw exceeding balance', () => {
      const svc = makeService();
      const w = svc.createWallet({ accountId: 'a', subscriptionId: 's', currency: 'USD' });
      expectBillingErrorCode(
        () => svc.withdraw({ walletId: w.id, accountId: 'a', amount: 1 }),
        BillingErrorCode.CREDIT_INSUFFICIENT
      );
    });

    it('listWalletsForAccount returns only matching wallets', () => {
      const svc = makeService();
      svc.createWallet({ accountId: 'a', subscriptionId: 's', currency: 'USD' });
      svc.createWallet({ accountId: 'b', subscriptionId: 's', currency: 'USD' });
      const list = svc.listWalletsForAccount('a');
      expect(list).toHaveLength(1);
      expect(list[0].accountId).toBe('a');
    });
  });

  describe('analytics', () => {
    it('getAccountSummary computes per-account lifetime aggregates', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({ accountId: 'alice', actor: 'admin', amount: 1000, reason: 'promo' });
      svc.applyCreditToCharge({ accountId: 'alice', subscriptionId: 'sub', amountDue: 250 });
      clockVal = BASE + 5;
      svc.applyCreditToCharge({ accountId: 'alice', subscriptionId: 'sub', amountDue: 100 });
      clockVal = BASE + 100_000;
      svc.transferCredit({
        fromAccountId: 'alice',
        toAccountId: 'bob',
        amount: 200,
        reason: 'gift',
      });

      const summary = svc.getAccountSummary('alice');
      expect(summary.totalIssued).toBe(1000);
      expect(summary.totalApplied).toBe(350);
      expect(summary.totalTransferredOut).toBe(200);
      expect(summary.balance).toBe(450);
      expect(summary.availableBalance).toBe(450);
      expect(summary.averageConsumptionDays).toBeGreaterThan(0);
    });

    it('getGlobalBreakdown aggregates across accounts', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 100, reason: 'refund' });
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 200, reason: 'promo' });
      svc.issueCredit({ accountId: 'b', actor: 'admin', amount: 50, reason: 'adjustment' });
      svc.applyCreditToCharge({ accountId: 'a', subscriptionId: 's', amountDue: 50 });

      const breakdown = svc.getGlobalBreakdown();
      expect(breakdown.totalIssuedAllTime).toBe(350);
      expect(breakdown.totalAppliedAllTime).toBe(50);
      expect(breakdown.totalActiveAccounts).toBe(2);
      // Projected side accounts for the same amount since no past-due lots.
      expect(breakdown.totalOutstandingLiability).toBe(300);
      expect(breakdown.totalOutstandingLiabilityCommitted).toBe(300);
      expect(breakdown.totalExpiredProjectedAllTime).toBe(0);
      expect(breakdown.issuanceByReason.refund).toBe(100);
      expect(breakdown.issuanceByReason.promo).toBe(200);
      expect(breakdown.issuanceByReason.adjustment).toBe(50);
    });

    it('getGlobalBreakdown exposes committed vs projected outstanding liability', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 100,
        reason: 'p',
        expiresAt: BASE + 50,
      });
      clockVal = BASE + 5_000; // past expiry
      const breakdown = svc.getGlobalBreakdown();
      // Past-due 100 is reflected on the projected side only.
      expect(breakdown.totalOutstandingLiability).toBe(0);
      expect(breakdown.totalOutstandingLiabilityCommitted).toBe(100);
      expect(breakdown.totalExpiredProjectedAllTime).toBe(100);
    });

    it('getUsageTrend produces N buckets sorted ascending', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 100, reason: 'promo' });
      clockVal = BASE + ONE_DAY;
      svc.applyCreditToCharge({ accountId: 'a', subscriptionId: 's', amountDue: 30 });
      clockVal = BASE + 2 * ONE_DAY;
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 50, reason: 'refund' });

      const trend = svc.getUsageTrend(7);
      expect(trend).toHaveLength(7);
      expect(trend[0].timestamp).toBeLessThan(trend[6].timestamp);
      const totalIssued = trend.reduce((s, p) => s + p.issued, 0);
      expect(totalIssued).toBe(150);
      const totalApplied = trend.reduce((s, p) => s + p.applied, 0);
      expect(totalApplied).toBe(30);
    });

    it('getUsageTrend returns empty array for non-positive days', () => {
      const svc = makeService();
      expect(svc.getUsageTrend(0)).toEqual([]);
    });

    it('getExpiryForecast returns lots within the horizon', () => {
      const svc = makeService();
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 100,
        reason: 'r',
        expiresAt: BASE + 5 * ONE_DAY,
      });
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 50,
        reason: 'r',
        expiresAt: BASE + 60 * ONE_DAY,
      });
      const forecast = svc.getExpiryForecast('a', 30 * ONE_DAY);
      expect(forecast).toHaveLength(1);
      expect(forecast[0].amount).toBe(100);
      expect(forecast[0].daysRemaining).toBe(5);
    });

    it('topAccountsByBalance returns ranked accounts', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 50, reason: 'r' });
      svc.issueCredit({ accountId: 'b', actor: 'admin', amount: 200, reason: 'r' });
      svc.issueCredit({ accountId: 'c', actor: 'admin', amount: 100, reason: 'r' });
      const top = svc.topAccountsByBalance(2);
      expect(top).toHaveLength(2);
      expect(top[0].accountId).toBe('b');
      expect(top[1].accountId).toBe('c');
    });

    it('monitoring hours bucket classifies lots correctly', () => {
      const svc = makeService();
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 50,
        reason: 'r',
        expiresAt: BASE + 3 * ONE_DAY,
      });
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 75,
        reason: 'r',
        expiresAt: BASE + 20 * ONE_DAY,
      });
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 200, reason: 'never' });
      const summary = svc.getAccountSummary('a');
      expect(summary.expiringByTimeBucket.expires_within_7d).toBe(50);
      expect(summary.expiringByTimeBucket.expires_within_30d).toBe(75);
      expect(summary.expiringByTimeBucket.no_expiry).toBe(200);
    });
  });

  describe('reporting', () => {
    it('printReport contains summary + entries + ledger flow', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 100, reason: 'r' });
      svc.applyCreditToCharge({ accountId: 'a', subscriptionId: 's', amountDue: 30 });
      const report: CreditReport = svc.printReport('a');
      expect(report.accountId).toBe('a');
      expect(report.summary.totalIssued).toBe(100);
      expect(report.summary.totalApplied).toBe(30);
      expect(report.ledgerFlow.issued).toBe(100);
      expect(report.ledgerFlow.applied).toBe(30);
      expect(report.entries.length).toBe(2);
      expect(report.entries.map((e) => e.kind).sort()).toEqual(['apply', 'issue']);
    });

    it('exportReport csv contains sections', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 100, reason: 'r' });
      const w = svc.createWallet({
        accountId: 'a',
        subscriptionId: 'sub',
        currency: 'USD',
      });
      svc.deposit({ walletId: w.id, accountId: 'a', amount: 50 });
      const csv = svc.exportReport('a', 'csv');
      expect(csv).toContain('# Credit Report');
      expect(csv).toContain('section,entries');
      expect(csv).toContain('section,wallets');
      expect(csv).toContain('section,wallet_transactions');
      expect(csv).toContain('deposit');
    });

    it('exportReport json serialises the report structure', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 100, reason: 'r' });
      const json = svc.exportReport('a', 'json');
      const parsed = JSON.parse(json);
      expect(parsed.summary.totalIssued).toBe(100);
      expect(parsed.ledgerFlow.issued).toBe(100);
      expect(Array.isArray(parsed.entries)).toBe(true);
    });

    it('creditReportToCsv escapes commas in reasons', () => {
      const report: CreditReport = {
        generatedAt: BASE,
        accountId: 'with,comma',
        summary: {
          accountId: 'with,comma',
          balance: 0,
          availableBalance: 0,
          totalIssued: 0,
          totalApplied: 0,
          totalTransferredIn: 0,
          totalTransferredOut: 0,
          totalExpired: 0,
          expiringByTimeBucket: {
            expires_within_7d: 0,
            expires_within_30d: 0,
            no_expiry: 0,
          },
          averageConsumptionDays: 0,
        },
        entries: [
          {
            id: 1,
            kind: 'issue',
            amount: 10,
            timestamp: BASE,
            reason: 'has,comma',
          },
        ],
        wallets: [],
        transactions: [],
        ledgerFlow: { issued: 10, applied: 0, expired: 0 },
      };
      const csv = creditReportToCsv(report);
      expect(csv).toContain('"with,comma"');
      expect(csv).toContain('"has,comma"');
    });
  });

  describe('audit trail', () => {
    it('getAuditTrail filters by kind and time', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 100, reason: 'r' });
      clockVal = BASE + ONE_DAY;
      svc.applyCreditToCharge({ accountId: 'a', subscriptionId: 's', amountDue: 50 });
      clockVal = BASE + 2 * ONE_DAY;
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 30, reason: 'r' });

      const page = svc.getAuditTrail({
        accountId: 'a',
        kinds: ['issue'],
        limit: 10,
      });
      expect(page.entries.every((e) => e.kind === 'issue')).toBe(true);
      expect(page.totalEntries).toBe(2);
      expect(page.hasMore).toBe(false);

      const timeFilter = svc.getAuditTrail({
        accountId: 'a',
        fromTime: BASE + ONE_DAY + 1,
        limit: 10,
      });
      // oldest issue at BASE is excluded
      expect(timeFilter.entries.length).toBe(1);
      expect(timeFilter.entries[0].kind).toBe('issue');
    });

    it('getAuditTrail paginates with limit + offset', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      for (let i = 0; i < 5; i += 1) {
        svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 10, reason: 'r' });
        clockVal += ONE_DAY;
      }
      const page1 = svc.getAuditTrail({ accountId: 'a', limit: 2, offset: 0 });
      const page2 = svc.getAuditTrail({ accountId: 'a', limit: 2, offset: 2 });
      const page3 = svc.getAuditTrail({ accountId: 'a', limit: 2, offset: 4 });
      expect(page1.entries).toHaveLength(2);
      expect(page2.entries).toHaveLength(2);
      expect(page3.entries).toHaveLength(1);
      expect(page1.hasMore).toBe(true);
      expect(page2.hasMore).toBe(true);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextOffset).toBeNull();
      // newest first
      expect(page1.entries[0].timestamp).toBeGreaterThan(page1.entries[1].timestamp);
      expect(page2.entries[0].timestamp).toBeGreaterThan(page3.entries[0].timestamp);
    });

    it('clamps negative offset / zero limit to safe defaults', () => {
      const svc = makeService();
      svc.issueCredit({ accountId: 'a', actor: 'admin', amount: 10, reason: 'r' });
      const page = svc.getAuditTrail({ accountId: 'a', offset: -50, limit: 0 });
      expect(page.entries.length).toBe(1);
    });

    it('audit trail does not leak synthetic entries on reads (no commit needed)', () => {
      let clockVal = BASE;
      const svc = new CreditService({ clock: () => clockVal });
      svc.issueCredit({
        accountId: 'a',
        actor: 'admin',
        amount: 100,
        reason: 'p',
        expiresAt: BASE + 50,
      });
      // Past the expiry but never called expireAccount(). Audit trail MUST NOT
      // contain the synthetic expire entry that read-only projections used to
      // synthesise.
      clockVal = BASE + 5_000;
      const page = svc.getAuditTrail({ accountId: 'a', kinds: ['expire'], limit: 10 });
      expect(page.entries).toHaveLength(0);
      expect(page.totalEntries).toBe(0);

      // After explicit commit, the expire entry is real and shows up.
      const expired = svc.expireAccount('a');
      expect(expired.expiredAmount).toBe(100);
      const pageAfter = svc.getAuditTrail({ accountId: 'a', kinds: ['expire'], limit: 10 });
      expect(pageAfter.entries).toHaveLength(1);
      expect(pageAfter.entries[0].kind).toBe('expire');
    });
  });
});
