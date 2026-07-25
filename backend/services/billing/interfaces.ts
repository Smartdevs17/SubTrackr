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
import { SplitConfiguration, PartnerPayoutSchedule } from '../../../src/types/partner';

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

export interface IGroupBillingService {
  generateBillingSummary(group: any): any;
  aggregateCharges(group: any, periodDays?: number): any[];
  generateInvoice(group: any, periodStart: number, periodEnd: number, currency?: string): any;
  issueInvoice(invoiceId: string, groupId: string): any | null;
  markInvoicePaid(invoiceId: string, groupId: string): any | null;
  getGroupInvoices(groupId: string): any[];
  calculateGroupAnalytics(group: any): any;
  recordAdminAction(groupId: string, action: string, actorAddress: string, targetAddress?: string, metadata?: Record<string, unknown>): any;
  getAdminActions(groupId: string, limit?: number): any[];
  canPerformAction(group: any, actorAddress: string, action: string): { allowed: boolean; reason?: string };
  customizeGroupPlan(groupId: string, customization: any): any;
  getGroupPlanCustomization(groupId: string): any | undefined;
  overrideMemberBalance(group: any, memberAddress: string, newBalance: number, actorAddress: string): any | null;
}

export interface ILoyaltyService {
  addPointsRule(rule: any): any;
  updatePointsRule(id: string, updates: any): any | null;
  removePointsRule(id: string): void;
  getPointsRules(trigger?: string): any[];
  calculatePoints(trigger: string, context?: any): { points: number; ruleId: string } | null;
  recordPointsEvent(subscriberId: string, points: number, type: 'earn' | 'redeem' | 'expire', trigger: string): void;
  getPointsHistory(subscriberId: string, limit?: number): any[];
  getLoyaltyAnalytics(allSubscribers: any[]): any;
  createNotification(type: string, subscriberId: string, title: string, body: string, data?: Record<string, unknown>): any;
  getNotifications(subscriberId: string, unreadOnly?: boolean): any[];
  markNotificationRead(notificationId: string): void;
  markAllNotificationsRead(subscriberId: string): void;
  getUnreadCount(subscriberId: string): number;
  createApiResponse<T>(data: T): any;
  createErrorResponse(error: string): any;
}
