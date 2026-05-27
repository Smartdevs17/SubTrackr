export { AuditService } from './auditService';
export { PricingService } from './pricingService';
export { TaxService } from './taxService';
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
  encryptField,
  decryptField,
  generateBlindIndexTokens,
  searchBlindIndex,
  maskField,
  maskObject,
  generateKey,
  generateEncryptionKey,
  isPiiField,
  getPiiFields,
  reEncryptField,
} from './encryption';
export type {
  EncryptionKey,
  EncryptedField,
  BlindIndex,
  DecryptedField,
  Environment,
} from './encryption';

export { KeyManager, keyManager } from './keyManager';
export type { KeyStoreEntry, KeyRotationResult } from './keyManager';

export { PiiAuditService, piiAuditService } from './piiAudit';
export type { PiiAccessAction, PiiAccessRecord } from './piiAudit';

export {
  generateComplianceReport,
  formatComplianceReport,
} from './complianceReport';
export type {
  ComplianceReport,
  EncryptionStatus,
  KeyManagementStatus,
  PiiAccessSummary,
  DataMaskingStatus,
} from './complianceReport';

export {
  exportUserData,
  deleteUserData,
  anonymizeUserData,
  updateConsent,
} from './gdpr';
export type { UserConsent, ExportResult, DeletionResult, AnonymizationResult } from './gdpr';
