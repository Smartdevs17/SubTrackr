/**
 * backend/src/consent/types.ts
 *
 * Domain types for GDPR/CCPA-compliant consent management.
 *
 * Implements Art. 6 (lawfulness of processing) and Art. 7 (conditions for
 * consent) requirements: explicit category-level opt-in, immutable audit
 * logging, tamper-evident records, and effortless withdrawal.
 */

export type ConsentCategory =
  | 'analytics'
  | 'marketing'
  | 'notifications'
  | 'data_sharing'
  | 'essential';

export type ConsentStatus = 'granted' | 'withdrawn' | 'pending';

export type LegalBasis =
  | 'consent'             // Art. 6(1)(a) GDPR
  | 'contract'            // Art. 6(1)(b) GDPR
  | 'legitimate_interest' // Art. 6(1)(f) GDPR
  | 'legal_obligation';   // Art. 6(1)(c) GDPR

export type ConsentSource =
  | 'mobile_app'
  | 'web_portal'
  | 'inbound_sms'
  | 'api'
  | 'checkout'
  | 'admin';

export interface ConsentCategoryDefinition {
  key: ConsentCategory;
  title: string;
  description: string;
  legalBasis: LegalBasis;
  /** True when the category cannot be disabled (e.g. core contract performance). */
  isEssential: boolean;
  /** Initial opt-in value for new users. GDPR mandates false for all non-essential. */
  defaultGranted: boolean;
}

/** Immutable audit trail entry demonstrating consent under Art. 7(1) GDPR. */
export interface ConsentRecord {
  id: string;
  userId: string;
  category: ConsentCategory;
  status: ConsentStatus;
  policyVersion: string;
  source: ConsentSource;
  timestamp: string; // ISO 8601 UTC
  ipHash?: string;   // SHA-256 hashed/salted IP address for fraud/audit verification
  userAgent?: string;
  metadata?: Record<string, unknown>;
  /** HMAC-SHA256 signature sealing the record for tamper-evidence. */
  signature: string;
}

/** The active consent state of a user across all categories. */
export interface UserConsentState {
  userId: string;
  policyVersion: string;
  preferences: Record<ConsentCategory, boolean>;
  updatedAt: string;
  recordCount: number;
}

/** Inbound payload when a user updates their preferences. */
export interface ConsentUpdatePayload {
  userId: string;
  preferences: Partial<Record<ConsentCategory, boolean>>;
  policyVersion?: string;
  source: ConsentSource;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/** Portable export payload satisfying Art. 15 / 20 GDPR data access & portability. */
export interface ConsentDataExport {
  userId: string;
  exportedAt: string;
  currentState: UserConsentState;
  auditTrail: ConsentRecord[];
}

/** Telemetry hooks for consent metrics. */
export interface ConsentMetrics {
  recordGrant(category: ConsentCategory, source: ConsentSource): void;
  recordWithdrawal(category: ConsentCategory, source: ConsentSource): void;
  recordReconsentRequired(userId: string): void;
  recordVerificationFailure(recordId: string): void;
}
