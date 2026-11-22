export { MeteringService, meteringService } from './meteringService';
export type { UsageMetric, UsageIngestResult, UsageIngestStatus } from './meteringService';
export { TieredPricingCalculator, buildSimpleTiers } from './tieredPricingCalculator';
export { handleUsageIngestion } from './usageIngestionApi';
export type { UsageEventPayload, UsageIngestResponse } from './usageIngestionApi';
export { UsageBillingCloseCron, usageBillingCloseCron } from './usageBillingCloseCron';
export type { UsageBillingCloseReport, UsageBillingCloseEntry, MeterAccount } from './usageBillingCloseCron';
export { AlignmentService, alignmentService } from './alignmentService';
export type { AlignmentConfirmation } from './alignmentService';
export { ConsolidationEngine, consolidationEngine } from './consolidationEngine';
export { PricingService } from './pricingService';
export type { PriceRecommendation, ABTestScenario, PricingContext } from './pricingService';
export { TaxService } from './taxService';
export type {
  TaxType,
  TaxJurisdiction,
  TaxRateEntry,
  TaxRateChangeEvent,
  CustomerTaxStatus,
  TaxRemittanceLineItem,
  TaxRemittanceReport,
  TaxCalculationResult,
  TaxInvoiceContext,
  NexusReport,
  MidCycleTaxChange,
  DigitalGoodsClass,
  DigitalGoodsTaxRule,
  TaxRemittanceReportRequest,
} from './taxTypes';
export { DunningService, dunningService } from './dunningService';
export type { FailureType, RetryScheduleConfig, RetryAnalytics, RetryHistoryRecord } from './dunningService';
export {
  calculateExactProration,
  calculateNetProration as calculateNetProrationAdjustment,
  prorationEngine,
  ProrationValidationError as ExactProrationValidationError,
} from './prorationEngine';
export type {
  ExactProrationInput,
  ExactProrationResult,
  ProrationPrecision,
} from './prorationEngine';
export { ProrationService, prorationService } from './proration';
export type {
  ProrationConfiguration,
  ProrationAnalytics,
  ProrationDispute,
  MidCycleChangeRequest,
} from './proration';
export { streamExport, reconcile } from './accountingExportService';
export type {
  AccountingFormat,
  TransactionType,
  TransactionRecord,
  ExportFilter,
  StreamExportOptions,
  ReconciliationResult,
} from './accountingExportService';
export {
  BackendPartnerService,
} from './partnerService';
export type { SplitConfiguration, PartnerPayoutSchedule } from '../../../src/types/partner';

// Credit system — see creditService.ts for architectural notes.
export { CreditService, creditService, creditReportToCsv } from './creditService';
export type {
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
  LowBalanceAlert,
} from './creditTypes';
export type {
  IMeteringService,
  IPricingService,
  ITaxService,
  IDunningService,
  IAccountingExportService,
  IPartnerService,
  ICreditService,
} from './interfaces';
export { BillingError, BillingErrorCode } from './errors';

// Strategy Pattern Pricing exports (Issue #741)
export { PricingStrategy, PricingContext as PricingStrategyContext, PricingResult, PricingAnalytics } from './pricingStrategy';
export { FlatRateStrategy } from './flatRateStrategy';
export { UsageBasedStrategy } from './usageBasedStrategy';
export { TieredPricingStrategy } from './tieredStrategy';
export { DynamicPricingStrategy } from './dynamicStrategy';
export { PricingStrategyFactory, PlanType } from './strategyFactory';
export { BillingEngine, BillingEngineConfig } from './billingEngine';
export { PricingAnalyticsService, RevenueMetrics } from './billingAnalytics';


// Subscriber loyalty points and rewards (issue #2196)
export { LoyaltyService, loyaltyService } from './loyaltyService';
export { LoyaltyController, loyaltyController } from './loyaltyController';
export { createLoyaltyRouter } from './loyaltyRouter';
export type {
  LoyaltyPointsRule,
  LoyaltyAnalyticsData,
  LoyaltyNotification,
  LoyaltyApiResponse,
} from './loyaltyService';
export type {
  LoyaltyBalance,
  LoyaltyLedgerEvent,
  LoyaltyMutationResult,
  LoyaltyRewardDefinition,
  LoyaltyTierDefinition,
  LoyaltyTierId,
} from './loyaltyRewards';

// Trial Management exports (Issue #958 and optimization work for #2192)
export { TrialManagementService, trialManagementService, DEFAULT_TRIAL_POLICY } from './trialManagementService';
export {
  TrialOptimizationService,
  trialOptimizationService,
} from './trialOptimizationService';
export type {
  TrialOptimizationAction,
  TrialOptimizationRecommendation,
  TrialExpirationWorkflowReport,
} from './trialOptimizationService';
export {
  TrialOptimizationController,
  createTrialOptimizationRouter,
} from './trialOptimizationRouter';
export type { TrialPolicy, TrialSubscriptionRecord, ConversionIncentive, TrialReminderItem, TrialConversionFunnel, UserActivitySignals, PropensityCategory } from './trialManagementService';

// Multi-Entity Billing exports (Issue #562)
export { EntityBillingService, entityBillingService, EntityBillingError } from './entityBilling';
export type {
  EntityBillingConfig,
  EntityCharge,
  EntityInvoiceLineItem,
  EntityInvoice,
  EntityHierarchyNode,
  ConsolidatedBillingSummary,
} from './entityBilling';
