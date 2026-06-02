// ── API Response Envelope (Issue #401) ──────────────────────────────────────
export {
  ok,
  fail,
  fromError,
  buildMeta,
  ERROR_HTTP_STATUS_MAP,
  API_VERSION_HEADER,
  API_VERSION_VALUE,
  REQUEST_ID_HEADER,
} from './apiResponse';
export type {
  ApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiError,
  ErrorCode,
  ResponseMeta,
  PaginationMeta,
} from './apiResponse';

export { AuditService } from './auditService';
export { CampaignService } from './campaignService';
export { DunningService, dunningService } from './dunningService';
export { ExportService, exportService } from './exportService';
export { PricingService } from './pricingService';
export { OracleMonitorService, oracleMonitorService } from './oracleMonitorService';
export { RateLimitingService, rateLimitingService } from './rateLimitingService';
export type {
  AuditAction,
  AuditEvent,
  AuditReport,
  ExportFormat,
  RetentionPolicy,
} from './auditTypes';
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
export {
  WebhookDeliveryService,
  webhookDeliveryService,
  buildWebhookPayload,
  signWebhookPayload,
  verifyWebhookSignature,
  isWebhookEventAllowed,
} from './webhook';
export type { RegisterWebhookInput, WebhookDeliveryResult, WebhookEventInput } from './webhook';
export {
  SubscriptionEventStore,
  subscriptionEventStore,
} from './subscriptionEventStore';
export type {
  SubscriptionEvent,
  SubscriptionEventPage,
  SubscriptionEventQuery,
  SubscriptionEventType,
} from './subscriptionEventStore';



export {
  SubscriptionCacheService,
} from './subscriptionCacheService';

export type {
  RedisClient,
  SubscriptionCacheConfig,
  CacheMetrics,
} from './subscriptionCacheService';
export { BatchChargeService } from './batchChargeService';
export type { BatchChargeCandidate, BatchChargeOptions, BatchChargeResult } from './batchChargeService';

// ── Payment Timeout & Recovery (Issue #427) ─────────────────────────────────
export {
  PaymentTimeoutService,
  paymentTimeoutService,
  DEFAULT_CHAIN_CONFIGS,
} from './paymentTimeoutService';
export type {
  ChainTimeoutConfig,
  PaymentTimeoutRecord,
  RecoveryResult,
  TimeoutHealthSummary,
  TimeoutStatus,
  ChainStatusProvider,
} from './paymentTimeoutService';
export {
  TransactionHealthDashboard,
  transactionHealthDashboard,
} from './transactionHealthDashboard';
export type {
  StuckTransactionEntry,
  TxHealthDashboardSnapshot,
  ChainHealthEntry,
} from './transactionHealthDashboard';

// ── Feature Flags (Issue #TBD) ──────────────────────────────────────────────
export { BackendFeatureFlagsService, backendFeatureFlagsService } from './featureFlags';
export type {
  FeatureFlag,
  FeatureAccessResult,
  FeatureConfig,
  FeatureCheckEvent,
  FeatureFlagAnalytics,
  FeatureAnalyticsReport,
  StaleFlagReport,
  StaleFlagConfig,
  ConfigConflict,
  UserAttributes,
  UserSegment,
  ABTestAssignment,
  FeatureId,
} from '../../src/types/feature';
