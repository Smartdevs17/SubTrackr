import { AuditService } from '../../backend/services/shared/auditService';
import { AlertingService } from '../../backend/services/notification/alerting';
import type {
  AuditAction,
  AuditContext,
  AuditEvent,
  AuditQueryFilter,
  AuditQueryResult,
  AuditReport,
  AuditSeverity,
  ComplianceAuditReport,
} from '../../backend/services/shared/auditTypes';
import { env } from '../config/env';
import { randomBytes } from 'crypto';

function getAuditSecret(): string {
  if (env.AUDIT_HMAC_SECRET) {
    return env.AUDIT_HMAC_SECRET;
  }
  // Generate a random secret for development if not provided
  // This secret will be regenerated on each app restart, which is fine for dev
  return randomBytes(32).toString('hex');
}

const AUDIT_HMAC_SECRET = getAuditSecret();

const alertingService = new AlertingService();

export const auditService = new AuditService(
  AUDIT_HMAC_SECRET,
  undefined,
  { enabled: true, archiveAfterMs: 365 * 24 * 60 * 60 * 1000 },
  { alertingService }
);

export function captureAuditEvent(
  action: AuditAction,
  actorId: string,
  resourceId: string,
  resourceType: string,
  metadata?: Record<string, unknown>,
  severity?: AuditSeverity,
  context?: AuditContext
): AuditEvent {
  return auditService.capture(
    action,
    actorId,
    resourceId,
    resourceType,
    metadata,
    severity,
    context
  );
}

export function queryAuditEvents(filter?: AuditQueryFilter): AuditEvent[] {
  return auditService.query(filter);
}

export function queryAuditEventsPaginated(filter?: AuditQueryFilter): AuditQueryResult {
  return auditService.queryPaginated(filter);
}

export function generateAuditReport(from?: number, to?: number): AuditReport {
  return auditService.generateReport(from ?? Date.now() - 86400000, to ?? Date.now());
}

export function generateComplianceReport(from?: number, to?: number): ComplianceAuditReport {
  return auditService.generateComplianceReport(from ?? Date.now() - 86400000, to ?? Date.now());
}

export function verifyAuditLog(): { valid: boolean; firstInvalidIndex: number | null } {
  return auditService.verify();
}

export function exportAuditLog(format: 'json' | 'csv', from?: number, to?: number): string {
  return auditService.export(format, from, to);
}

export async function persistAuditLog(): Promise<void> {
  await auditService.save();
}

export async function loadAuditLog(): Promise<void> {
  await auditService.load();
}

export async function applyRetentionPolicy(): Promise<void> {
  auditService.applyRetention();
  await auditService.save();
}
