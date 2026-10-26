import { createHmac, randomUUID } from 'crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AlertingService, AlertDispatcher } from '../notification/alerting';
import type {
  AuditAction,
  AuditArchiveEntry,
  AuditContext,
  AuditEvent,
  AuditQueryFilter,
  AuditQueryResult,
  AuditReport,
  AuditSeverity,
  ArchivalPolicy,
  ComplianceAuditReport,
  ExportFormat,
  RetentionPolicy,
} from './auditTypes';
import type { Alert, AlertSeverity } from './types';

const SEVEN_YEARS_MS = 7 * 365 * 24 * 60 * 60 * 1000;
const GENESIS_HASH = '0'.repeat(64);
const DEFAULT_MAX_LOG_SIZE = 100_000;
const STORAGE_KEY = '@subtrackr_audit_log';
const ARCHIVE_KEY_PREFIX = '@subtrackr_audit_archive_';

const AUDIT_SEVERITY_MAP: Record<AuditSeverity, AlertSeverity> = {
  low: 'info',
  medium: 'warning',
  high: 'critical',
  critical: 'critical',
};

const PII_FIELD_PATTERNS = [
  /email/i,
  /phone/i,
  /ssn/i,
  /password/i,
  /secret/i,
  /token/i,
  /credit.?card/i,
  /cvv/i,
  /address/i,
  /dob/i,
  /birth.?date/i,
];

function stripPii(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '[REDACTED_EMAIL]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')
      .replace(/\b\d{16}\b/g, '[REDACTED_CARD]');
  }
  return value;
}

function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (PII_FIELD_PATTERNS.some((p) => p.test(key))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      sanitized[key] = stripPii(value);
    } else if (value !== null && typeof value === 'object') {
      sanitized[key] = sanitizeMetadata(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeInput(input: string): string {
  return input.replace(/[\r\n]/g, ' ').replace(/["'\\;]/g, '');
}

export class AuditService {
  private log: AuditEvent[] = [];
  private archive: AuditArchiveEntry[] = [];
  private retention: RetentionPolicy;
  private archivalPolicy: ArchivalPolicy;
  private secret: string;
  private maxLogSize: number;
  private alertingService?: AlertingService;

  constructor(
    secret: string,
    retention: RetentionPolicy = { maxAgeMs: SEVEN_YEARS_MS },
    archivalPolicy?: ArchivalPolicy,
    opts?: { maxLogSize?: number; alertingService?: AlertingService }
  ) {
    if (!secret) throw new Error('AuditService requires a non-empty HMAC secret');
    this.secret = secret;
    this.retention = retention;
    this.archivalPolicy = archivalPolicy ?? { enabled: false, archiveAfterMs: SEVEN_YEARS_MS };
    this.maxLogSize = opts?.maxLogSize ?? DEFAULT_MAX_LOG_SIZE;
    this.alertingService = opts?.alertingService;
  }

  // ── Event capture ─────────────────────────────────────────────────────────

  capture(
    action: AuditAction,
    actorId: string,
    resourceId: string,
    resourceType: string,
    metadata: Record<string, unknown> = {},
    severity: AuditSeverity = 'low',
    context?: AuditContext
  ): AuditEvent {
    const prevHash = this.log.length ? this.log[this.log.length - 1].hash : GENESIS_HASH;
    const id = randomUUID();
    const timestamp = Date.now();

    const safeMetadata = sanitizeMetadata(metadata);
    const safeActorId = sanitizeInput(actorId);
    const safeResourceId = sanitizeInput(resourceId);
    const safeResourceType = sanitizeInput(resourceType);

    const hash = this._hash({
      id,
      action,
      actorId: safeActorId,
      resourceId: safeResourceId,
      resourceType: safeResourceType,
      metadata: safeMetadata,
      timestamp,
      severity,
      context,
      prevHash,
    });

    const event: AuditEvent = {
      id,
      action,
      actorId: safeActorId,
      resourceId: safeResourceId,
      resourceType: safeResourceType,
      metadata: safeMetadata,
      timestamp,
      severity,
      context,
      hash,
      prevHash,
    };

    this.log.push(event);

    if (this.log.length > this.maxLogSize) {
      this.log.shift();
    }

    if (severity === 'critical' || severity === 'high') {
      this._dispatchAlert(event);
    }

    return event;
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  async save(): Promise<void> {
    const data = JSON.stringify({
      log: this.log,
      archive: this.archive,
    });
    await AsyncStorage.setItem(STORAGE_KEY, data);
  }

  async load(): Promise<void> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { log: AuditEvent[]; archive: AuditArchiveEntry[] };
      this.log = data.log ?? [];
      this.archive = data.archive ?? [];
    } catch {
      this.log = [];
      this.archive = [];
    }
  }

  async clear(): Promise<void> {
    this.log = [];
    this.archive = [];
    await AsyncStorage.removeItem(STORAGE_KEY);
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
        severity: e.severity,
        context: e.context,
        prevHash: e.prevHash,
      });
      if (expected !== e.hash) return { valid: false, firstInvalidIndex: i };
      prev = e.hash;
    }
    return { valid: true, firstInvalidIndex: null };
  }

  // ── Enhanced query ────────────────────────────────────────────────────────

  query(filter: AuditQueryFilter = {}): AuditEvent[] {
    let results = this.log.filter((e) => {
      if (filter.from !== undefined && e.timestamp < filter.from) return false;
      if (filter.to !== undefined && e.timestamp > filter.to) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.actorId && e.actorId !== filter.actorId) return false;
      if (filter.resourceId && e.resourceId !== filter.resourceId) return false;
      if (filter.resourceType && e.resourceType !== filter.resourceType) return false;
      if (filter.severity && e.severity !== filter.severity) return false;
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const matchActor = e.actorId.toLowerCase().includes(searchLower);
        const matchResource = e.resourceId.toLowerCase().includes(searchLower);
        const matchAction = e.action.toLowerCase().includes(searchLower);
        const matchMeta = JSON.stringify(e.metadata).toLowerCase().includes(searchLower);
        if (!matchActor && !matchResource && !matchAction && !matchMeta) return false;
      }
      return true;
    });

    if (filter.sortBy) {
      const order = filter.sortOrder === 'asc' ? 1 : -1;
      results = [...results].sort((a, b) => {
        const aVal = a[filter.sortBy!];
        const bVal = b[filter.sortBy!];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * order;
        }
        return (String(aVal).localeCompare(String(bVal))) * order;
      });
    }

    return results;
  }

  queryPaginated(filter: AuditQueryFilter = {}): AuditQueryResult {
    const filtered = this.query(filter);
    const total = filtered.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? total;
    const events = filtered.slice(offset, offset + limit);
    return { events, total, offset, limit };
  }

  // ── Report generation ─────────────────────────────────────────────────────

  generateReport(from: number, to: number): AuditReport {
    const events = this.query({ from, to });
    const byAction: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const e of events) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    }
    return {
      generatedAt: Date.now(),
      periodStart: from,
      periodEnd: to,
      totalEvents: events.length,
      byAction,
      bySeverity,
      events,
    };
  }

  generateComplianceReport(from: number, to: number): ComplianceAuditReport {
    const events = this.query({ from, to });
    const byAction: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byActor: Record<string, number> = {};
    const actors = new Set<string>();
    const resources = new Set<string>();
    let criticalCount = 0;
    let highCount = 0;

    for (const e of events) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      byActor[e.actorId] = (byActor[e.actorId] ?? 0) + 1;
      actors.add(e.actorId);
      resources.add(e.resourceId);
      if (e.severity === 'critical') criticalCount++;
      if (e.severity === 'high') highCount++;
    }

    const integrity = this.verify();
    const retentionDays = Math.floor(this.retention.maxAgeMs / (24 * 60 * 60 * 1000));

    return {
      generatedAt: Date.now(),
      periodStart: from,
      periodEnd: to,
      totalEvents: events.length,
      criticalEvents: criticalCount,
      highSeverityEvents: highCount,
      byAction,
      bySeverity,
      byActor,
      uniqueActors: actors.size,
      uniqueResources: resources.size,
      integrityValid: integrity.valid,
      firstInvalidIndex: integrity.firstInvalidIndex,
      exportFormats: ['json', 'csv'],
      retentionDays,
      events,
    };
  }

  // ── Compliance export ─────────────────────────────────────────────────────

  export(format: ExportFormat, from?: number, to?: number): string {
    const events = this.query({ from, to });
    if (format === 'json') return JSON.stringify(events, null, 2);

    const header =
      'id,action,actorId,resourceId,resourceType,severity,timestamp,hash,prevHash';
    const rows = events.map((e) =>
      [
        e.id,
        e.action,
        e.actorId,
        e.resourceId,
        e.resourceType,
        e.severity,
        e.timestamp,
        e.hash,
        e.prevHash,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    return [header, ...rows].join('\n');
  }

  // ── Retention policy ──────────────────────────────────────────────────────

  applyRetention(): { pruned: number; archived: number } {
    const cutoff = Date.now() - this.retention.maxAgeMs;
    const before = this.log.length;

    const toKeep = this.log.filter((e) => e.timestamp > cutoff);
    const toPrune = this.log.filter((e) => e.timestamp <= cutoff);

    this.log = toKeep;

    let archivedCount = 0;
    if (this.archivalPolicy.enabled && toPrune.length > 0) {
      const archiveEntry: AuditArchiveEntry = {
        archiveId: `archive_${Date.now()}_${randomUUID().slice(0, 8)}`,
        originalCount: toPrune.length,
        periodStart: Math.min(...toPrune.map((e) => e.timestamp)),
        periodEnd: Math.max(...toPrune.map((e) => e.timestamp)),
        archivedAt: Date.now(),
        events: toPrune,
      };
      this.archive.push(archiveEntry);
      archivedCount = toPrune.length;
    }

    return { pruned: before - toKeep.length, archived: archivedCount };
  }

  async saveArchives(): Promise<void> {
    for (const entry of this.archive) {
      const key = ARCHIVE_KEY_PREFIX + entry.archiveId;
      await AsyncStorage.setItem(key, JSON.stringify(entry));
    }
  }

  async getArchiveEntries(): Promise<AuditArchiveEntry[]> {
    const allKeys = await AsyncStorage.getAllKeys();
    const archiveKeys = allKeys.filter((k) => k.startsWith(ARCHIVE_KEY_PREFIX));
    if (archiveKeys.length === 0) return this.archive;

    const entries: AuditArchiveEntry[] = [];
    for (const key of archiveKeys) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        try {
          entries.push(JSON.parse(raw) as AuditArchiveEntry);
        } catch {
          // skip corrupt entries
        }
      }
    }
    entries.sort((a, b) => b.archivedAt - a.archivedAt);
    return entries;
  }

  // ── Alerting integration ──────────────────────────────────────────────────

  setAlertingService(service: AlertingService): void {
    this.alertingService = service;
  }

  private _dispatchAlert(event: AuditEvent): void {
    if (!this.alertingService) return;

    const alert: Alert = {
      id: `audit_${event.id}`,
      severity: AUDIT_SEVERITY_MAP[event.severity] ?? 'info',
      title: `Audit: ${event.action}`,
      message: `Actor ${event.actorId} performed ${event.action} on ${event.resourceType}:${event.resourceId}`,
      timestamp: event.timestamp,
      resolved: false,
      ruleId: 'audit-critical-event',
    };

    void this.alertingService.dispatch(alert);
  }

  // ── PII-safe query ────────────────────────────────────────────────────────

  queryWithoutPii(filter: AuditQueryFilter = {}): AuditEvent[] {
    return this.query(filter).map((e) => ({
      ...e,
      metadata: sanitizeMetadata(e.metadata),
    }));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _hash(data: object): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify(data, Object.keys(data).sort()))
      .digest('hex');
  }

  // ── Log access (for testing/inspection) ───────────────────────────────────

  getLogLength(): number {
    return this.log.length;
  }

  getArchivesLength(): number {
    return this.archive.length;
  }
}
