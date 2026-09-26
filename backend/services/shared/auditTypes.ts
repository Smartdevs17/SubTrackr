// Audit logging type definitions

export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';

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
  | 'pii.searched'
  // Critical security events
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failed'
  | 'auth.token_refreshed'
  | 'admin.role_changed'
  | 'admin.user_suspended'
  | 'admin.user_deleted'
  | 'api.key_created'
  | 'api.key_revoked'
  | 'api.key_rotated'
  | 'settings.changed'
  | 'export.data_exported'
  | 'security.threat_detected'
  | 'session.revoked'
  | 'session.suspicious_detected'
  | 'encryption.key_rotated'
  | 'encryption.key_compromised';

export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  location?: string;
  deviceId?: string;
  platform?: string;
}

export interface AuditEvent {
  id: string;
  action: AuditAction;
  actorId: string;
  resourceId: string;
  resourceType: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  severity: AuditSeverity;
  context?: AuditContext;
  hash: string;
  prevHash: string;
}

export type ExportFormat = 'json' | 'csv';

export interface AuditReport {
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  totalEvents: number;
  byAction: Record<string, number>;
  bySeverity: Record<string, number>;
  events: AuditEvent[];
}

export interface AuditArchiveEntry {
  archiveId: string;
  originalCount: number;
  periodStart: number;
  periodEnd: number;
  archivedAt: number;
  events: AuditEvent[];
}

export interface ArchivalPolicy {
  enabled: boolean;
  archiveAfterMs: number;
}

export interface AuditQueryFilter {
  from?: number;
  to?: number;
  action?: AuditAction;
  actorId?: string;
  resourceId?: string;
  resourceType?: string;
  severity?: AuditSeverity;
  search?: string;
  sortBy?: 'timestamp' | 'action' | 'actorId';
  sortOrder?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export interface AuditQueryResult {
  events: AuditEvent[];
  total: number;
  offset: number;
  limit: number;
}

export interface ComplianceAuditReport {
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  totalEvents: number;
  criticalEvents: number;
  highSeverityEvents: number;
  byAction: Record<string, number>;
  bySeverity: Record<string, number>;
  byActor: Record<string, number>;
  uniqueActors: number;
  uniqueResources: number;
  integrityValid: boolean;
  firstInvalidIndex: number | null;
  exportFormats: ExportFormat[];
  retentionDays: number;
  events: AuditEvent[];
}

export interface RetentionPolicy {
  maxAgeMs: number;
  archiveAfterMs?: number;
}
