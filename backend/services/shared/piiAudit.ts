import { AuditService } from './auditService';
import type { AuditAction, AuditContext, AuditEvent } from './auditTypes';
import { isPiiField } from './piiClassifier';

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

// ─────────────────────────────────────────────────────────────────────────────
// Data lineage
// ─────────────────────────────────────────────────────────────────────────────

/** A single hop in the PII data lineage graph. */
export interface LineageNode {
  /** Unique step identifier */
  stepId: string;
  /** Module / service that processed the PII (e.g. 'billing', 'analytics') */
  module: string;
  /** Operation performed */
  operation: string;
  /** PII field names present at this step */
  fields: string[];
  /** Protection applied at this step */
  protection: 'none' | 'encrypted' | 'redacted' | 'anonymized';
  timestamp: number;
}

/** Full lineage trail for a single data subject (userId) */
export interface PiiLineageTrail {
  subjectId: string;
  resourceType: string;
  nodes: LineageNode[];
  createdAt: number;
  lastUpdatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit report
// ─────────────────────────────────────────────────────────────────────────────

export interface PiiAuditReport {
  generatedAt: number;
  periodStart: number;
  periodEnd: number;
  totalAccesses: number;
  /** Count per action type */
  byAction: Record<string, number>;
  /** Count per PII field name */
  byField: Record<string, number>;
  /** Count per endpoint or module */
  byModule: Record<string, number>;
  uniqueActors: number;
  /** Actors with the highest PII access counts */
  topActors: Array<{ actorId: string; count: number }>;
  /** Fields most frequently accessed */
  topFields: Array<{ field: string; count: number }>;
  /** High-severity events (exports, deletes) */
  highRiskEvents: PiiAccessRecord[];
  /** Lineage summaries keyed by subjectId */
  lineageSummary: Record<string, { nodeCount: number; modules: string[] }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class PiiAuditService {
  private auditService: AuditService;
  /** In-memory lineage store — production should use a persistent store */
  private lineage: Map<string, PiiLineageTrail> = new Map();

  constructor(auditService: AuditService) {
    this.auditService = auditService;
  }

  // ── Access logging ─────────────────────────────────────────────────────────

  logPiiAccess(
    action: PiiAccessAction,
    actorId: string,
    resourceId: string,
    resourceType: string,
    fieldsAccessed: string[],
    metadata: Record<string, unknown> = {},
    context?: AuditContext
  ): PiiAccessRecord {
    const piiFields = fieldsAccessed.filter((f) => isPiiField(f));

    const severity = action === 'pii.exported' || action === 'pii.deleted' ? 'high' : 'medium';

    const event = this.auditService.capture(
      action as AuditAction,
      actorId,
      resourceId,
      resourceType,
      {
        ...metadata,
        piiFields,
        accessTimestamp: Date.now(),
        isMasked: (process.env['APP_ENV'] ?? 'development') !== 'production',
      },
      severity,
      context
    );

    return { event, fieldsAccessed: piiFields };
  }

  // ── Data lineage tracking ──────────────────────────────────────────────────

  /**
   * Record a lineage hop for a given data subject.
   *
   * @param subjectId   - The data subject (e.g. userId)
   * @param resourceType - e.g. 'User', 'Subscription'
   * @param node        - The processing step details
   */
  trackLineage(subjectId: string, resourceType: string, node: Omit<LineageNode, 'timestamp'>): void {
    const key = `${resourceType}:${subjectId}`;
    const now = Date.now();
    const fullNode: LineageNode = { ...node, timestamp: now };

    if (this.lineage.has(key)) {
      const trail = this.lineage.get(key)!;
      trail.nodes.push(fullNode);
      trail.lastUpdatedAt = now;
    } else {
      this.lineage.set(key, {
        subjectId,
        resourceType,
        nodes: [fullNode],
        createdAt: now,
        lastUpdatedAt: now,
      });
    }
  }

  /**
   * Retrieve the full lineage trail for a data subject.
   */
  getLineage(subjectId: string, resourceType: string): PiiLineageTrail | undefined {
    return this.lineage.get(`${resourceType}:${subjectId}`);
  }

  /**
   * Clear lineage data for a subject (supports GDPR deletion).
   */
  clearLineage(subjectId: string, resourceType: string): void {
    this.lineage.delete(`${resourceType}:${subjectId}`);
  }

  // ── Access history ─────────────────────────────────────────────────────────

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

    const events = this.auditService.query({ from, to, actorId });

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

  // ── Full audit report ──────────────────────────────────────────────────────

  /**
   * Generate a PII audit report for a time window.
   * Covers: access counts, top actors, top fields, high-risk events, and
   * lineage summaries per data subject.
   */
  generateReport(from: number, to: number): PiiAuditReport {
    const records = this.getPiiAccessHistory(undefined, from, to);
    const byAction: Record<string, number> = {};
    const byField: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    const actorCounts: Record<string, number> = {};
    const highRiskActions = new Set<PiiAccessAction>(['pii.exported', 'pii.deleted']);
    const highRiskEvents: PiiAccessRecord[] = [];

    for (const record of records) {
      const { event, fieldsAccessed } = record;
      byAction[event.action] = (byAction[event.action] ?? 0) + 1;

      for (const field of fieldsAccessed) {
        byField[field] = (byField[field] ?? 0) + 1;
      }

      const module = (event.metadata?.module as string) ?? event.resourceType ?? 'unknown';
      byModule[module] = (byModule[module] ?? 0) + 1;

      actorCounts[event.actorId] = (actorCounts[event.actorId] ?? 0) + 1;

      if (highRiskActions.has(event.action as PiiAccessAction)) {
        highRiskEvents.push(record);
      }
    }

    const topActors = Object.entries(actorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([actorId, count]) => ({ actorId, count }));

    const topFields = Object.entries(byField)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([field, count]) => ({ field, count }));

    // Lineage summary
    const lineageSummary: Record<string, { nodeCount: number; modules: string[] }> = {};
    for (const [key, trail] of this.lineage.entries()) {
      const [, subjectId] = key.split(':');
      const modules = [...new Set(trail.nodes.map((n) => n.module))];
      lineageSummary[subjectId] = { nodeCount: trail.nodes.length, modules };
    }

    return {
      generatedAt: Date.now(),
      periodStart: from,
      periodEnd: to,
      totalAccesses: records.length,
      byAction,
      byField,
      byModule,
      uniqueActors: Object.keys(actorCounts).length,
      topActors,
      topFields,
      highRiskEvents,
      lineageSummary,
    };
  }
}

export const piiAuditService = new PiiAuditService(
  new AuditService('pii-audit-hmac-secret')
);
