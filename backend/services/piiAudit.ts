import { AuditService } from './auditService';
import type { AuditAction, AuditEvent } from './auditTypes';
import { isPiiField } from './encryption';

export type PiiAccessAction =
  | 'pii.viewed'
  | 'pii.exported'
  | 'pii.updated'
  | 'pii.deleted'
  | 'pii.anonymized'
  | 'pii.encrypted'
  | 'pii.decrypted'
  | 'pii.reencrypted'
  | 'pii.searched';

export interface PiiAccessRecord {
  event: AuditEvent;
  fieldsAccessed: string[];
}

export class PiiAuditService {
  private auditService: AuditService;

  constructor(auditService: AuditService) {
    this.auditService = auditService;
  }

  logPiiAccess(
    action: PiiAccessAction,
    actorId: string,
    resourceId: string,
    resourceType: string,
    fieldsAccessed: string[],
    metadata: Record<string, unknown> = {}
  ): PiiAccessRecord {
    const piiFields = fieldsAccessed.filter((f) => isPiiField(f));

    const event = this.auditService.capture(
      action as AuditAction,
      actorId,
      resourceId,
      resourceType,
      {
        ...metadata,
        piiFields: piiFields,
        accessTimestamp: Date.now(),
        isMasked: (process.env['APP_ENV'] ?? 'development') !== 'production',
      }
    );

    return { event, fieldsAccessed: piiFields };
  }

  getPiiAccessHistory(actorId?: string, from?: number, to?: number): PiiAccessRecord[] {
    const piiActions: PiiAccessAction[] = [
      'pii.viewed',
      'pii.exported',
      'pii.updated',
      'pii.deleted',
      'pii.anonymized',
      'pii.encrypted',
      'pii.decrypted',
      'pii.reencrypted',
      'pii.searched',
    ];

    const events = this.auditService.query({
      from,
      to,
      actorId,
    });

    return events
      .filter((e) => piiActions.includes(e.action as PiiAccessAction))
      .map((e) => ({
        event: e,
        fieldsAccessed: Array.isArray(e.metadata?.piiFields)
          ? (e.metadata.piiFields as string[])
          : [],
      }));
  }

  getPiiAccessSummary(from?: number, to?: number): {
    totalAccesses: number;
    byAction: Record<string, number>;
    byField: Record<string, number>;
    uniqueActors: number;
  } {
    const records = this.getPiiAccessHistory(undefined, from, to);
    const byAction: Record<string, number> = {};
    const byField: Record<string, number> = {};
    const actors = new Set<string>();

    for (const record of records) {
      byAction[record.event.action] = (byAction[record.event.action] ?? 0) + 1;
      for (const field of record.fieldsAccessed) {
        byField[field] = (byField[field] ?? 0) + 1;
      }
      actors.add(record.event.actorId);
    }

    return {
      totalAccesses: records.length,
      byAction,
      byField,
      uniqueActors: actors.size,
    };
  }
}

export const piiAuditService = new PiiAuditService(
  new AuditService('pii-audit-hmac-secret')
);
