import { UsageMetric, UsageIngestResult } from './meteringService';
import { AggregationFunction, AggregationWindow, UsageThresholdAlert } from '../../../src/types/usage';
import { PriceRecommendation, ABTestScenario, PricingContext } from './pricingService';
import type {
  PlanTemplate,
  PlanTemplateDraft,
  ResolvedPlan,
  TemplateAnalytics,
  TemplateFilter,
  TemplateLibraryAnalytics,
  TemplateOverrides,
  TemplateQuote,
} from '../../../src/types/planTemplate';
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
  FailureReason,
  DunningCommunicationTemplate,
  RetryStrategy
} from '../../../src/types/dunning';
import {
  TransactionRecord,
  StreamExportOptions,
  ReconciliationResult,
  TransactionType,
  ExportSchedule,
  ExportScheduleInput,
  ExportHistoryEntry,
  ExportAnalytics,
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
  getUsageByMetric(subscriptionId: string): Record<string, number>;
  getUsageHistory(subscriptionId?: string, metric?: string): Array<{
    subscriptionId: string;
    metric: string;
    value: number;
    timestamp: Date;
  }>;
  getUsageTrends(subscriptionId: string): Array<{
    metric: string;
    currentPeriod: number;
    previousPeriod: number;
    changePercent: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  }>;
  getAnalytics(subscriptionId?: string): {
    totalUsage: number;
    usageByMetric: Record<string, number>;
    usageBySubscription: Record<string, number>;
    usageHistory: Array<{
      subscriptionId: string;
      metric: string;
      value: number;
      timestamp: Date;
    }>;
    trends: Array<{
      metric: string;
      currentPeriod: number;
      previousPeriod: number;
      changePercent: number;
      trend: 'increasing' | 'decreasing' | 'stable';
    }>;
    alertsCount: number;
    alerts: Array<{
      id: string;
      subscriptionId: string;
      metric: string;
      threshold: number;
      currentUsage: number;
      message: string;
      createdAt: Date;
      acknowledged: boolean;
    }>;
  };
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
  configureABTest(planId: string, enabled: boolean, variants: Array<{ id: string; weight: number; strategy: RetryStrategy }>): void;
  getConfiguration(planId: string): DunningConfiguration | undefined;
  getStrategy(planId: string, failureReason: FailureReason, abTestVariant?: string): RetryStrategy;
  startDunning(
    subscriptionId: string,
    subscriberId: string,
    merchantId: string,
    planId: string,
    failureReason?: FailureReason
  ): DunningEntry;
  recordFailedCharge(subscriptionId: string, failureType?: string): DunningEntry | null;
  recordSuccessfulCharge(subscriptionId: string): DunningEntry | null;
  getDunningEntry(subscriptionId: string): DunningEntry | undefined;
  listActiveDunning(merchantId?: string): DunningEntry[];
  listRecoveredDunning(merchantId?: string): DunningEntry[];
  pauseDunning(subscriptionId: string): DunningEntry | null;
  resumeDunning(subscriptionId: string): DunningEntry | null;
  overrideStage(subscriptionId: string, stage: DunningStage): DunningEntry | null;
  getCommunications(subscriptionId: string): DunningCommunication[];
  getAnalytics(merchantId?: string): DunningAnalytics;
  getProcessableEntries(): DunningEntry[];
  configureRetrySchedule(schedule: {
    failureType: string;
    baseDelayHours?: number;
    maxRetries?: number;
    backoffMultiplier?: number;
    maxDelayHours?: number;
    backoffPolicy?: string;
    jitterRatio?: number;
    retryable?: boolean;
  }): void;
  getRetrySchedule(failureType: string): {
    failureType: string;
    baseDelayHours: number;
    maxRetries: number;
    backoffMultiplier: number;
    maxDelayHours: number;
    backoffPolicy: string;
    jitterRatio: number;
    retryable: boolean;
  };
  calculateRetryDelay(failureType: string, attempt: number): number;
  getRetryAnalytics(merchantId?: string): {
    totalRetries: number;
    successfulRetries: number;
    failedRetries: number;
    retryRate: number;
    successRate: number;
    averageRetriesBeforeSuccess: number;
    retriesByFailureType: Record<string, number>;
    retriesByStage: Record<string, number>;
    averageTimeToRecovery: number;
  };
}

export interface IAccountingExportService {
  streamExport(records: TransactionRecord[], options: StreamExportOptions): { totalRecords: number; checksum: string };
  reconcile(
    exported: TransactionRecord[],
    expected: Array<{ id: string; amount: number; transactionType: TransactionType }>
  ): ReconciliationResult;
  createExportSchedule(input: ExportScheduleInput): ExportSchedule;
  getExportSchedules(merchantId?: string): ExportSchedule[];
  updateExportSchedule(id: string, patch: Partial<Omit<ExportSchedule, 'id' | 'createdAt'>>): ExportSchedule | null;
  deleteExportSchedule(id: string): boolean;
  toggleExportSchedule(id: string, enabled: boolean): ExportSchedule | null;
  runDueExports(
    records: TransactionRecord[],
    now?: number
  ): Array<{ schedule: ExportSchedule; result: { totalRecords: number; checksum: string } }>;
  recordExportDownload(exportId: string): ExportHistoryEntry | null;
  getExportHistory(merchantId?: string): ExportHistoryEntry[];
  getExportAnalytics(merchantId?: string): ExportAnalytics;
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

export interface IPlanTemplateService {
  createTemplate(ownerId: string, draft: PlanTemplateDraft): Promise<PlanTemplate>;
  getTemplate(id: string): Promise<PlanTemplate | null>;
  listTemplates(filter?: TemplateFilter): Promise<PlanTemplate[]>;
  listAvailableTemplates(callerId: string): Promise<PlanTemplate[]>;
  publishVersion(
    ownerId: string,
    templateId: string,
    draft: PlanTemplateDraft
  ): Promise<PlanTemplate>;
  listVersions(rootId: string): Promise<PlanTemplate[]>;
  getLatestVersion(rootId: string): Promise<PlanTemplate | null>;
  setShared(ownerId: string, templateId: string, shared: boolean): Promise<PlanTemplate>;
  instantiate(
    callerId: string,
    templateId: string,
    overrides?: TemplateOverrides
  ): Promise<ResolvedPlan>;
  quote(templateId: string, units: number): Promise<TemplateQuote>;
  getAnalytics(templateId: string): Promise<TemplateAnalytics>;
  recordView(templateId: string): Promise<TemplateAnalytics>;
  recordPlanCreated(templateId: string): Promise<TemplateAnalytics>;
  recordSubscription(templateId: string, revenue?: number): Promise<TemplateAnalytics>;
  getLibraryAnalytics(filter?: TemplateFilter): Promise<TemplateLibraryAnalytics>;
}
