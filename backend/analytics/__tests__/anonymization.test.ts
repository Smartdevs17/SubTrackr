import { MaskStrategy, HashStrategy, TruncateStrategy, PerturbStrategy } from '../domain/anonymization/strategies';
import { AnonymizationPipeline } from '../domain/anonymization/pipeline';
import { AnonymizationController } from '../controller/anonymizationController';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build N rows that share the same quasi-identifiers (to trigger k-anon) */
function makeRows(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => ({
    userId: `user-${i}`,
    email: `user${i}@example.com`,
    name: `User ${i}`,
    ipAddress: '192.168.1.100',
    createdAt: '2025-01-15',
    country: 'US',
    planId: 'plan-basic',
    amount: 9.99,
    ...overrides,
  }));
}

// ---------------------------------------------------------------------------
// Strategy tests
// ---------------------------------------------------------------------------

describe('MaskStrategy', () => {
  const strategy = new MaskStrategy();

  test('masks email: preserves first char of local + domain', () => {
    expect(strategy.apply('john@example.com')).toBe('j***@example.com');
  });

  test('masks single-char local email', () => {
    const result = strategy.apply('a@example.com');
    expect(result).toMatch(/^a\*+@example\.com$/);
  });

  test('masks non-email string', () => {
    const result = strategy.apply('hello');
    expect(result).toMatch(/^h\*+$/);
  });

  test('returns empty string unchanged', () => {
    expect(strategy.apply('')).toBe('');
  });
});

describe('HashStrategy', () => {
  const strategy = new HashStrategy();

  test('returns 64-char hex string', () => {
    const result = strategy.apply('test@example.com', 'salt');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  test('different salt → different hash', () => {
    const a = strategy.apply('alice', 'salt1');
    const b = strategy.apply('alice', 'salt2');
    expect(a).not.toBe(b);
  });

  test('same value + salt → same hash (deterministic)', () => {
    expect(strategy.apply('alice', 'fixed')).toBe(strategy.apply('alice', 'fixed'));
  });

  test('hashed value does not contain original', () => {
    const result = strategy.apply('plaintext@example.com', 'anysalt');
    expect(result).not.toContain('plaintext');
    expect(result).not.toContain('@');
  });
});

describe('TruncateStrategy', () => {
  const strategy = new TruncateStrategy();

  test('truncates IPv4: last octet replaced with *', () => {
    expect(strategy.apply('192.168.1.100')).toBe('192.168.1.*');
  });

  test('truncates another IPv4', () => {
    expect(strategy.apply('10.0.0.1')).toBe('10.0.0.*');
  });

  test('returns empty string unchanged', () => {
    expect(strategy.apply('')).toBe('');
  });

  test('truncated IP no longer contains the last octet', () => {
    expect(strategy.apply('203.0.113.42')).not.toContain('42');
  });
});

describe('PerturbStrategy', () => {
  const strategy = new PerturbStrategy(3);

  test('returns a valid date string', () => {
    const result = strategy.apply('2025-06-15', 'salt');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('perturbed date is within ±3 days of original', () => {
    const original = new Date('2025-06-15');
    const result = strategy.apply('2025-06-15', 'somesalt');
    const perturbed = new Date(result);
    const diffDays = Math.abs((perturbed.getTime() - original.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(3);
  });

  test('deterministic: same input + salt → same output', () => {
    expect(strategy.apply('2025-06-15', 'fixed')).toBe(strategy.apply('2025-06-15', 'fixed'));
  });

  test('returns invalid date values unchanged', () => {
    expect(strategy.apply('not-a-date', 'salt')).toBe('not-a-date');
  });
});

// ---------------------------------------------------------------------------
// AnonymizationPipeline: export levels
// ---------------------------------------------------------------------------

describe('AnonymizationPipeline – full level', () => {
  const pipeline = new AnonymizationPipeline();

  test('full export passes rows through unchanged', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'full');
    expect(out[0].email).toBe('user0@example.com');
    expect(out[0].name).toBe('User 0');
  });

  test('full export has no transformed fields', () => {
    const { transformedFields } = pipeline.run(makeRows(10), 'full');
    expect(transformedFields).toHaveLength(0);
  });
});

describe('AnonymizationPipeline – pseudonymized level', () => {
  const pipeline = new AnonymizationPipeline();

  test('email is masked', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'pseudonymized');
    expect(out[0].email).not.toBe('user0@example.com');
    expect(String(out[0].email)).toContain('@example.com');
    expect(String(out[0].email)).toMatch(/^\w\*+@example\.com$/);
  });

  test('name is hashed', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'pseudonymized');
    expect(String(out[0].name)).toHaveLength(64);
  });

  test('non-PII field (amount) passes through', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'pseudonymized');
    expect(out[0].amount).toBe(9.99);
  });

  test('quasi-identifiers pass through in pseudonymized mode', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'pseudonymized');
    // country and planId are quasi, not direct PII → unchanged
    expect(out[0].country).toBe('US');
    expect(out[0].planId).toBe('plan-basic');
  });
});

describe('AnonymizationPipeline – anonymized level', () => {
  const pipeline = new AnonymizationPipeline();

  test('email is masked', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'anonymized');
    expect(String(out[0].email)).toMatch(/^\w\*+@example\.com$/);
  });

  test('name is hashed', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'anonymized');
    expect(String(out[0].name)).toHaveLength(64);
  });

  test('IP is truncated', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'anonymized');
    expect(out[0].ipAddress).toBe('192.168.1.*');
  });

  test('date is perturbed (within ±3 days)', () => {
    const rows = makeRows(10);
    const { rows: out } = pipeline.run(rows, 'anonymized');
    const original = new Date('2025-01-15');
    const perturbed = new Date(String(out[0].createdAt));
    const diffDays = Math.abs((perturbed.getTime() - original.getTime()) / 86_400_000);
    expect(diffDays).toBeLessThanOrEqual(3);
  });

  test('export salt is discarded for anonymized exports', () => {
    const { exportSalt } = pipeline.run(makeRows(10), 'anonymized');
    expect(exportSalt).toBe('[discarded]');
  });

  test('export salt is retained for pseudonymized exports', () => {
    const { exportSalt } = pipeline.run(makeRows(10), 'pseudonymized');
    expect(exportSalt).not.toBe('[discarded]');
    expect(exportSalt).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// k-anonymity checks
// ---------------------------------------------------------------------------

describe('k-anonymity validation', () => {
  const pipeline = new AnonymizationPipeline();

  test('no warning when every quasi-id group has ≥ 5 members', () => {
    // 10 rows, all identical quasi-identifiers → one group of 10 → k=10 ≥ 5
    const rows = makeRows(10);
    const { warnings } = pipeline.run(rows, 'full');
    const kWarn = warnings.filter((w) => w.includes('k-anonymity'));
    expect(kWarn).toHaveLength(0);
  });

  test('warning when a group has fewer than 5 members', () => {
    // Each row has a unique country → each group size = 1 < 5
    const rows = makeRows(10, {}).map((r, i) => ({ ...r, country: `country-${i}` }));
    const { warnings } = pipeline.run(rows, 'full');
    const kWarn = warnings.find((w) => w.includes('k-anonymity'));
    expect(kWarn).toBeDefined();
  });

  test('k-anonymity warning contains violation count', () => {
    const rows = makeRows(3, { country: 'unique-group' });
    const { warnings } = pipeline.run(rows, 'anonymized');
    const kWarn = warnings.find((w) => w.includes('k-anonymity'));
    expect(kWarn).toMatch(/fewer than 5/);
  });
});

// ---------------------------------------------------------------------------
// Re-identification risk: small dataset
// ---------------------------------------------------------------------------

describe('Re-identification risk – small dataset', () => {
  const pipeline = new AnonymizationPipeline();

  test('warning issued for datasets with < 20 records', () => {
    const rows = makeRows(5);
    const { warnings } = pipeline.run(rows, 'anonymized');
    const w = warnings.find((msg) => msg.includes('re-identification'));
    expect(w).toBeDefined();
  });

  test('no small-dataset warning for ≥ 20 records', () => {
    const rows = makeRows(25);
    const { warnings } = pipeline.run(rows, 'anonymized');
    const w = warnings.find((msg) => msg.includes('re-identification'));
    expect(w).toBeUndefined();
  });

  test('warning includes record count', () => {
    const { warnings } = pipeline.run(makeRows(7), 'anonymized');
    const w = warnings.find((msg) => msg.includes('re-identification'));
    expect(w).toContain('7 records');
  });

  test('empty dataset produces no small-dataset warning', () => {
    const { warnings } = pipeline.run([], 'anonymized');
    const w = warnings.find((msg) => msg.includes('re-identification'));
    expect(w).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

describe('AnonymizationPipeline – preview', () => {
  const pipeline = new AnonymizationPipeline();

  test('preview returns at most 5 rows', () => {
    const result = pipeline.preview(makeRows(100), 'anonymized');
    expect(result.length).toBe(5);
  });

  test('preview applies anonymization', () => {
    const result = pipeline.preview(makeRows(10), 'anonymized');
    expect(String(result[0].email)).not.toBe('user0@example.com');
  });
});

// ---------------------------------------------------------------------------
// Controller: authorization
// ---------------------------------------------------------------------------

describe('AnonymizationController – authorization', () => {
  const controller = new AnonymizationController();
  const rows = makeRows(25);

  test('admin can request full export', () => {
    expect(() => controller.export(rows, { level: 'full', requestedBy: 'admin-1' }, 'admin')).not.toThrow();
  });

  test('analytics role cannot request full export', () => {
    expect(() => controller.export(rows, { level: 'full', requestedBy: 'analyst-1' }, 'analytics')).toThrow(/not permitted/);
  });

  test('third-party role can only request anonymized export', () => {
    expect(() => controller.export(rows, { level: 'pseudonymized', requestedBy: 'ext-1' }, 'third-party')).toThrow(/not permitted/);
    expect(() => controller.export(rows, { level: 'anonymized', requestedBy: 'ext-1' }, 'third-party')).not.toThrow();
  });

  test('analytics role can request pseudonymized or anonymized', () => {
    expect(() => controller.export(rows, { level: 'pseudonymized', requestedBy: 'a' }, 'analytics')).not.toThrow();
    expect(() => controller.export(rows, { level: 'anonymized', requestedBy: 'a' }, 'analytics')).not.toThrow();
  });
});

describe('AnonymizationController – audit log', () => {
  const controller = new AnonymizationController();

  test('audit log is populated after export', () => {
    controller.export(makeRows(25), { level: 'anonymized', requestedBy: 'tester', label: 'test run' }, 'admin');
    const log = controller.getAuditLog();
    const entry = log.find((e) => e.label === 'test run');
    expect(entry).toBeDefined();
    expect(entry!.level).toBe('anonymized');
    expect(entry!.requestedBy).toBe('tester');
    expect(entry!.rowCount).toBe(25);
    expect(entry!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('audit entry includes transformed fields', () => {
    controller.export(makeRows(25), { level: 'anonymized', requestedBy: 'tester2' }, 'admin');
    const log = controller.getAuditLog();
    const entry = log.find((e) => e.requestedBy === 'tester2');
    expect(entry!.transformedFields).toContain('email');
    expect(entry!.transformedFields).toContain('name');
  });
});

describe('AnonymizationController – getPiiFieldRegistry', () => {
  const controller = new AnonymizationController();

  test('returns all PII field definitions', () => {
    const fields = controller.getPiiFieldRegistry();
    expect(fields.length).toBeGreaterThan(0);
    const emailDef = fields.find((f) => f.field === 'email');
    expect(emailDef).toBeDefined();
    expect(emailDef!.strategy).toBe('mask');
  });
});
