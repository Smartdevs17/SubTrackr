import {
  PaymentRecord,
  BankStatementRecord,
  ReconciliationMatch,
  ReconciliationSchedule,
  ReconciliationSummary,
  DiscrepancyReason,
} from '../types/reconciliation';
import { Subscription } from '../types/subscription';

export class ReconciliationService {
  private static matches: ReconciliationMatch[] = [];
  private static schedule: ReconciliationSchedule = {
    id: 'sched-default',
    frequency: 'daily',
    isEnabled: true,
    lastRunAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + 86400000).toISOString(),
    autoResolveMinorDiscrepancies: true,
    minorDiscrepancyThreshold: 1.0,
  };

  /**
   * Perform automated payment matching against bank/chain statement records
   */
  public static runAutomatedReconciliation(
    subscriptions: Subscription[],
    bankStatements?: BankStatementRecord[]
  ): ReconciliationSummary {
    const now = new Date();
    const generatedPaymentRecords: PaymentRecord[] = subscriptions.map((sub) => ({
      id: `pay-${sub.id}`,
      subscriptionId: sub.id,
      amount: sub.price,
      currency: sub.currency,
      paymentMethod: sub.isCryptoEnabled ? 'Soroban/Superfluid' : 'Credit Card',
      timestamp: sub.updatedAt || now.toISOString(),
    }));

    const mockStatements: BankStatementRecord[] = bankStatements || subscriptions.map((sub, idx) => {
      // Simulate minor fee deduction or discrepancy on odd index
      const fee = idx % 3 === 0 ? 0.5 : 0;
      const discrepancy = idx % 5 === 0 ? 2.0 : 0;
      return {
        id: `stmt-${sub.id}`,
        statementId: `STMT-2026-${idx + 100}`,
        amount: sub.price - fee - discrepancy,
        currency: sub.currency,
        fees: fee,
        reference: sub.id,
        timestamp: now.toISOString(),
      };
    });

    const newMatches: ReconciliationMatch[] = [];

    generatedPaymentRecords.forEach((pay) => {
      const statement = mockStatements.find((s) => s.reference === pay.subscriptionId);

      if (!statement) {
        newMatches.push({
          id: `match-${pay.id}`,
          paymentRecordId: pay.id,
          subscriptionId: pay.subscriptionId,
          status: 'unmatched',
          discrepancyAmount: pay.amount,
          discrepancyReason: 'missing_bank_record',
          createdAt: now.toISOString(),
        });
        return;
      }

      const diff = Math.abs(pay.amount - (statement.amount + statement.fees));

      if (diff === 0) {
        newMatches.push({
          id: `match-${pay.id}`,
          paymentRecordId: pay.id,
          statementRecordId: statement.id,
          subscriptionId: pay.subscriptionId,
          status: 'matched',
          discrepancyAmount: 0,
          createdAt: now.toISOString(),
        });
      } else if (
        this.schedule.autoResolveMinorDiscrepancies &&
        diff <= this.schedule.minorDiscrepancyThreshold
      ) {
        newMatches.push({
          id: `match-${pay.id}`,
          paymentRecordId: pay.id,
          statementRecordId: statement.id,
          subscriptionId: pay.subscriptionId,
          status: 'matched',
          discrepancyAmount: diff,
          discrepancyReason: 'fee_deduction',
          resolutionNotes: 'Auto-resolved minor fee discrepancy',
          resolvedAt: now.toISOString(),
          createdAt: now.toISOString(),
        });
      } else {
        newMatches.push({
          id: `match-${pay.id}`,
          paymentRecordId: pay.id,
          statementRecordId: statement.id,
          subscriptionId: pay.subscriptionId,
          status: 'exception',
          discrepancyAmount: diff,
          discrepancyReason: 'amount_mismatch',
          createdAt: now.toISOString(),
        });
      }
    });

    this.matches = newMatches;
    this.schedule.lastRunAt = now.toISOString();

    return this.getSummary();
  }

  /**
   * Resolve an exception manually with resolution notes
   */
  public static resolveException(
    matchId: string,
    reason: DiscrepancyReason,
    notes: string
  ): ReconciliationMatch | undefined {
    const match = this.matches.find((m) => m.id === matchId);
    if (match) {
      match.status = 'matched';
      match.discrepancyReason = reason;
      match.resolutionNotes = notes;
      match.resolvedAt = new Date().toISOString();
      return match;
    }
    return undefined;
  }

  /**
   * Update reconciliation scheduling configuration
   */
  public static updateSchedule(
    config: Partial<ReconciliationSchedule>
  ): ReconciliationSchedule {
    this.schedule = { ...this.schedule, ...config };
    return this.schedule;
  }

  public static getSchedule(): ReconciliationSchedule {
    return this.schedule;
  }

  public static getMatches(): ReconciliationMatch[] {
    return this.matches;
  }

  /**
   * Generate analytics summary
   */
  public static getSummary(): ReconciliationSummary {
    const totalProcessed = this.matches.length;
    const matchedCount = this.matches.filter((m) => m.status === 'matched').length;
    const unmatchedCount = this.matches.filter((m) => m.status === 'unmatched').length;
    const exceptionCount = this.matches.filter((m) => m.status === 'exception').length;

    const matchRatePercentage =
      totalProcessed > 0 ? Math.round((matchedCount / totalProcessed) * 100) : 100;
    const totalDiscrepancyVolume = this.matches.reduce(
      (acc, m) => acc + (m.discrepancyAmount || 0),
      0
    );

    return {
      totalProcessed,
      matchedCount,
      unmatchedCount,
      exceptionCount,
      matchRatePercentage,
      totalDiscrepancyVolume: Number(totalDiscrepancyVolume.toFixed(2)),
      lastReconciledAt: this.schedule.lastRunAt || new Date().toISOString(),
    };
  }

  /**
   * Generate report payload for export
   */
  public static generateReport(format: 'json' | 'csv' = 'json'): string {
    const summary = this.getSummary();

    if (format === 'csv') {
      const headers =
        'Match ID,Payment ID,Statement ID,Subscription ID,Status,Discrepancy,Reason,Notes\n';
      const rows = this.matches
        .map(
          (m) =>
            `"${m.id}","${m.paymentRecordId}","${m.statementRecordId || ''}","${m.subscriptionId}","${m.status}","${m.discrepancyAmount}","${m.discrepancyReason || ''}","${m.resolutionNotes || ''}"`
        )
        .join('\n');
      return headers + rows;
    }

    return JSON.stringify({ summary, schedule: this.schedule, matches: this.matches }, null, 2);
  }
}
