/**
 * Audit Service — tamper-evident, compliance-grade audit logging.
 *
 * Integrity model: each event carries a SHA-256 HMAC of its own content
 * chained to the previous event's hash, forming an append-only log.
 * Verification walks the chain and re-derives every hash.
 */

import { createHmac, randomUUID } from 'crypto';
import type {
  AuditAction,
  AuditEvent,
  AuditReport,
  ExportFormat,
  RetentionPolicy,
} from './auditTypes';

const SEVEN_YEARS_MS = 7 * 365 * 24 * 60 * 60 * 1000;
const GENESIS_HASH = '0'.repeat(64);

export class AuditService {
  private log: AuditEvent[] = [];
  private retention: RetentionPolicy;
  private secret: string;

  constructor(secret: string, retention: RetentionPolicy = { maxAgeMs: SEVEN_YEARS_MS }) {
    if (!secret) throw new Error('AuditService requires a non-empty HMAC secret');
    this.secret = secret;
    this.retention = retention;
  }

  // ── Event capture ─────────────────────────────────────────────────────────

  capture(
    action: AuditAction,
    actorId: string,
    resourceId: string,
    resourceType: string,
    metadata: Record<string, unknown> = {}
  ): AuditEvent {
    const prevHash = this.log.length ? this.log[this.log.length - 1].hash : GENESIS_HASH;
    const id = randomUUID();
    const timestamp = Date.now();

    const hash = this._hash({
      id,
      action,
      actorId,
      resourceId,
      resourceType,
      metadata,
      timestamp,
      prevHash,
    });

    const event: AuditEvent = {
      id,
      action,
      actorId,
      resourceId,
      resourceType,
      metadata,
      timestamp,
      hash,
      prevHash,
    };
    this.log.push(event);
    return event;
  }

  // ── Integrity verification ────────────────────────────────────────────────

  verify(): { valid: boolean; firstInvalidIndex: number | null } {
    let prev = GENESIS_HASH;
    for (let i = 0; i < this.log.length; i++) {
      const e = this.log[i];
      if (e.prevHash !== prev) return { valid: false, firstInvalidIndex: i };
      const expected = this._hash({
        id: e.id,
        action: e.action,
        actorId: e.actorId,
        resourceId: e.resourceId,
        resourceType: e.resourceType,
        metadata: e.metadata,
        timestamp: e.timestamp,
        prevHash: e.prevHash,
      });
      if (expected !== e.hash) return { valid: false, firstInvalidIndex: i };
      prev = e.hash;
    }
    return { valid: true, firstInvalidIndex: null };
  }

  // ── Aggregation & reporting ───────────────────────────────────────────────

  query(filter: {
    from?: number;
    to?: number;
    action?: AuditAction;
    actorId?: string;
    resourceId?: string;
  }): AuditEvent[] {
    return this.log.filter((e) => {
      if (filter.from !== undefined && e.timestamp < filter.from) return false;
      if (filter.to !== undefined && e.timestamp > filter.to) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.actorId && e.actorId !== filter.actorId) return false;
      if (filter.resourceId && e.resourceId !== filter.resourceId) return false;
      return true;
    });
  }

  generateReport(from: number, to: number): AuditReport {
    const events = this.query({ from, to });
    const byAction: Record<string, number> = {};
    for (const e of events) byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    return {
      generatedAt: Date.now(),
      periodStart: from,
      periodEnd: to,
      totalEvents: events.length,
      byAction,
      events,
    };
  }

  // ── Compliance export ─────────────────────────────────────────────────────

  export(format: ExportFormat, from?: number, to?: number): string {
    const events = this.query({ from, to });
    if (format === 'json') return JSON.stringify(events, null, 2);

    // CSV
    const header = 'id,action,actorId,resourceId,resourceType,timestamp,hash,prevHash';
    const rows = events.map((e) =>
      [e.id, e.action, e.actorId, e.resourceId, e.resourceType, e.timestamp, e.hash, e.prevHash]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    return [header, ...rows].join('\n');
  }

  // ── Retention policy ──────────────────────────────────────────────────────

  applyRetention(): number {
    const cutoff = Date.now() - this.retention.maxAgeMs;
    const before = this.log.length;
    this.log = this.log.filter((e) => e.timestamp > cutoff);
    return before - this.log.length; // number of events pruned
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _hash(data: object): string {
    return createHmac('sha256', this.secret).update(JSON.stringify(data)).digest('hex');
  }
}
