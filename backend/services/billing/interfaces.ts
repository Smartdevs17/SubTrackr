import { UsageMetric } from './meteringService';
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

export interface IMeteringService {
  recordUsage(metric: UsageMetric): Promise<void>;
  checkThresholds(userId: string): Promise<void>;
  calculateOverage(userId: string): Promise<number>;
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
