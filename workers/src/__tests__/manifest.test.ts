/**
 * workers/src/__tests__/manifest.test.ts
 *
 * Issue #2261 — unit coverage for typed job manifests, runtime schemas and the
 * in-memory registry. Pure TypeScript: no network, database or ambient state.
 */

import {
  AUDIT_FLUSH_MANIFEST,
  BILLING_SHIFT_MANIFEST,
  BUILTIN_JOB_MANIFESTS,
  DEFAULT_MANIFEST_REGISTRY_CONFIG,
  ManifestError,
  ManifestErrorCode,
  SchemaNode,
  SchemaType,
  arr,
  assertSchema,
  bool,
  createDefaultJobRegistry,
  createJobRegistry,
  date,
  defineJob,
  isSchema,
  noopManifestLogger,
  noopManifestMetrics,
  num,
  obj,
  str,
  validateInput,
  validateManifest,
  validateManifestRegistryConfig,
  validateOutput,
  validateSchema,
  type JobManifest,
} from '../manifest.ts';

/** Minimal valid manifest used as a fixture across registry tests. */
function sampleManifest(name = 'sample-job'): JobManifest {
  return defineJob({
    name,
    description: 'Sample job',
    schedule: '0 * * * *',
    input: obj({ id: str(), count: num().optional() }),
    output: obj({ ok: bool() }),
    handler: 'workers/src/jobs/sample.ts#run',
    retries: 1,
    timeoutMs: 5000,
    tags: Object.freeze(['sample']),
  });
}

describe('manifest schema builders', () => {
  it('creates primitive schemas with stable type tags', () => {
    expect(str().type).toBe(SchemaType.STRING);
    expect(num().type).toBe(SchemaType.NUMBER);
    expect(bool().type).toBe(SchemaType.BOOLEAN);
    expect(date().type).toBe(SchemaType.DATE);
  });

  it('supports optional and describe as immutable chained builders', () => {
    const base = str();
    const optional = base.optional();
    const described = optional.describe('subscription id');
    expect(base.isOptional).toBe(false);
    expect(optional.isOptional).toBe(true);
    expect(described.description).toBe('subscription id');
    expect(Object.isFrozen(base)).toBe(true);
    expect(Object.isFrozen(described)).toBe(true);
    expect(described.type).toBe(SchemaType.STRING);
  });

  it('builds object and array schemas compositionally', () => {
    const schema = obj({ items: arr(obj({ id: str(), active: bool().optional() })) });
    expect(schema.type).toBe(SchemaType.OBJECT);
    expect(schema.shape && schema.shape.items.type).toBe(SchemaType.ARRAY);
    expect(schema.shape && schema.shape.items.item && schema.shape.items.item.type).toBe(SchemaType.OBJECT);
    expect(isSchema(schema)).toBe(true);
  });

  it('rejects malformed object and array schema definitions', () => {
    expect(() => obj(null as unknown as Record<string, unknown>)).toThrow(ManifestErrorCode.INVALID_SCHEMA);
    expect(() => obj({ bad: 'not-a-schema' } as unknown as Record<string, unknown>)).toThrow(
      ManifestErrorCode.INVALID_SCHEMA
    );
    expect(() => arr('not-a-schema' as unknown as ReturnType<typeof str>)).toThrow(
      ManifestErrorCode.INVALID_SCHEMA
    );
    expect(isSchema({ type: 'string' })).toBe(false);
  });
});

describe('validateSchema happy paths', () => {
  it('validates primitive values', () => {
    expect(validateSchema(str(), 'hello')).toEqual({ ok: true, value: 'hello' });
    expect(validateSchema(num(), 42)).toEqual({ ok: true, value: 42 });
    expect(validateSchema(bool(), false)).toEqual({ ok: true, value: false });
  });

  it('normalizes ISO strings and Date instances to Date values', () => {
    const fromString = validateSchema(date(), '2026-11-25T00:00:00.000Z');
    expect(fromString.ok).toBe(true);
    if (fromString.ok) expect(fromString.value.toISOString()).toBe('2026-11-25T00:00:00.000Z');
    const now = new Date('2026-11-25T00:00:00.000Z');
    const fromDate = validateSchema(date(), now);
    expect(fromDate.ok).toBe(true);
    if (fromDate.ok) expect(fromDate.value).toBe(now);
  });

  it('validates nested objects, arrays and optional fields', () => {
    const schema = obj({
      id: str(),
      items: arr(obj({ sku: str(), qty: num(), note: str().optional() })),
      enabled: bool().optional(),
    });
    const result = validateSchema(schema, {
      id: 'sub-1',
      items: [
        { sku: 'a', qty: 2 },
        { sku: 'b', qty: 1, note: 'gift' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('sub-1');
      expect(result.value.items).toHaveLength(2);
      expect(result.value.items[1].note).toBe('gift');
      expect('enabled' in result.value).toBe(false);
    }
  });

  it('treats missing optional values as valid and ignores unknown keys', () => {
    expect(validateSchema(str().optional(), undefined)).toEqual({ ok: true, value: undefined });
    const result = validateSchema(obj({ id: str() }), { id: 'x', extra: 'ignored' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ id: 'x' });
  });

  it('validates an empty array and an empty object shape', () => {
    expect(validateSchema(arr(num()), [])).toEqual({ ok: true, value: [] });
    expect(validateSchema(obj({}), { anything: 1 })).toEqual({ ok: true, value: {} });
  });
});

describe('validateSchema failure modes', () => {
  it('reports primitive type mismatches with paths and actual types', () => {
    const result = validateSchema(str(), 123);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].path).toBe('$');
      expect(result.issues[0].expected).toBe('string');
      expect(result.issues[0].actual).toBe('number');
      expect(result.issues[0].code).toBe('TYPE_MISMATCH');
    }
  });

  it('rejects NaN and infinity as non-finite numbers', () => {
    expect(validateSchema(num(), Number.NaN).ok).toBe(false);
    expect(validateSchema(num(), Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it('reports missing required object fields', () => {
    const result = validateSchema(obj({ id: str(), qty: num() }), { id: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].code).toBe('REQUIRED');
      expect(result.issues[0].path).toBe('$.qty');
    }
  });

  it('reports indexed array element failures and nested paths', () => {
    const result = validateSchema(obj({ items: arr(obj({ sku: str() })) }), {
      items: [{ sku: 'ok' }, { sku: 7 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].path).toBe('$.items[1].sku');
    }
  });

  it('collects multiple issues in one pass', () => {
    const result = validateSchema(obj({ a: str(), b: num(), c: bool() }), { a: 1, b: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toHaveLength(3);
  });

  it('rejects invalid dates, arrays and object shape mismatches', () => {
    expect(validateSchema(date(), 'not-a-date').ok).toBe(false);
    expect(validateSchema(date(), new Date('invalid')).ok).toBe(false);
    expect(validateSchema(date(), null).ok).toBe(false);
    expect(validateSchema(arr(str()), { not: 'an array' }).ok).toBe(false);
    expect(validateSchema(obj({ id: str() }), ['array']).ok).toBe(false);
    expect(validateSchema(str().optional(), null).ok).toBe(false);
  });

  it('throws INVALID_SCHEMA for malformed schemas and UNKNOWN_TYPE for unknown kinds', () => {
    expect(() => validateSchema(null as unknown as ReturnType<typeof str>, 'x')).toThrow(
      ManifestErrorCode.INVALID_SCHEMA
    );
    const bogus = new SchemaNode({ type: 'symbol' as SchemaType });
    expect(() => validateSchema(bogus, 'x')).toThrow(ManifestErrorCode.UNKNOWN_TYPE);
  });

  it('assertSchema returns the value or throws VALIDATION_FAILED with diagnostics', () => {
    const schema = obj({ id: str() });
    expect(assertSchema(schema, { id: 'a' })).toEqual({ id: 'a' });
    try {
      assertSchema(schema, { id: 1 }, 'job input');
      throw new Error('expected assertSchema to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestError);
      const failure = error as ManifestError;
      expect(failure.code).toBe(ManifestErrorCode.VALIDATION_FAILED);
      expect(failure.details.path).toBe('$.id');
      expect(failure.message).toContain('job input');
      expect(failure.details.issues).toHaveLength(1);
    }
  });
});

describe('manifest definition and validation', () => {
  it('defineJob is an identity helper that preserves the manifest', () => {
    const manifest = sampleManifest();
    expect(defineJob(manifest)).toBe(manifest);
    expect(manifest.name).toBe('sample-job');
  });

  it('validateManifest accepts well-formed manifests', () => {
    expect(validateManifest(sampleManifest())).toBeInstanceOf(Object);
    expect(() => validateManifest(sampleManifest())).not.toThrow();
  });

  it('rejects missing or malformed identity fields', () => {
    expect(() => validateManifest(null as unknown as JobManifest)).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), name: '' })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), name: 'bad name' })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), handler: '  ' })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
  });

  it('rejects invalid optional fields and schemas', () => {
    expect(() => validateManifest({ ...sampleManifest(), schedule: '' })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), description: 5 } as unknown as JobManifest)).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), retries: 11 })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), timeoutMs: 0 })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), tags: ['ok', ''] })).toThrow(
      ManifestErrorCode.INVALID_MANIFEST
    );
    expect(() => validateManifest({ ...sampleManifest(), input: {} } as unknown as JobManifest)).toThrow(
      ManifestErrorCode.INVALID_SCHEMA
    );
    expect(() => validateManifest({ ...sampleManifest(), output: {} } as unknown as JobManifest)).toThrow(
      ManifestErrorCode.INVALID_SCHEMA
    );
  });

  it('ships valid, dependency-free built-in manifests', () => {
    expect(BUILTIN_JOB_MANIFESTS).toHaveLength(2);
    expect(() => validateManifest(BILLING_SHIFT_MANIFEST)).not.toThrow();
    expect(() => validateManifest(AUDIT_FLUSH_MANIFEST)).not.toThrow();
    expect(BILLING_SHIFT_MANIFEST.handler).toContain('billingShift.ts');
    expect(BILLING_SHIFT_MANIFEST.retries).toBe(3);
    expect(AUDIT_FLUSH_MANIFEST.tags).toContain('audit');
  });

  it('validates declared input and output schemas at runtime', () => {
    expect(validateInput(sampleManifest(), { id: 'x' })).toEqual({ id: 'x' });
    expect(validateOutput(sampleManifest(), { ok: true })).toEqual({ ok: true });
    expect(() => validateInput(sampleManifest(), { id: 1 })).toThrow(
      ManifestErrorCode.VALIDATION_FAILED
    );
    expect(() => validateOutput(sampleManifest(), { ok: 'yes' })).toThrow(
      ManifestErrorCode.VALIDATION_FAILED
    );
    expect(validateOutput(defineJob({ name: 'no-output', input: str(), handler: 'x' }), 1)).toBeUndefined();
  });
});

describe('job registry', () => {
  it('registers, looks up, lists and freezes manifests', () => {
    const registry = createJobRegistry();
    const manifest = sampleManifest();
    registry.register(manifest);
    expect(registry.has('sample-job')).toBe(true);
    expect(registry.has('missing')).toBe(false);
    expect(registry.get('sample-job')).toBeInstanceOf(Object);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.size).toBe(1);
    expect(registry.list()).toHaveLength(1);
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(registry.get('sample-job'))).toBe(true);
    expect(Object.isFrozen(registry.get('sample-job')?.tags)).toBe(true);
    expect(registry.get('sample-job')).not.toBe(manifest);
  });

  it('rejects duplicate names by default and replaces them when configured', () => {
    const registry = createJobRegistry();
    registry.register(sampleManifest());
    expect(() => registry.register(sampleManifest())).toThrow(ManifestErrorCode.DUPLICATE_JOB);
    const permissive = createJobRegistry({ allowDuplicates: true });
    permissive.register(sampleManifest());
    permissive.register({ ...sampleManifest(), handler: 'replacement.ts#run' });
    expect(permissive.size).toBe(1);
    expect(permissive.get('sample-job')?.handler).toBe('replacement.ts#run');
  });

  it('enforces the maxJobs cap and throws for unknown lookups', () => {
    const registry = createJobRegistry({ maxJobs: 1 });
    registry.register(sampleManifest('one'));
    expect(() => registry.register(sampleManifest('two'))).toThrow(ManifestErrorCode.INVALID_CONFIG);
    expect(() => registry.getOrThrow('missing')).toThrow(ManifestErrorCode.UNKNOWN_JOB);
    expect(registry.getOrThrow('one').name).toBe('one');
  });

  it('registers batches through registerAll', () => {
    const registry = createJobRegistry();
    const registered = registry.registerAll([sampleManifest('a'), sampleManifest('b')]);
    expect(registered).toHaveLength(2);
    expect(registry.size).toBe(2);
    expect(registry.list().map((m) => m.name)).toEqual(['a', 'b']);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(() => registry.registerAll('nope' as unknown as JobManifest[])).toThrow(
      ManifestErrorCode.INVALID_INPUT
    );
  });

  it('validateAll reports every registered manifest as valid', () => {
    const registry = createJobRegistry();
    registry.registerAll([sampleManifest('a'), sampleManifest('b')]);
    const report = registry.validateAll();
    expect(report.ok).toBe(true);
    expect(report.total).toBe(2);
    expect(report.valid).toEqual(['a', 'b']);
    expect(report.invalid).toHaveLength(0);
    expect(Object.isFrozen(report)).toBe(true);
  });

  it('validateAll reports injected invalid manifests without throwing', () => {
    const registry = createJobRegistry();
    const bad = { ...sampleManifest('broken'), retries: -1 };
    const report = registry.validateAll([sampleManifest('good'), bad]);
    expect(report.ok).toBe(false);
    expect(report.total).toBe(2);
    expect(report.valid).toEqual(['good']);
    expect(report.invalid).toHaveLength(1);
    expect(report.invalid[0].name).toBe('broken');
    expect(report.invalid[0].code).toBe(ManifestErrorCode.INVALID_MANIFEST);
    expect(() => registry.validateAll('nope' as unknown as JobManifest[])).toThrow(
      ManifestErrorCode.INVALID_INPUT
    );
  });

  it('validates and freezes registry configuration', () => {
    expect(DEFAULT_MANIFEST_REGISTRY_CONFIG.allowDuplicates).toBe(false);
    expect(DEFAULT_MANIFEST_REGISTRY_CONFIG.maxJobs).toBe(500);
    expect(validateManifestRegistryConfig({ maxJobs: 7 }).maxJobs).toBe(7);
    expect(Object.isFrozen(validateManifestRegistryConfig())).toBe(true);
    expect(() => createJobRegistry({ maxJobs: 0 })).toThrow(ManifestErrorCode.INVALID_CONFIG);
    expect(() => createJobRegistry({ allowDuplicates: 'yes' } as unknown as Record<string, unknown>)).toThrow(
      ManifestErrorCode.INVALID_CONFIG
    );
  });

  it('wires metrics and logger hooks for register, validation and rejection', () => {
    const registered: string[] = [];
    const validations: string[] = [];
    const rejected: string[] = [];
    const logs: string[] = [];
    const registry = createJobRegistry(
      {},
      {
        recordRegister: (name) => registered.push(name),
        recordValidation: (name, ok) => validations.push(`${name}:${ok}`),
        recordRejected: (code) => rejected.push(code),
      },
      {
        info: (message) => logs.push(message),
        warn: (message) => logs.push(message),
      }
    );
    registry.register(sampleManifest('hooked'));
    registry.validateAll();
    expect(registered).toEqual(['hooked']);
    expect(validations).toEqual(['hooked:true']);
    expect(rejected).toHaveLength(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('Registered');
    expect(() => registry.register(sampleManifest('hooked'))).toThrow(
      ManifestErrorCode.DUPLICATE_JOB
    );
    expect(rejected).toEqual([ManifestErrorCode.DUPLICATE_JOB]);
    expect(logs).toHaveLength(2);
  });

  it('preloads built-in manifests through createDefaultJobRegistry', () => {
    const registry = createDefaultJobRegistry();
    expect(registry.size).toBe(2);
    expect(registry.has('billing-shift')).toBe(true);
    expect(registry.has('audit-flush')).toBe(true);
    expect(registry.validateAll().ok).toBe(true);
  });

  it('exposes inert no-op hooks that are safe to call', () => {
    expect(() => noopManifestMetrics.recordRegister('x')).not.toThrow();
    expect(() => noopManifestMetrics.recordValidation('x', true)).not.toThrow();
    expect(() => noopManifestMetrics.recordRejected(ManifestErrorCode.INVALID_CONFIG)).not.toThrow();
    expect(() => noopManifestLogger.info('x')).not.toThrow();
    expect(() => noopManifestLogger.warn('x')).not.toThrow();
  });
});
