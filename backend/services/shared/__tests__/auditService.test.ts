import { AlertingService } from '../../notification/alerting';
import { AuditService } from '../auditService';

const SECRET = 'test-secret-key';

let svc: AuditService;
beforeEach(() => {
  svc = new AuditService(SECRET);
});

describe('AuditService', () => {
  // ── Construction ──────────────────────────────────────────────────────────

  it('throws when constructed with empty secret', () => {
    expect(() => new AuditService('')).toThrow('non-empty HMAC secret');
  });

  // ── Event capture ─────────────────────────────────────────────────────────

  it('captures an event with all required fields', () => {
    const e = svc.capture('subscription.created', 'actor-1', 'sub-1', 'subscription');
    expect(e.id).toBeTruthy();
    expect(e.action).toBe('subscription.created');
    expect(e.actorId).toBe('actor-1');
    expect(e.resourceId).toBe('sub-1');
    expect(e.hash).toHaveLength(64);
    expect(e.prevHash).toBe('0'.repeat(64)); // genesis
  });

  it('chains prevHash to previous event hash', () => {
    const e1 = svc.capture('subscription.created', 'actor-1', 'sub-1', 'subscription');
    const e2 = svc.capture('payment.charged', 'actor-1', 'sub-1', 'subscription');
    expect(e2.prevHash).toBe(e1.hash);
  });

  it('stores metadata on the event', () => {
    const e = svc.capture('payment.charged', 'actor-1', 'sub-1', 'subscription', {
      amount: 10,
      currency: 'USD',
    });
    expect(e.metadata).toEqual({ amount: 10, currency: 'USD' });
  });

  it('captures severity and context', () => {
    const e = svc.capture(
      'auth.failed',
      'actor-1',
      'sess-1',
      'session',
      { attempt: 3 },
      'critical',
      { ipAddress: '192.168.1.1', sessionId: 'sess-1' }
    );
    expect(e.severity).toBe('critical');
    expect(e.context?.ipAddress).toBe('192.168.1.1');
    expect(e.context?.sessionId).toBe('sess-1');
  });

  it('defaults severity to low', () => {
    const e = svc.capture('subscription.created', 'a', 'r', 'subscription');
    expect(e.severity).toBe('low');
  });

  // ── Integrity verification ────────────────────────────────────────────────

  it('verifies an untampered log as valid', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    expect(svc.verify()).toEqual({ valid: true, firstInvalidIndex: null });
  });

  it('detects tampering with event content', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    (svc as unknown as { log: { action: string }[] }).log[0].action = 'admin.action';
    const result = svc.verify();
    expect(result.valid).toBe(false);
    expect(result.firstInvalidIndex).toBe(0);
  });

  it('detects broken chain (prevHash mismatch)', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    (svc as unknown as { log: { prevHash: string }[] }).log[1].prevHash = 'deadbeef';
    expect(svc.verify().valid).toBe(false);
    expect(svc.verify().firstInvalidIndex).toBe(1);
  });

  it('verifies empty log as valid', () => {
    expect(svc.verify()).toEqual({ valid: true, firstInvalidIndex: null });
  });

  // ── Aggregation & query ───────────────────────────────────────────────────

  it('queries by action', () => {
    svc.capture('subscription.created', 'a', 'r1', 'subscription');
    svc.capture('payment.charged', 'a', 'r1', 'subscription');
    svc.capture('payment.charged', 'a', 'r2', 'subscription');
    expect(svc.query({ action: 'payment.charged' })).toHaveLength(2);
  });

  it('queries by actorId', () => {
    svc.capture('subscription.created', 'actor-A', 'r1', 'subscription');
    svc.capture('subscription.created', 'actor-B', 'r2', 'subscription');
    expect(svc.query({ actorId: 'actor-A' })).toHaveLength(1);
  });

  it('queries by time range', () => {
    const t0 = Date.now();
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    const t1 = Date.now();
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    const t2 = Date.now();
    const results = svc.query({ from: t0, to: t1 });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((e) => e.timestamp >= t0 && e.timestamp <= t1)).toBe(true);
    void t2;
  });

  it('queries by resourceType', () => {
    svc.capture('subscription.created', 'a', 'r1', 'subscription');
    svc.capture('plan.updated', 'a', 'p1', 'plan');
    expect(svc.query({ resourceType: 'plan' })).toHaveLength(1);
  });

  it('queries by severity', () => {
    svc.capture('auth.failed', 'a', 'r', 'session', {}, 'critical');
    svc.capture('subscription.created', 'a', 'r', 'subscription', {}, 'low');
    expect(svc.query({ severity: 'critical' })).toHaveLength(1);
  });

  it('queries with text search', () => {
    svc.capture('subscription.created', 'user-abc', 'sub-123', 'subscription');
    svc.capture('payment.charged', 'user-xyz', 'sub-456', 'subscription');
    expect(svc.query({ search: 'abc' })).toHaveLength(1);
    expect(svc.query({ search: 'sub-' })).toHaveLength(2);
  });

  it('queries with combined filters', () => {
    svc.capture('subscription.created', 'a', 'r1', 'subscription', {}, 'low');
    svc.capture('payment.charged', 'a', 'r1', 'subscription', {}, 'low');
    svc.capture('payment.charged', 'b', 'r2', 'subscription', {}, 'high');
    const r = svc.query({ actorId: 'a', action: 'payment.charged' });
    expect(r).toHaveLength(1);
  });

  // ── Paginated query ───────────────────────────────────────────────────────

  it('queryPaginated returns paginated results', () => {
    for (let i = 0; i < 10; i++) {
      svc.capture('subscription.created', 'a', `r${i}`, 'subscription');
    }
    const page1 = svc.queryPaginated({ offset: 0, limit: 3 });
    expect(page1.events).toHaveLength(3);
    expect(page1.total).toBe(10);
    expect(page1.offset).toBe(0);
    expect(page1.limit).toBe(3);

    const page2 = svc.queryPaginated({ offset: 3, limit: 3 });
    expect(page2.events).toHaveLength(3);
    expect(page2.total).toBe(10);
  });

  // ── Sorting ───────────────────────────────────────────────────────────────

  it('sorts by timestamp descending by default', () => {
    const e1 = svc.capture('subscription.created', 'a', 'r1', 'subscription');
    const e2 = svc.capture('payment.charged', 'a', 'r2', 'subscription');
    const r = svc.query({ sortBy: 'timestamp', sortOrder: 'asc' });
    expect(r[0].id).toBe(e1.id);
    expect(r[1].id).toBe(e2.id);
  });

  // ── Report generation ─────────────────────────────────────────────────────

  it('generates a report with correct totals', () => {
    const from = Date.now();
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    const to = Date.now();
    const report = svc.generateReport(from, to);
    expect(report.totalEvents).toBe(3);
    expect(report.byAction['payment.charged']).toBe(2);
    expect(report.byAction['subscription.created']).toBe(1);
  });

  it('report includes severity breakdown', () => {
    svc.capture('auth.failed', 'a', 'r', 'session', {}, 'critical');
    svc.capture('subscription.created', 'a', 'r', 'subscription', {}, 'low');
    const from = Date.now() - 1000;
    const to = Date.now() + 1000;
    const report = svc.generateReport(from, to);
    expect(report.bySeverity['critical']).toBe(1);
    expect(report.bySeverity['low']).toBe(1);
  });

  // ── Compliance report ─────────────────────────────────────────────────────

  it('generates a compliance report with integrity check', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'b', 'r', 'subscription', {}, 'high');
    const from = Date.now() - 1000;
    const to = Date.now() + 1000;
    const report = svc.generateComplianceReport(from, to);
    expect(report.totalEvents).toBe(2);
    expect(report.uniqueActors).toBe(2);
    expect(report.highSeverityEvents).toBe(1);
    expect(report.criticalEvents).toBe(0);
    expect(report.integrityValid).toBe(true);
    expect(report.retentionDays).toBeGreaterThan(0);
    expect(report.exportFormats).toEqual(['json', 'csv']);
  });

  // ── Compliance export ─────────────────────────────────────────────────────

  it('exports valid JSON', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    const out = svc.export('json');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].action).toBe('subscription.created');
  });

  it('exports valid CSV with header row', () => {
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    const out = svc.export('csv');
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^id,action/);
    expect(lines).toHaveLength(2); // header + 1 row
  });

  it('sanitizer strips quotes from actorId before CSV export', () => {
    svc.capture('subscription.created', 'actor"X', 'r', 'subscription');
    const e = svc.query({})[0];
    expect(e.actorId).toBe('actorX');
  });

  // ── Retention policy ──────────────────────────────────────────────────────

  it('prunes events older than retention window', () => {
    const svcShort = new AuditService(SECRET, { maxAgeMs: 0 });
    svcShort.capture('subscription.created', 'a', 'r', 'subscription');
    const result = svcShort.applyRetention();
    expect(result.pruned).toBe(1);
    expect(svcShort.query({})).toHaveLength(0);
  });

  it('keeps events within retention window', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    const result = svc.applyRetention();
    expect(result.pruned).toBe(0);
    expect(svc.query({})).toHaveLength(1);
  });

  // ── Archival ──────────────────────────────────────────────────────────────

  it('archives pruned events when archival is enabled', () => {
    const svcArchive = new AuditService(
      SECRET,
      { maxAgeMs: 0 },
      { enabled: true, archiveAfterMs: 0 }
    );
    svcArchive.capture('subscription.created', 'a', 'r', 'subscription');
    const result = svcArchive.applyRetention();
    expect(result.pruned).toBe(1);
    expect(result.archived).toBe(1);
    expect(svcArchive.getArchivesLength()).toBe(1);
  });

  it('does not archive when archival is disabled', () => {
    const svcNoArchive = new AuditService(
      SECRET,
      { maxAgeMs: 0 },
      { enabled: false, archiveAfterMs: 0 }
    );
    svcNoArchive.capture('subscription.created', 'a', 'r', 'subscription');
    const result = svcNoArchive.applyRetention();
    expect(result.pruned).toBe(1);
    expect(result.archived).toBe(0);
    expect(svcNoArchive.getArchivesLength()).toBe(0);
  });

  // ── PII scrubbing ─────────────────────────────────────────────────────────

  it('redacts PII-like metadata keys', () => {
    const e = svc.capture('subscription.created', 'a', 'r', 'subscription', {
      email: 'user@example.com',
      creditCard: '4111111111111111',
      amount: 10,
    });
    expect(e.metadata['email']).toBe('[REDACTED]');
    expect(e.metadata['creditCard']).toBe('[REDACTED]');
    expect(e.metadata['amount']).toBe(10);
  });

  it('redacts PII values in metadata strings', () => {
    const e = svc.capture('subscription.created', 'a', 'r', 'subscription', {
      note: 'contact at user@example.com',
    });
    expect(e.metadata['note']).toContain('[REDACTED_EMAIL]');
    expect(e.metadata['note']).not.toContain('user@example.com');
  });

  it('sanitizes actorId and resourceId for log injection prevention', () => {
    const e = svc.capture(
      'subscription.created',
      'user\n<script>alert("xss")</script>',
      'sub\r\n1',
      'subscription'
    );
    expect(e.actorId).not.toContain('\n');
    expect(e.resourceId).not.toContain('\r');
  });

  // ── Max log size ──────────────────────────────────────────────────────────

  it('enforces max log size by dropping oldest events', () => {
    const smallSvc = new AuditService(SECRET, undefined, undefined, { maxLogSize: 3 });
    smallSvc.capture('subscription.created', 'a', 'r', 't');
    smallSvc.capture('subscription.cancelled', 'a', 'r', 't');
    smallSvc.capture('payment.charged', 'a', 'r', 't');
    smallSvc.capture('payment.failed', 'a', 'r', 't');
    expect(smallSvc.getLogLength()).toBe(3);
  });

  // ── PII-safe query ────────────────────────────────────────────────────────

  it('queryWithoutPii redacts PII fields', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription', {
      email: 'user@test.com',
      name: 'Test',
    });
    const results = svc.queryWithoutPii({});
    expect(results[0].metadata['email']).toBe('[REDACTED]');
  });

  // ── Alerting integration ──────────────────────────────────────────────────

  it('dispatches alert for critical severity events when alerting service is set', () => {
    const alerting = new AlertingService();
    const dispatchSpy = jest.spyOn(alerting, 'dispatch');
    svc.setAlertingService(alerting);
    svc.capture('auth.failed', 'a', 'r', 'session', {}, 'critical');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        ruleId: 'audit-critical-event',
      })
    );
  });

  it('does not dispatch alert for low severity events', () => {
    const alerting = new AlertingService();
    const dispatchSpy = jest.spyOn(alerting, 'dispatch');
    svc.setAlertingService(alerting);
    svc.capture('subscription.created', 'a', 'r', 'subscription', {}, 'low');
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // ── Alerting via constructor ──────────────────────────────────────────────

  it('accepts alerting service via constructor options', () => {
    const alerting = new AlertingService();
    const dispatchSpy = jest.spyOn(alerting, 'dispatch');
    const svcWithAlerting = new AuditService(SECRET, undefined, undefined, { alertingService: alerting });
    svcWithAlerting.capture('security.threat_detected', 'a', 'r', 'system', {}, 'critical');
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });
});
