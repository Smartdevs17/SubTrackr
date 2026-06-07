// ── Connection pool (#414) ────────────────────────────────────────────────────
export { ConnectionPool, getPool, stellarPool } from './connectionPool';
export type { PoolConfig, PoolMetrics } from './connectionPool';

// ── Repository pattern (#405) ─────────────────────────────────────────────────
export * from './repositories';

// ── API Response Envelope & Infrastructure (Issue #401) ───────────────────────
export {
  ok,
  fail,
  fromError,
  buildMeta,
  ERROR_HTTP_STATUS_MAP,
  API_VERSION_HEADER,
  API_VERSION_VALUE,
  REQUEST_ID_HEADER,
} from './shared/apiResponse';
export type {
  ApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiError,
  ErrorCode,
  ResponseMeta,
  PaginationMeta,
} from './shared/apiResponse';

export { DomainError } from './shared/errors';
export { logger } from './shared/logging';
export type { LogLevel, LogContext } from './shared/logging';
export {
  generateKey,
  generateEncryptionKey,
  isPiiField,
  getPiiFields,
  encryptField,
  decryptField,
  generateBlindIndexToken,
  generateBlindIndexTokens,
  searchBlindIndex,
  maskField,
  maskObject,
  reEncryptField,
} from './shared/encryption';
export type {
  Environment,
  EncryptionKey,
  EncryptedField,
  BlindIndex,
  DecryptedField,
} from './shared/encryption';
export { keyManager, KeyManager } from './shared/keyManager';
export type { KeyRotationInfo } from './shared/keyManager';
export { exportUserData, deleteUserData, anonymizeUserData, updateConsent } from './shared/gdpr';
export type { UserConsent, ExportResult, DeletionResult, AnonymizationResult } from './shared/gdpr';
export { piiAuditService, PiiAuditService } from './shared/piiAudit';
export type { PiiAccessAction, PiiAccessRecord } from './shared/piiAudit';

// ── Shared Services ───────────────────────────────────────────────────────────
export { AuditService, auditService } from './shared/auditService';
export { RateLimitingService, rateLimitingService } from './shared/rateLimitingService';
export { MonitoringService, monitoringService } from './shared/monitoring';
export { apiClient } from './shared/apiClient';
export type {
  AuditAction,
  AuditArchiveEntry,
  AuditContext,
  AuditEvent,
  AuditQueryFilter,
  AuditQueryResult,
  AuditReport,
  AuditSeverity,
  ArchivalPolicy,
  ComplianceAuditReport,
  ExportFormat,
  RetentionPolicy,
} from './shared/auditTypes';
export type {
  TransactionStatus,
  AlertSeverity,
  AlertChannel,
  TransactionEvent,
  Metric,
  Alert,
  AlertRule,
  AlertChannelConfig,
  DashboardSnapshot,
} from './shared/types';

// ── Subscription Module ───────────────────────────────────────────────────────
export {
  SubscriptionEventStore,
  subscriptionEventStore,
} from './subscription/subscriptionEventStore';
export type {
  SubscriptionEvent,
  SubscriptionEventPage,
  SubscriptionEventQuery,
  SubscriptionEventType,
} from './subscription/subscriptionEventStore';
export { ElasticsearchService, elasticsearchService } from './subscription/ElasticsearchService';
export type {
  SearchQuery,
  SearchHit,
  FacetResult,
  SearchResult,
  SearchAnalyticsEvent,
} from './subscription/ElasticsearchService';
export type { ISubscriptionEventStore, IElasticsearchService } from './subscription/interfaces';
export { SubscriptionError } from './subscription/errors';

// ── Billing Module ────────────────────────────────────────────────────────────
export { MeteringService } from './billing/meteringService';
export type { UsageMetric } from './billing/meteringService';
export { PricingService } from './billing/pricingService';
export type { PriceRecommendation, ABTestScenario, PricingContext } from './billing/pricingService';
export { TaxService } from './billing/taxService';
export { DunningService, dunningService } from './billing/dunningService';
export { streamExport, reconcile } from './billing/accountingExportService';
export type {
  AccountingFormat,
  TransactionType,
  TransactionRecord,
  ExportFilter,
  StreamExportOptions,
  ReconciliationResult,
} from './billing/accountingExportService';
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
} from './billing/taxTypes';
export type {
  IMeteringService,
  IPricingService,
  ITaxService,
  IDunningService,
  IAccountingExportService,
} from './billing/interfaces';
export { BillingError } from './billing/errors';

// ── Notification Module ───────────────────────────────────────────────────────
export { NotificationPreferenceService } from './notification/preferenceService';
export type { NotificationPreferences } from './notification/preferenceService';
export { AlertingService } from './notification/alerting';
export type { AlertDispatcher } from './notification/alerting';
export {
  WebhookDeliveryService,
  webhookDeliveryService,
  buildWebhookPayload,
  signWebhookPayload,
  verifyWebhookSignature,
  isWebhookEventAllowed,
} from './notification/webhook';
export type {
  RegisterWebhookInput,
  WebhookDeliveryResult,
  WebhookEventInput,
} from './notification/webhook';
export { WebSocketServer, webSocketServer } from './notification/websocket';
export type {
  SubscriptionEventType as WSSubscriptionEventType,
  SubscriptionEvent as WSSubscriptionEvent,
  EventFilter as WSEventFilter,
  ClientInfo as WSClientInfo,
} from './notification/websocket';
export type {
  INotificationPreferenceService,
  IAlertingService,
  IWebhookDeliveryService,
  IWebsocketService,
} from './notification/interfaces';
export { NotificationError } from './notification/errors';

// ── Analytics Module ──────────────────────────────────────────────────────────
export { CampaignService } from './analytics/campaignService';
export type {
  Campaign,
  CouponCode,
  PromotionRule,
  CampaignTargeting,
  StackingConfig,
  CampaignAnalytics,
  CampaignOverlap,
  CouponValidation,
} from './analytics/campaignService';
export {
  generateComplianceReport,
  formatComplianceReport,
} from './analytics/complianceReport';
export type {
  ComplianceReport,
  EncryptionStatus,
  KeyManagementStatus,
  PiiAccessSummary,
  DataMaskingStatus,
} from './analytics/complianceReport';
export { DataPipelineService } from './analytics/dataPipeline';
export { DataWarehouseService } from './analytics/dataWarehouse';
export { PredictionService } from './analytics/predictionService';
export type {
  ChurnPrediction,
  RiskFactor,
  UserChurnData,
  ForecastPoint,
  RevenueObservation,
} from './analytics/predictionService';
export { RecommendationService } from './analytics/recommendationService';
export type { Recommendation, RecommendationContext } from './analytics/recommendationService';
export { RetentionService } from './analytics/retentionService';
export { OracleMonitorService, oracleMonitorService } from './analytics/oracleMonitorService';
export type {
  IPredictionService,
  IRecommendationService,
  IComplianceReportService,
  ICampaignService,
} from './analytics/interfaces';
export { AnalyticsError } from './analytics/errors';

// ── Affiliate Module ──────────────────────────────────────────────────────────
export { AffiliateService } from './affiliate/AffiliateService';
export type { ReferralClick, AttributionEvent } from './affiliate/AffiliateService';

export { SubscriptionCacheService } from './subscriptionCacheService';
export type {
  RedisClient,
  SubscriptionCacheConfig,
  CacheMetrics,
} from './subscriptionCacheService';
export { BatchChargeService } from './batchChargeService';
export type { BatchChargeCandidate, BatchChargeOptions, BatchChargeResult } from './batchChargeService';

// ── Idempotency (Issue #425) ─────────────────────────────────────────────────
export {
  IdempotencyService,
  idempotencyService,
  IdempotencyKeyCollisionError,
  IdempotencyRequestInFlightError,
  hashRequest,
  generateIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
} from './idempotencyService';
export type { IdempotencyRecord, IdempotencyResult, IdempotencyStatus } from './idempotencyService';
export { idempotencyMiddleware } from './idempotencyMiddleware';

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

// ── Access Control / RBAC (Issue #420) ────────────────────────────────────────
export { AccessControlService, AccessDeniedError, PermissionEscalationError, ROLE_PERMISSIONS, ROLE_HIERARCHY } from './accessControl';
export type {
  Role,
  Resource,
  Action,
  Permission,
  Effect,
  RoleAssignment,
  TemporaryElevation,
  ApiKeyScope,
  UnauthorizedAccessEvent,
  AccessCheckOptions,
} from './accessControl';

// ── DI Container ──────────────────────────────────────────────────────────────
export { container, Container } from './container';
