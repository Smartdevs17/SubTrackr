export type PIICategory =
  | 'identity'
  | 'contact'
  | 'financial'
  | 'behavioral'
  | 'technical'
  | 'subscription';

export interface PIIField {
  field: string;
  category: PIICategory;
  encrypted: boolean;
  retentionDays: number;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  category: 'analytics' | 'marketing' | 'notifications' | 'data_sharing';
  granted: boolean;
  timestamp: string; // ISO-8601
  ipAddress?: string;
  userAgent?: string;
  version: string; // policy version
}

export interface DPARecord {
  id: string;
  userId: string;
  activity: string;
  dataCategories: PIICategory[];
  legalBasis: 'consent' | 'contract' | 'legal_obligation' | 'legitimate_interest';
  processedAt: string;
  retentionExpiry: string;
  processor: string;
}

export interface LegalHold {
  userId: string;
  reason: string;
  createdAt: string;
  expiresAt?: string;
  createdBy: string;
}

export interface DataExportPayload {
  exportId: string;
  userId: string;
  generatedAt: string;
  profile: Record<string, unknown>;
  subscriptions: unknown[];
  paymentMethods: unknown[];
  analyticsHistory: unknown[];
  consentHistory: ConsentRecord[];
  dpaLog: DPARecord[];
}

export interface DeletionRequest {
  userId: string;
  requestedAt: string;
  retentionPeriodDays: number;
  scheduledDeletionAt: string;
  cascadeTargets: string[];
  anonymizedFields: string[];
  blockedBy?: 'active_subscriptions' | 'legal_hold';
  blockReason?: string;
}
