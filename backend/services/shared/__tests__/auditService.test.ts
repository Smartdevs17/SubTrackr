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

  // ── Integrity verification ────────────────────────────────────────────────

  it('verifies an untampered log as valid', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    expect(svc.verify()).toEqual({ valid: true, firstInvalidIndex: null });
  });

  it('detects tampering with event content', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    svc.capture('payment.charged', 'a', 'r', 'subscription');
    // Tamper with first event
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

  it('CSV escapes double-quotes in values', () => {
    svc.capture('subscription.created', 'actor"X', 'r', 'subscription');
    const out = svc.export('csv');
    expect(out).toContain('actor""X');
  });

  // ── Retention policy ──────────────────────────────────────────────────────

  it('prunes events older than retention window', () => {
    const svcShort = new AuditService(SECRET, { maxAgeMs: 0 }); // expire immediately
    svcShort.capture('subscription.created', 'a', 'r', 'subscription');
    const pruned = svcShort.applyRetention();
    expect(pruned).toBe(1);
    expect(svcShort.query({})).toHaveLength(0);
  });

  it('keeps events within retention window', () => {
    svc.capture('subscription.created', 'a', 'r', 'subscription');
    const pruned = svc.applyRetention(); // default 7 years
    expect(pruned).toBe(0);
    expect(svc.query({})).toHaveLength(1);
  });
});
