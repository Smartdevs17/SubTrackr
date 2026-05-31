// Audit logging type definitions

export type AuditAction =
  | 'subscription.created'
  | 'subscription.cancelled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'payment.charged'
  | 'payment.failed'
  | 'payment.refunded'
  | 'plan.created'
  | 'plan.updated'
  | 'plan.deactivated'
  | 'admin.action'
  | 'pii.viewed'
  | 'pii.exported'
  | 'pii.updated'
  | 'pii.deleted'
  | 'pii.anonymized'
  | 'pii.encrypted'
  | 'pii.decrypted'
  | 'pii.reencrypted'
  | 'pii.searched';

export interface AuditEvent {
  id: string;
  action: AuditAction;
  actorId: string; // wallet address or system
  resourceId: string; // subscriptionId, planId, etc.
  resourceType: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  /** SHA-256 HMAC chain hash for integrity verification */
  hash: string;
  /** Hash of the previous event — forms the chain */
  prevHash: string;
}

export type ExportFormat = 'json' | 'csv';

export interface AuditReport {
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  totalEvents: number;
  byAction: Record<string, number>;
  events: AuditEvent[];
}

export interface RetentionPolicy {
  /** Keep events for this many milliseconds (default: 7 years for financial compliance) */
  maxAgeMs: number;
}
