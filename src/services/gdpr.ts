import { Alert } from 'react-native';
import type {
  ConsentRecord,
  DataExportPayload,
  DeletionRequest,
  DPARecord,
  LegalHold,
  PIIField,
} from '../types/gdpr';

// Re-export legacy interface for backward compatibility
export interface ConsentPreferences {
  analytics: boolean;
  marketing: boolean;
  notifications: boolean;
}

export interface ExportResponse {
  url: string;
  timestamp: string;
  encryptedFields: string[];
}

export interface DeletionResponse {
  success: boolean;
  message: string;
  anonymizedFields: string[];
  blockedBy?: string;
}

// PII field registry — annotates which fields contain personal data
export const PII_FIELDS: PIIField[] = [
  { field: 'email', category: 'contact', encrypted: true, retentionDays: 30 },
  { field: 'name', category: 'identity', encrypted: false, retentionDays: 30 },
  { field: 'phoneNumber', category: 'contact', encrypted: true, retentionDays: 30 },
  { field: 'address', category: 'contact', encrypted: true, retentionDays: 30 },
  { field: 'cardLast4', category: 'financial', encrypted: true, retentionDays: 90 },
  { field: 'billingAddress', category: 'financial', encrypted: true, retentionDays: 90 },
  { field: 'deviceId', category: 'technical', encrypted: false, retentionDays: 7 },
  { field: 'ipAddress', category: 'technical', encrypted: false, retentionDays: 7 },
];

const ANONYMIZED_VALUE = '[ANONYMIZED]';
const DEFAULT_RETENTION_DAYS = 30;
const API_BASE = 'https://api.subtrackr.example.com/gdpr';

// In-memory stores (replace with real persistence layer)
const _consentHistory: ConsentRecord[] = [];
const _dpaLog: DPARecord[] = [];
const _legalHolds = new Map<string, LegalHold>();

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export const gdprService = {
  // ─── PII Scanner ────────────────────────────────────────────────────────────

  scanPIIFields(): PIIField[] {
    return PII_FIELDS;
  },

  // ─── Data Export (SAR) ──────────────────────────────────────────────────────

  async exportData(userId = 'user-123'): Promise<ExportResponse> {
    // Log DPA activity
    gdprService.logDPAActivity(userId, 'Subject Access Request (SAR)', [
      'identity',
      'contact',
      'financial',
      'subscription',
    ]);

    const payload: DataExportPayload = {
      exportId: createId('export'),
      userId,
      generatedAt: nowIso(),
      profile: {
        name: 'John Doe',
        email: 'john@example.com',
        phoneNumber: '+1234567890',
      },
      subscriptions: [],
      paymentMethods: [],
      analyticsHistory: [],
      consentHistory: gdprService.getConsentHistory(userId),
      dpaLog: gdprService.getDPALog(userId),
    };

    const encryptedFields = PII_FIELDS.filter((f) => f.encrypted).map((f) => f.field);

    // In production: upload encrypted payload, return signed URL
    console.log('[GDPR] SAR export generated:', payload.exportId);

    return {
      url: `${API_BASE}/download/${payload.exportId}.json`,
      timestamp: payload.generatedAt,
      encryptedFields,
    };
  },

  async downloadData(data: unknown): Promise<void> {
    console.log('Triggering download for:', data);
    Alert.alert('Success', 'Your data export has been prepared and will be sent to your email.');
  },

  // ─── Account Deletion (Right to Erasure) ────────────────────────────────────

  async requestDeletion(
    permanent: boolean,
    userId = 'user-123',
    activeSubscriptions: string[] = []
  ): Promise<DeletionResponse> {
    // Edge case: active subscriptions block deletion
    if (activeSubscriptions.length > 0) {
      return {
        success: false,
        message: `Deletion blocked: ${activeSubscriptions.length} active subscription(s) require prorated refund before deletion. Please cancel them first.`,
        anonymizedFields: [],
        blockedBy: 'active_subscriptions',
      };
    }

    // Edge case: legal hold prevents deletion
    const hold = _legalHolds.get(userId);
    if (hold) {
      return {
        success: false,
        message: `Deletion blocked by legal hold: ${hold.reason}`,
        anonymizedFields: [],
        blockedBy: 'legal_hold',
      };
    }

    const anonymizedFields = PII_FIELDS.map((f) => f.field);

    if (!permanent) {
      // Anonymize retained data instead of deleting
      gdprService.logDPAActivity(userId, 'Data anonymization on retention', [
        'identity',
        'contact',
        'financial',
      ]);
      return {
        success: true,
        message: 'User data has been anonymized',
        anonymizedFields,
      };
    }

    // Schedule cascade deletion with configurable retention
    const request: DeletionRequest = {
      userId,
      requestedAt: nowIso(),
      retentionPeriodDays: DEFAULT_RETENTION_DAYS,
      scheduledDeletionAt: addDays(DEFAULT_RETENTION_DAYS),
      cascadeTargets: ['subscriptions', 'payment_methods', 'analytics_history', 'consent_records'],
      anonymizedFields,
    };

    gdprService.logDPAActivity(userId, 'Right to erasure request', [
      'identity',
      'contact',
      'financial',
      'behavioral',
      'subscription',
    ]);

    console.log('[GDPR] Deletion scheduled:', request);

    return {
      success: true,
      message: `Account queued for permanent deletion on ${request.scheduledDeletionAt}. Cascade targets: ${request.cascadeTargets.join(', ')}.`,
      anonymizedFields,
    };
  },

  // ─── Anonymization ───────────────────────────────────────────────────────────

  anonymizeRecord<T extends Record<string, unknown>>(record: T): T {
    const result = { ...record };
    for (const field of PII_FIELDS) {
      if (field.field in result) {
        (result as Record<string, unknown>)[field.field] = ANONYMIZED_VALUE;
      }
    }
    return result;
  },

  // ─── Consent Management ──────────────────────────────────────────────────────

  async updateConsent(
    preferences: ConsentPreferences,
    userId = 'user-123'
  ): Promise<ConsentPreferences> {
    const timestamp = nowIso();
    const version = '1.0';

    // Record timestamped consent for each category
    const categories: ConsentRecord['category'][] = ['analytics', 'marketing', 'notifications'];
    for (const category of categories) {
      const key = category as keyof ConsentPreferences;
      if (key in preferences) {
        _consentHistory.push({
          id: createId('consent'),
          userId,
          category,
          granted: preferences[key] as boolean,
          timestamp,
          version,
        });
      }
    }

    return preferences;
  },

  recordConsent(
    userId: string,
    category: ConsentRecord['category'],
    granted: boolean,
    policyVersion = '1.0'
  ): ConsentRecord {
    const record: ConsentRecord = {
      id: createId('consent'),
      userId,
      category,
      granted,
      timestamp: nowIso(),
      version: policyVersion,
    };
    _consentHistory.push(record);
    return record;
  },

  getConsentHistory(userId: string): ConsentRecord[] {
    return _consentHistory.filter((r) => r.userId === userId);
  },

  // ─── Data Processing Activity (DPA) Log ─────────────────────────────────────

  logDPAActivity(
    userId: string,
    activity: string,
    dataCategories: DPARecord['dataCategories'],
    legalBasis: DPARecord['legalBasis'] = 'contract'
  ): DPARecord {
    const record: DPARecord = {
      id: createId('dpa'),
      userId,
      activity,
      dataCategories,
      legalBasis,
      processedAt: nowIso(),
      retentionExpiry: addDays(DEFAULT_RETENTION_DAYS),
      processor: 'SubTrackr',
    };
    _dpaLog.push(record);
    return record;
  },

  getDPALog(userId: string): DPARecord[] {
    return _dpaLog.filter((r) => r.userId === userId);
  },

  // ─── Legal Hold ──────────────────────────────────────────────────────────────

  setLegalHold(userId: string, reason: string, createdBy: string, expiresAt?: string): LegalHold {
    const hold: LegalHold = {
      userId,
      reason,
      createdAt: nowIso(),
      expiresAt,
      createdBy,
    };
    _legalHolds.set(userId, hold);
    return hold;
  },

  removeLegalHold(userId: string): void {
    _legalHolds.delete(userId);
  },

  getLegalHold(userId: string): LegalHold | undefined {
    return _legalHolds.get(userId);
  },
};
