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
export type { AuditAction, AuditEvent, AuditReport, ExportFormat, RetentionPolicy } from './retentionPolicy' as any;
export { exportUserData, deleteUserData, anonymizeUserData, updateConsent } from './gdpr';
export type { UserConsent, ExportResult, DeletionResult, AnonymizationResult } from './gdpr';
export { piiAuditService, PiiAuditService } from './piiAudit';
export type { PiiAccessAction, PiiAccessRecord, LineageNode, PiiLineageTrail, PiiAuditReport } from './piiAudit';
export { PiiClassifier, piiClassifier, redact, isPiiField as isPiiFieldClassifier, DEFAULT_PATTERNS } from './piiClassifier';
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

export {
  JwtAuthStrategy,
  ApiKeyAuthStrategy,
  WalletAuthStrategy,
  CompositeAuthStrategyManager,
  createUnifiedAuthMiddleware,
} from './authStrategies';
export type { IAuthStrategy, AuthUser } from './authStrategies';
export {
  sanitizeXss,
  detectSqlInjection,
  validateRequest,
  createValidationMiddleware,
  validateFileUpload,
  readBodyWithLimit,
  getBodySizeLimit,
  commonSchemas,
  BODY_SIZE_LIMITS,
  DEFAULT_FILE_CONFIG,
} from './validationMiddleware';
export type {
  ValidationSchemas,
  ValidationOptions,
  ValidationResult,
  ValidationErrorDetail,
  FileUploadConfig,
  FileValidationResult,
  BodySizeLimit,
} from './validationMiddleware';
export {
  createPlanSchema,
  updatePlanSchema,
  planQuerySchema,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  cancelSubscriptionSchema,
  pauseSubscriptionSchema,
  subscriptionQuerySchema,
  paymentRequestSchema,
  refundRequestSchema,
  paymentQuerySchema,
  createWebhookSchema,
  createApiKeySchema,
  analyticsQuerySchema,
  forecastRequestSchema,
  customerQuerySchema,
  fallbackChainSchema,
  fallbackQuerySchema,
  corsPolicySchema,
  idParamSchema,
  subscriptionIdParamSchema,
  planIdParamSchema,
} from './schemas';
export {
  upsertPolicy as upsertCorsPolicy,
  getPolicy as getCorsPolicy,
  getAllPolicies as getAllCorsPolicies,
  deletePolicy as deleteCorsPolicy,
  testOrigin as testCorsOrigin,
  processCorsRequest,
  recordViolation as recordCorsViolation,
  getCorsAnalytics,
  getViolations as getCorsViolations,
  clearPreflightCache,
  createCorsMiddleware,
  resetAnalytics as resetCorsAnalytics,
} from './corsMiddleware';
export type {
  CorsPolicy,
  CorsOrigin,
  CorsViolation,
  CorsAnalytics,
  CorsTestResult,
  CorsHeadersResult,
} from './corsMiddleware';
