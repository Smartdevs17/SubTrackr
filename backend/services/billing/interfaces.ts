import { UsageMetric, UsageIngestResult } from './meteringService';
import { AggregationFunction, AggregationWindow, UsageThresholdAlert } from '../../../src/types/usage';
import { PriceRecommendation, ABTestScenario, PricingContext } from './pricingService';
import {
  TaxCalculationResult,
  TaxInvoiceContext,
  TaxRemittanceReport,
  TaxRemittanceReportRequest,
  NexusReport,
} from './taxService';
import {
  DunningEntry,
  DunningConfiguration,
  DunningStage,
  DunningCommunication,
  DunningAnalytics,
} from '../../../src/types/dunning';
import {
  TransactionRecord,
  StreamExportOptions,
  ReconciliationResult,
  TransactionType,
} from './accountingExportService';
import { SplitConfiguration } from '../../../src/types/partner';
import type {
  AccountCreditSummary,
  ApplyCreditInput,
  ApplyCreditResult,
  CreditAccount,
  CreditAuditPage,
  CreditAuditQuery,
  CreditBucketBreakdown,
  CreditExpiryForecast,
  CreditReport,
  CreditUsageTrendPoint,
  ExpirationPolicy,
  IssueCreditInput,
  PrepaymentTransaction,
  PrepaymentWallet,
  TopAccount,
  TransferCreditInput,
} from './creditTypes';

export interface IMeteringService {
  recordUsage(metric: UsageMetric): Promise<UsageIngestResult>;
  recordUsageBatch(metrics: UsageMetric[]): Promise<UsageIngestResult[]>;
  aggregate(
    userId: string,
    metricType: string,
    window: AggregationWindow,
    fn?: AggregationFunction
  ): number;
  checkThresholds(userId: string, metricType: string): Promise<UsageThresholdAlert | null>;
  calculateOverage(userId: string, metricType?: string): Promise<number>;
}

export interface IPricingService {
  calculateOptimalPrice(subscriptionId: string, context: PricingContext): Promise<PriceRecommendation>;
  getPriceRecommendations(planId: string): Promise<ABTestScenario[]>;
  getCompetitorPrices(market: string): Promise<Record<string, number[]>>;
}

export interface ITaxService {
  calculateTax(context: TaxInvoiceContext): Promise<TaxCalculationResult>;
  generateRemittanceReport(request: TaxRemittanceReportRequest): Promise<TaxRemittanceReport>;
  evaluateNexus(merchantId: string): Promise<NexusReport>;
}

export interface IDunningService {
  configurePlan(planId: string, config: Partial<DunningConfiguration>): DunningConfiguration;
  getConfiguration(planId: string): DunningConfiguration | undefined;
  startDunning(subscriptionId: string, subscriberId: string, merchantId: string, planId: string): DunningEntry;
  recordFailedCharge(subscriptionId: string): DunningEntry | null;
  recordSuccessfulCharge(subscriptionId: string): void;
  getDunningEntry(subscriptionId: string): DunningEntry | undefined;
  listActiveDunning(merchantId?: string): DunningEntry[];
  pauseDunning(subscriptionId: string): DunningEntry | null;
  resumeDunning(subscriptionId: string): DunningEntry | null;
  overrideStage(subscriptionId: string, stage: DunningStage): DunningEntry | null;
  getCommunications(subscriptionId: string): DunningCommunication[];
  getAnalytics(merchantId?: string): DunningAnalytics;
  getProcessableEntries(): DunningEntry[];
}

export interface IAccountingExportService {
  streamExport(records: TransactionRecord[], options: StreamExportOptions): { totalRecords: number; checksum: string };
  reconcile(
    exported: TransactionRecord[],
    expected: Array<{ id: string; amount: number; transactionType: TransactionType }>
  ): ReconciliationResult;
}

export interface IPartnerService {
  executeSplitAtSettlement(input: {
    splitConfiguration: SplitConfiguration;
    transactionId: string;
    grossAmount: number;
  }): SplitExecution;
  shouldSchedulePayout(config: SplitConfiguration, lastPayoutDate: Date | null): {
    shouldProcess: boolean;
    nextScheduledDate: Date;
    reason: string;
  };
  aggregatePendingPayouts(
    configurations: SplitConfiguration[],
    grossAmount: number
  ): Map<string, number>;
}

/**
 * Credit service — the server-side counterpart to the `subtrackr-credit`
 * Soroban contract and the mobile `AccountCredit` store. Operates on a
 * ledger model (lots + signed entries + running balance) so callers downstream
 * of `applyCreditToCharge` only see the net amount due.
 */
export interface ICreditService {
  // Account-level configuration
  setExpirationPolicy(accountId: string, policy: ExpirationPolicy): void;
  getAccount(accountId: string): CreditAccount;
  getBalance(accountId: string): number;

  // Credit lifecycle
  issueCredit(input: IssueCreditInput): CreditAccount;
  applyCreditToCharge(input: ApplyCreditInput): ApplyCreditResult;
  transferCredit(input: TransferCreditInput): { from: CreditAccount; to: CreditAccount };
  expireAccount(accountId: string): { expiredAmount: number; account: CreditAccount };
  expireAll(accounts?: string[]): Array<{ accountId: string; expiredAmount: number }>;

  // Prepayment wallets
  createWallet(input: { accountId: string; subscriptionId: string; currency: string }): PrepaymentWallet;
  deposit(input: { walletId: number; accountId: string; amount: number }): PrepaymentWallet;
  withdraw(input: { walletId: number; accountId: string; amount: number }): PrepaymentWallet;
  drawdown(input: { walletId: number; accountId: string; invoiceId: string; amount: number }): PrepaymentWallet;
  getWallet(walletId: number): PrepaymentWallet | undefined;
  getWalletTransactions(walletId: number): PrepaymentTransaction[];
  listWalletsForAccount(accountId: string): PrepaymentWallet[];

  // Analytics (credit dashboard)
  getAccountSummary(accountId: string): AccountCreditSummary;
  getGlobalBreakdown(): CreditBucketBreakdown;
  getUsageTrend(days?: number, bucketSecs?: number): CreditUsageTrendPoint[];
  getExpiryForecast(accountId: string, horizonSecs?: number): CreditExpiryForecast[];
  topAccountsByBalance(limit?: number): TopAccount[];
  listAccounts(): CreditAccount[];

  // Reporting
  printReport(accountId: string): CreditReport;
  exportReport(accountId: string, format: 'csv' | 'json'): string;

  // Audit trail
  getAuditTrail(query: CreditAuditQuery): CreditAuditPage;
}

// Re-exported from partner types — keeping original code untouched below.
export type { SplitExecution } from '../../../src/types/partner';
