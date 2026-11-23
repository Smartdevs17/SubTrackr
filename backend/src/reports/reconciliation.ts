import type { BillingProvider } from '../gateways/billingAdapter';
import { logger } from '../utils/logger';

export type ReconciliationStatus =
  | 'matched'
  | 'ledger_only'
  | 'provider_only'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'status_mismatch'
  | 'duplicate';

export interface LedgerChargeRecord {
  chargeId: string;
  provider: BillingProvider;
  providerChargeId?: string;
  referenceId?: string;
  amountMinor: number;
  currency: string;
  status?: string;
}

export interface ProviderChargeRecord {
  provider: BillingProvider;
  providerChargeId: string;
  referenceId?: string;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface ChargeReconciliationProviderSource {
  provider: BillingProvider;
  listCharges(startInclusive: string, endExclusive: string): Promise<ProviderChargeRecord[]>;
}

export interface ReconciliationWindow {
  startInclusive: string;
  endExclusive: string;
}

export interface ReconciliationIssue {
  status: ReconciliationStatus;
  chargeId?: string;
  providerChargeId?: string;
  provider: BillingProvider;
  ledger?: LedgerChargeRecord;
  providerRecord?: ProviderChargeRecord;
  differences?: string[];
}

export interface ChargeReconciliationReport {
  window: ReconciliationWindow;
  generatedAt: string;
  totals: {
    ledger: number;
    provider: number;
    matched: number;
    ledgerOnly: number;
    providerOnly: number;
    mismatched: number;
    duplicates: number;
  };
  issues: ReconciliationIssue[];
  providerErrors: Array<{ provider: BillingProvider; message: string }>;
}

export interface ReconciliationMetrics {
  recordReport(report: ChargeReconciliationReport): void;
}

export interface ReconciliationOptions {
  metrics?: ReconciliationMetrics;
  now?: () => number;
}

export const noopReconciliationMetrics: ReconciliationMetrics = {
  recordReport: () => undefined,
};

export class StructuredReconciliationMetrics implements ReconciliationMetrics {
  private readonly reports: ChargeReconciliationReport[] = [];

  recordReport(report: ChargeReconciliationReport): void {
    this.reports.push(report);
  }

  getReports(): readonly ChargeReconciliationReport[] {
    return [...this.reports];
  }
}

function normalizedStatus(status: string | undefined): string | undefined {
  if (status === undefined) return undefined;
  const normalized = status.trim().toLowerCase();
  return normalized === '' ? undefined : normalized;
}

function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

function validateRecord(record: LedgerChargeRecord | ProviderChargeRecord): void {
  if (!record.provider || !Number.isFinite(record.amountMinor) || record.amountMinor < 0) {
    throw new Error('Invalid reconciliation charge record');
  }
  if (!/^[A-Z]{3}$/.test(normalizeCurrency(record.currency))) {
    throw new Error('Invalid reconciliation currency');
  }
}

function providerKey(record: ProviderChargeRecord): string {
  return `${record.provider}:${record.providerChargeId}`;
}

function ledgerKey(record: LedgerChargeRecord): string {
  if (record.providerChargeId) return `${record.provider}:${record.providerChargeId}`;
  if (record.referenceId) return `${record.provider}:${record.referenceId}`;
  return `${record.provider}:${record.chargeId}`;
}

export class ChargeReconciliationService {
  private readonly metrics: ReconciliationMetrics;
  private readonly now: () => number;

  constructor(options: ReconciliationOptions = {}) {
    this.metrics = options.metrics ?? noopReconciliationMetrics;
    this.now = options.now ?? Date.now;
  }

  async reconcile(
    ledger: readonly LedgerChargeRecord[],
    sources: readonly ChargeReconciliationProviderSource[],
    window: ReconciliationWindow,
  ): Promise<ChargeReconciliationReport> {
    const issues: ReconciliationIssue[] = [];
    const providerErrors: ChargeReconciliationReport['providerErrors'] = [];

    for (const record of ledger) validateRecord(record);

    const providerRecords: ProviderChargeRecord[] = [];
    for (const source of sources) {
      try {
        const records = await source.listCharges(window.startInclusive, window.endExclusive);
        for (const record of records) {
          validateRecord(record);
          providerRecords.push({ ...record, provider: source.provider });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown provider error';
        providerErrors.push({ provider: source.provider, message });
        logger.error('reconciliation.provider_fetch_failed', {
          provider: source.provider,
          startInclusive: window.startInclusive,
          endExclusive: window.endExclusive,
        });
      }
    }

    const providersSeen = new Set(sources.map((source) => source.provider));
    const ledgerFiltered = ledger.filter((record) => providersSeen.has(record.provider));

    const providerByKey = new Map<string, ProviderChargeRecord[]>();
    for (const record of providerRecords) {
      const key = providerKey(record);
      providerByKey.set(key, [...(providerByKey.get(key) ?? []), record]);
    }

    const ledgerByKey = new Map<string, LedgerChargeRecord[]>();
    for (const record of ledgerFiltered) {
      const key = ledgerKey(record);
      ledgerByKey.set(key, [...(ledgerByKey.get(key) ?? []), record]);
    }

    const matchedProviderKeys = new Set<string>();
    let duplicates = 0;
    let mismatched = 0;

    for (const [key, ledgerMatches] of ledgerByKey) {
      const ledgerRecord = ledgerMatches[0]!;
      let providerMatches = providerByKey.get(key);

      if (!providerMatches?.length && ledgerRecord.referenceId) {
        providerMatches = providerRecords.filter(
          (record) =>
            record.provider === ledgerRecord.provider &&
            record.referenceId === ledgerRecord.referenceId,
        );
      }

      if (!providerMatches?.length) {
        for (const ledgerRecord of ledgerMatches) {
          issues.push({
            status: 'ledger_only',
            chargeId: ledgerRecord.chargeId,
            providerChargeId: ledgerRecord.providerChargeId,
            provider: ledgerRecord.provider,
            ledger: ledgerRecord,
          });
        }
        continue;
      }

      for (const providerRecord of providerMatches) {
        matchedProviderKeys.add(providerKey(providerRecord));
      }
      if (providerMatches.length > 1 || ledgerMatches.length > 1) {
        duplicates++;
        issues.push({
          status: 'duplicate',
          chargeId: ledgerMatches[0]?.chargeId,
          providerChargeId: providerMatches[0]?.providerChargeId,
          provider: ledgerMatches[0]?.provider ?? providerMatches[0]!.provider,
          ledger: ledgerMatches[0],
          providerRecord: providerMatches[0],
        });
      }

      for (const ledgerRecord of ledgerMatches) {
        const providerRecord = providerMatches[0]!;
        const differences: string[] = [];
        if (ledgerRecord.amountMinor !== providerRecord.amountMinor) differences.push('amount');
        if (normalizeCurrency(ledgerRecord.currency) !== normalizeCurrency(providerRecord.currency)) {
          differences.push('currency');
        }
        const ledgerStatus = normalizedStatus(ledgerRecord.status);
        const providerStatus = normalizedStatus(providerRecord.status);
        if (ledgerStatus && providerStatus && ledgerStatus !== providerStatus) {
          differences.push('status');
        }

        if (differences.length === 0) {
          issues.push({
            status: 'matched',
            chargeId: ledgerRecord.chargeId,
            providerChargeId: providerRecord.providerChargeId,
            provider: ledgerRecord.provider,
            ledger: ledgerRecord,
            providerRecord,
          });
        } else {
          mismatched++;
          const status: ReconciliationStatus = differences.includes('amount')
            ? 'amount_mismatch'
            : differences.includes('currency')
              ? 'currency_mismatch'
              : 'status_mismatch';
          issues.push({
            status,
            chargeId: ledgerRecord.chargeId,
            providerChargeId: providerRecord.providerChargeId,
            provider: ledgerRecord.provider,
            ledger: ledgerRecord,
            providerRecord,
            differences,
          });
        }
      }
    }

    for (const [providerKeyValue, providerMatches] of providerByKey) {
      if (matchedProviderKeys.has(providerKeyValue)) continue;
      for (const providerRecord of providerMatches) {
        issues.push({
          status: 'provider_only',
          providerChargeId: providerRecord.providerChargeId,
          provider: providerRecord.provider,
          providerRecord,
        });
      }
    }

    const matched = issues.filter((issue) => issue.status === 'matched').length;
    const ledgerOnly = issues.filter((issue) => issue.status === 'ledger_only').length;
    const providerOnly = issues.filter((issue) => issue.status === 'provider_only').length;

    const report: ChargeReconciliationReport = {
      window,
      generatedAt: new Date(this.now()).toISOString(),
      totals: {
        ledger: ledgerFiltered.length,
        provider: providerRecords.length,
        matched,
        ledgerOnly,
        providerOnly,
        mismatched,
        duplicates,
      },
      issues,
      providerErrors,
    };

    this.metrics.recordReport(report);
    logger.info('reconciliation.report_generated', {
      matched: report.totals.matched,
      mismatched: report.totals.mismatched,
      ledgerOnly: report.totals.ledgerOnly,
      providerOnly: report.totals.providerOnly,
      providerErrors: report.providerErrors.length,
      windowStart: window.startInclusive,
      windowEnd: window.endExclusive,
    });

    return report;
  }
}

export async function reconcileCharges(
  ledger: readonly LedgerChargeRecord[],
  sources: readonly ChargeReconciliationProviderSource[],
  window: ReconciliationWindow,
  options: ReconciliationOptions = {},
): Promise<ChargeReconciliationReport> {
  return new ChargeReconciliationService(options).reconcile(ledger, sources, window);
}
