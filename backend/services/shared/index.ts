export { DomainError } from './errors';
export { logger } from './logging';
export type { LogLevel, LogContext } from './logging';
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
} from './encryption';
export type { Environment, EncryptionKey, EncryptedField, BlindIndex, DecryptedField } from './encryption';
export { keyManager, KeyManager } from './keyManager';
export type { KeyRotationInfo } from './keyManager';
export { AuditService, auditService } from './auditService';
export type { AuditAction, AuditEvent, AuditReport, ExportFormat, RetentionPolicy } from './auditTypes';
export { exportUserData, deleteUserData, anonymizeUserData, updateConsent } from './gdpr';
export type { UserConsent, ExportResult, DeletionResult, AnonymizationResult } from './gdpr';
export { piiAuditService, PiiAuditService } from './piiAudit';
export type { PiiAccessAction, PiiAccessRecord, LineageNode, PiiLineageTrail, PiiAuditReport } from './piiAudit';
export { PiiClassifier, piiClassifier, redact, isPiiField, DEFAULT_PATTERNS } from './piiClassifier';
export type { ClassificationLevel, PiiPattern, ClassifyResult, RedactOptions } from './piiClassifier';
export { redactResponse, createPiiRedactionMiddleware } from './apiResponse';
export { RateLimitingService, rateLimitingService } from './rateLimitingService';
export type { BypassConfig, CustomLimits } from './rateLimitingService';
export {
  createRateLimitMiddleware,
  createRateLimitStatusMiddleware,
  RATE_LIMIT_HEADERS,
} from './rateLimitMiddleware';
export type {
  RateLimitRequest,
  RateLimitResponse,
  RateLimitMiddlewareOptions,
} from './rateLimitMiddleware';
export { apiClient } from './apiClient';
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
export type { TransactionStatus, AlertSeverity, AlertChannel, TransactionEvent, Metric, Alert, AlertRule, AlertChannelConfig, DashboardSnapshot } from './types';
export { MonitoringService, monitoringService } from './monitoring';

// ── Typed Event Bus ────────────────────────────────────────────────────────────
export {
  EventBus,
  SpyEventBus,
  EventCollector,
  InMemoryEventStore,
  buildEvent,
  validateEventPayload,
  EventValidationError,
  eventBus,
  eventStore,
  eventBusPrometheusMetrics,
} from './events';
export type {
  DomainEvent,
  AnyDomainEvent,
  EventPayload,
  EventHandler,
  EventFilter,
  EventSubscription,
  SubscriptionOptions,
  EventBusMetrics,
  IEventBus,
  EventSourcedStore,
  EventStoreQuery,
  AggregateSnapshot,
  ValidationResult,
  // Subscription domain payloads
  SubscriptionCreatedPayload,
  SubscriptionCancelledPayload,
  SubscriptionRenewedPayload,
  SubscriptionUpgradedPayload,
  SubscriptionPausedPayload,
  SubscriptionResumedPayload,
  SubscriptionPaymentFailedPayload,
  SubscriptionEvent,
  // Billing domain payloads
  InvoiceGeneratedPayload,
  PaymentCapturedPayload,
  UsageThresholdReachedPayload,
  ChargebackRaisedPayload,
  BillingEvent,
  // Analytics domain payloads
  ChurnRiskUpdatedPayload,
  CohortAggregatedPayload,
  MrrChangedPayload,
  AnalyticsEvent,
  // Auth domain payloads
  ApiKeyRotatedPayload,
  SsoSessionCreatedPayload,
  AuthEvent,
  // Contract domain payloads
  ContractInvokedPayload,
  ContractUpgradedPayload,
  ContractEvent,
} from './events';

// ── Generic Cache Service ──────────────────────────────────────────────────────
export { CacheService, NullCacheService, wireInvalidation } from './cache';
export type {
  ICacheService,
  CacheServiceConfig,
  CacheMetrics,
  InvalidationRule,
} from './cache';

// ── Compression Middleware ────────────────────────────────────────────────────
export {
  applyCompression,
  negotiateEncoding,
  generateETag,
  isETagMatch,
  compressionMetrics,
  compressionPrometheusMetrics,
} from './compression';
export type {
  CompressionConfig,
  CompressionMetrics,
  CompressionMiddlewareOptions,
  Encoding,
} from './compression';

// ── Cursor Pagination + Field Selection ───────────────────────────────────────
export {
  encodeCursor,
  decodeCursor,
  buildCursorClause,
  buildPage,
  parseFieldSelection,
  selectFields,
  selectFieldsAll,
} from './pagination';
export type {
  CursorPayload,
  PageOptions,
  PageResult,
  SqlCursorClause,
} from './pagination';

// ── Connection Pool Monitor ───────────────────────────────────────────────────
export { MonitoredPool, wrapWithMonitor } from './poolMonitor';
export type {
  PoolMonitorConfig,
  PoolStats,
  LeakRecord,
  PoolTuningRecommendation,
} from './poolMonitor';

// ── Security Headers ─────────────────────────────────────────────────────────
export {
  getSecurityHeaders,
  createSecurityHeadersMiddleware,
  getHstsHeader,
  getCspHeader,
} from './securityHeaders';
export type { SecurityHeadersConfig } from './securityHeaders';

// ── Account Lockout ──────────────────────────────────────────────────────────
export { AccountLockoutService, accountLockoutService } from './accountLockout';
export type { LockoutConfig, LockoutRecord, LockoutCheckResult } from './accountLockout';

// ── API Versioning ───────────────────────────────────────────────────────────
export {
  registerDeprecation,
  getVersions,
  getLatestVersion,
  negotiateVersion,
  getVersionHeaders,
  createVersionMiddleware,
  getDeprecationNotice,
  getActiveVersions,
  getDeprecatedVersions,
} from './apiVersioning';
export type { ApiVersion, VersionNegotiationResult, DeprecationNotice } from './apiVersioning';

// ── CSRF Protection ──────────────────────────────────────────────────────────
export { CsrfProtection, csrfProtection } from './csrfProtection';
export type { CsrfConfig, CsrfTokenPair } from './csrfProtection';

// ── CSP Middleware ────────────────────────────────────────────────────────────
export { CspMiddleware, cspMiddleware } from './cspMiddleware';
export type { CspConfig } from './cspMiddleware';

// ── Webhook Verification ─────────────────────────────────────────────────────
export { WebhookVerifier, webhookVerifier } from './webhookVerification';
export type { WebhookSecret, WebhookVerificationConfig, WebhookSignatureHeader } from './webhookVerification';

// ── Read Replica Router ──────────────────────────────────────────────────────
export { ReadReplicaRouter } from './readReplicaRouter';
export type { ReplicaConfig, ReplicaHealth, ReadRouteOptions, QueryRoute } from './readReplicaRouter';

// ── Query Optimizer ──────────────────────────────────────────────────────────
export { QueryOptimizer, queryOptimizer } from './queryOptimizer';
export type { QueryAnalysis, QueryIssue, IndexRecommendation, TableStats, IndexStats } from './queryOptimizer';

// ── Background Job Queue ─────────────────────────────────────────────────────
export { PriorityQueue, jobQueue } from './jobQueue';
export type { Job, JobHandler, QueueConfig, QueueMetrics, JobStatus, JobPriority } from './jobQueue';

// ── WebSocket Connection Pool ────────────────────────────────────────────────
export { WsConnectionPool } from './wsConnectionPool';
export type { WsPoolConfig, WsConnection, WsMessage, WsPoolMetrics } from './wsConnectionPool';

// ── CDN Service ──────────────────────────────────────────────────────────────
export { CdnService, cdnService } from './cdnService';
export type { CdnConfig, CacheEntry, PurgeRequest, PurgeResult, CdnMetrics } from './cdnService';
